/**
 * 🔐 CALCULATION SNAPSHOT PERSISTENCE — ETAPA 4B
 * 
 * Trilha institucional permanente de cada cálculo aprovado
 * Imutável, auditável, pronto para securitização e relatos regulatórios
 */

import { base44 } from "@/api/base44Client";

/**
 * Salva um snapshot imutável do cálculo aprovado
 * 
 * @param {Object} result - Output de calculateAmortizationSchedule()
 * @param {Object} contract - Dados do contrato { id, contract_number, group_id, entity_id }
 * @param {string} triggerEvent - "APPROVED" | "RECALCULATED" | "REOPENED" | "IMPORTED"
 * @param {Object} calculationParams - Parâmetros originais de entrada (opcional)
 * @returns {Promise<Object>} Snapshot criado
 */
export async function saveCalculationSnapshot(
  result,
  contract = {},
  triggerEvent = "APPROVED",
  calculationParams = {}
) {
  if (!result || !result.schedule) {
    throw new Error("[SNAPSHOT_PERSISTENCE] Result inválido: schedule ausente");
  }

  if (!contract.id || !contract.contract_number) {
    throw new Error("[SNAPSHOT_PERSISTENCE] Contrato inválido: id e contract_number obrigatórios");
  }

  if (!result.calculation_metadata?.calculation_hash_strict) {
    throw new Error("[SNAPSHOT_PERSISTENCE] Hash strict não disponível no result");
  }

  // 🔐 CONSTRUIR SNAPSHOT
  const snapshot = {
    contract_id: contract.id,
    contract_number: contract.contract_number,

    // Engine & Build
    engine_version: result.calculation_metadata.engine_version,
    engine_build_id: result.calculation_metadata.engine_build_id,

    // Hashes (rastreabilidade)
    calculation_hash_strict: result.calculation_metadata.calculation_hash_strict,
    calculation_hash_instance: result.calculation_metadata.calculation_hash_instance,

    // Snapshots JSON (congelados)
    schedule_snapshot: JSON.stringify(result.schedule),
    disclosure_snapshot: JSON.stringify(result.disclosure_automated || {}),
    risk_flags_snapshot: JSON.stringify(result.risk_flags || []),
    audit_log_snapshot: JSON.stringify(result.audit_log || null),

    // Resumo executivo
    currency: result.calculation_metadata?.currency || "BRL",
    principal: result.principal,
    total_interest: result.totalJuros,
    total_paid: result.totalPrestacao,

    // Contexto
    trigger_event: triggerEvent,
    
    // Metadados opcionais
    calculation_parameters: JSON.stringify(calculationParams),
    metadata: JSON.stringify({
      operation_date: result.calculation_metadata?.operation_date,
      ptax_series_id: result.calculation_metadata?.ptax_series_id,
      cdi_series_id: result.calculation_metadata?.cdi_series_id,
      rate_snapshot_used: result.calculation_metadata?.used_snapshot_rates,
      strategy: result.calculation_metadata?.strategy,
      integrity_status: result.integrity?.status || "SKIP",
      precision_governance_status: result.precision_governance?.status || "SKIP"
    })
  };

  // 🔐 SALVAR NO BANCO DE DADOS
  console.log(`📦 Salvando snapshot: ${contract.contract_number} | Evento: ${triggerEvent}`);
  
  try {
    const created = await base44.entities.CalculationSnapshot.create(snapshot);
    
    console.log(`✅ Snapshot criado: ${created.id}`);
    console.log(`   Hash Strict: ${created.calculation_hash_strict.substring(0, 16)}...`);
    console.log(`   Hash Instance: ${created.calculation_hash_instance.substring(0, 16)}...`);
    
    return created;
  } catch (error) {
    console.error(`❌ Erro ao salvar snapshot: ${error.message}`);
    throw error;
  }
}

/**
 * Recupera histórico de cálculos de um contrato
 * @param {string} contractId - ID do contrato
 * @returns {Promise<Array>} Array de snapshots ordenados por data
 */
export async function getCalculationHistory(contractId) {
  if (!contractId) {
    throw new Error("[SNAPSHOT_PERSISTENCE] Contract ID é obrigatório");
  }

  try {
    const snapshots = await base44.entities.CalculationSnapshot.filter(
      { contract_id: contractId },
      "-created_date",
      100
    );
    
    console.log(`📜 Histórico recuperado: ${snapshots.length} snapshot(s) para contrato ${contractId}`);
    return snapshots;
  } catch (error) {
    console.error(`❌ Erro ao recuperar histórico: ${error.message}`);
    throw error;
  }
}

/**
 * Recupera o snapshot mais recente de um contrato
 * @param {string} contractId - ID do contrato
 * @returns {Promise<Object>} Último snapshot
 */
export async function getLatestSnapshot(contractId) {
  const history = await getCalculationHistory(contractId);
  return history.length > 0 ? history[0] : null;
}

/**
 * Valida se um snapshot é válido (checks de integridade)
 * @param {Object} snapshot - Snapshot a validar
 * @returns {Object} { valid: boolean, errors: Array }
 */
export function validateSnapshot(snapshot) {
  const errors = [];

  if (!snapshot.calculation_hash_strict) {
    errors.push("Hash strict ausente");
  }

  if (!snapshot.schedule_snapshot) {
    errors.push("Schedule snapshot ausente");
  }

  try {
    JSON.parse(snapshot.schedule_snapshot);
  } catch (e) {
    errors.push(`Schedule snapshot JSON inválido: ${e.message}`);
  }

  if (snapshot.disclosure_snapshot) {
    try {
      JSON.parse(snapshot.disclosure_snapshot);
    } catch (e) {
      errors.push(`Disclosure snapshot JSON inválido: ${e.message}`);
    }
  }

  if (snapshot.risk_flags_snapshot) {
    try {
      JSON.parse(snapshot.risk_flags_snapshot);
    } catch (e) {
      errors.push(`Risk flags snapshot JSON inválido: ${e.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Compara dois snapshots para detectar mudanças
 * @param {Object} snapshotA - Primeiro snapshot
 * @param {Object} snapshotB - Segundo snapshot
 * @returns {Object} Comparação com diferenças
 */
export function compareSnapshots(snapshotA, snapshotB) {
  const comparison = {
    hash_strict_equal: snapshotA.calculation_hash_strict === snapshotB.calculation_hash_strict,
    principal_equal: snapshotA.principal === snapshotB.principal,
    total_interest_equal: snapshotA.total_interest === snapshotB.total_interest,
    total_paid_equal: snapshotA.total_paid === snapshotB.total_paid,
    schedule_length_a: JSON.parse(snapshotA.schedule_snapshot).length,
    schedule_length_b: JSON.parse(snapshotB.schedule_snapshot).length,
    trigger_event_a: snapshotA.trigger_event,
    trigger_event_b: snapshotB.trigger_event
  };

  const allEqual = Object.keys(comparison)
    .filter(k => k.endsWith("_equal"))
    .every(k => comparison[k] === true);

  return {
    ...comparison,
    identical: allEqual
  };
}

/**
 * Recupera e desserializa um snapshot completo
 * @param {Object} snapshot - Snapshot do banco
 * @returns {Object} Snapshot com campos desserializados
 */
export function deserializeSnapshot(snapshot) {
  return {
    ...snapshot,
    schedule: JSON.parse(snapshot.schedule_snapshot),
    disclosure: JSON.parse(snapshot.disclosure_snapshot || "{}"),
    risk_flags: JSON.parse(snapshot.risk_flags_snapshot || "[]"),
    audit_log: JSON.parse(snapshot.audit_log_snapshot || "null"),
    calculation_parameters: JSON.parse(snapshot.calculation_parameters || "{}"),
    metadata: JSON.parse(snapshot.metadata || "{}")
  };
}

export default {
  saveCalculationSnapshot,
  getCalculationHistory,
  getLatestSnapshot,
  validateSnapshot,
  compareSnapshots,
  deserializeSnapshot
};