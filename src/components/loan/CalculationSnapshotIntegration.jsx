/**
 * 🔐 CALCULATION SNAPSHOT INTEGRATION — ETAPA 4B
 * 
 * Wrapper para integração com workflow de aprovação/recalculo
 * Interface simples: saveAndUpdateContract(result, contract, triggerEvent)
 */

import { base44 } from "@/api/base44Client";
import { saveCalculationSnapshot } from "./CalculationSnapshotPersistence";

/**
 * Salva snapshot E atualiza contrato em transação lógica
 * @param {Object} result - Output de calculateAmortizationSchedule()
 * @param {Object} contract - Contrato { id, contract_number, ... }
 * @param {string} triggerEvent - "APPROVED" | "RECALCULATED" | "REOPENED"
 * @returns {Promise} { snapshot, updatedContract }
 */
export async function saveAndUpdateContract(result, contract, triggerEvent = "APPROVED") {
  if (!result?.schedule || !contract?.id) {
    throw new Error("[SNAPSHOT_INTEGRATION] Invalid result or contract");
  }

  console.log(`📦 Etapa 4B Integration: ${triggerEvent} snapshot para ${contract.contract_number}`);

  // 1️⃣ Salvar snapshot
  const snapshot = await saveCalculationSnapshot(result, contract, triggerEvent);

  // 2️⃣ Atualizar contrato com ID do snapshot
  const updatePayload = {
    current_snapshot_id: snapshot.id
  };

  if (triggerEvent === "APPROVED") {
    updatePayload.approved_snapshot_id = snapshot.id;
  } else if (triggerEvent === "RECALCULATED") {
    updatePayload.last_recalculated_at = new Date().toISOString();
  }

  const updatedContract = await base44.entities.LoanContract.update(contract.id, updatePayload);

  console.log(`✅ Contrato atualizado com snapshot: ${snapshot.id.substring(0, 8)}...`);

  return { snapshot, updatedContract };
}

/**
 * Carrega snapshot com fallback para schedule_data
 * @param {Object} contract - Contrato com current_snapshot_id
 * @returns {Promise<Object>} Dados do cálculo (snapshot ou fallback)
 */
export async function loadCalculationData(contract) {
  // 1️⃣ Se tem snapshot, usar (PREFERENCIAL)
  if (contract.current_snapshot_id) {
    try {
      const snapshot = await base44.entities.CalculationSnapshot.read(contract.current_snapshot_id);
      
      return {
        schedule: JSON.parse(snapshot.schedule_snapshot),
        disclosure_automated: JSON.parse(snapshot.disclosure_snapshot || "{}"),
        risk_flags: JSON.parse(snapshot.risk_flags_snapshot || "[]"),
        audit_log: JSON.parse(snapshot.audit_log_snapshot || "null"),
        calculation_metadata: {
          engine_version: snapshot.engine_version,
          engine_build_id: snapshot.engine_build_id,
          calculation_hash_strict: snapshot.calculation_hash_strict,
          calculation_hash_instance: snapshot.calculation_hash_instance,
          currency: snapshot.currency
        },
        source: "SNAPSHOT"
      };
    } catch (error) {
      console.warn(`⚠️ Erro ao carregar snapshot, usando fallback: ${error.message}`);
    }
  }

  // 2️⃣ FALLBACK: usar schedule_data (retrocompatibilidade)
  if (contract.schedule_data) {
    const data = JSON.parse(contract.schedule_data);
    return { ...data, source: "SCHEDULE_DATA" };
  }

  return null;
}

/**
 * Valida que snapshot não contém PII
 * @param {Object} snapshot - Snapshot do banco
 * @returns {Object} { valid: boolean, piiFound: Array }
 */
export function validateNoPII(snapshot) {
  const dangerousPatterns = [
    /@[a-z0-9\.\-_]+\.[a-z]{2,}/i,  // Email
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // CPF
    /\b\d{2}\.\d{3}\.\d{3}\/0001-\d{2}\b/ // CNPJ
  ];

  const piiFound = [];
  const fields = [
    snapshot.schedule_snapshot,
    snapshot.disclosure_snapshot,
    snapshot.risk_flags_snapshot,
    snapshot.audit_log_snapshot,
    snapshot.calculation_parameters,
    snapshot.metadata
  ];

  fields.forEach((field, idx) => {
    if (!field) return;
    dangerousPatterns.forEach((pattern, patIdx) => {
      if (pattern.test(field)) {
        piiFound.push(`Field ${idx}: pattern ${patIdx}`);
      }
    });
  });

  return { valid: piiFound.length === 0, piiFound };
}

export default {
  saveAndUpdateContract,
  loadCalculationData,
  validateNoPII
};