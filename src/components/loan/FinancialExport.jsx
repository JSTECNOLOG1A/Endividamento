/**
 * 🔐 FINANCIAL EXPORT — ETAPA 4A
 * 
 * Camada read-only de consolidação para ERP e contabilidade
 * NÃO recalcula, NÃO altera: apenas organiza dados do result final
 */

/**
 * Consolida resultado de cálculo em estrutura padronizada para exportação
 * @param {Object} result - Output de calculateAmortizationSchedule()
 * @param {Object} contract - Dados do contrato (group_id, entity_id, bank_id, contract_number)
 * @returns {Object} Estrutura financeira consolidada
 */
export function buildFinancialExport(result, contract = {}) {
  if (!result || !result.schedule) {
    throw new Error("[FINANCIAL_EXPORT] Result inválido: schedule ausente");
  }

  return {
    // 🔐 METADATA: Integridade e rastreabilidade
    metadata: {
      engine_version: result.calculation_metadata?.engine_version,
      engine_build_id: result.calculation_metadata?.engine_build_id,
      calculation_hash_strict: result.calculation_metadata?.calculation_hash_strict,
      calculation_hash_instance: result.calculation_metadata?.calculation_hash_instance,
      calculated_at: result.calculation_metadata?.calculated_at,
      rounding_policy: result.calculation_metadata?.rounding_policy
    },

    // 📋 CONTRATO: Identificação
    contract: {
      group_id: contract.group_id,
      entity_id: contract.entity_id,
      bank_id: contract.bank_id,
      contract_number: contract.contract_number,
      operation_date: result.calculation_metadata?.operation_date // 🔐 ETAPA 4A: Explícito em metadata
    },

    // 💰 FINANCIAL: Resumo executivo
    financial: {
      currency: result.calculation_metadata?.currency || "BRL",
      principal: result.principal,
      total_interest: result.totalJuros,
      total_paid: result.totalPrestacao,
      cet_annual: result.cetAnnual,
      fixed_rate_nominal: result.fixedRateNominal
    },

    // 📊 SCHEDULE: Tabela de amortização (read-only)
    schedule: result.schedule,

    // 📋 DISCLOSURE: Transparência regulatória
    disclosure: result.disclosure_automated,

    // ⚠️ RISK: Flags de risco identificadas
    risk_flags: result.risk_flags,

    // 📝 AUDIT: Rastreabilidade jurídica
    audit_log: result.audit_log
  };
}

/**
 * Extrai apenas metadados + hashes para auditoria pura
 * Uso: Validação de integridade, verificação de reprodutibilidade
 */
export function buildAuditPackage(result) {
  return {
    engine_version: result.calculation_metadata?.engine_version,
    engine_build_id: result.calculation_metadata?.engine_build_id,
    calculation_hash_strict: result.calculation_metadata?.calculation_hash_strict,
    calculation_hash_instance: result.calculation_metadata?.calculation_hash_instance,
    calculated_at: result.calculation_metadata?.calculated_at,
    rounding_policy: result.calculation_metadata?.rounding_policy,
    currency: result.calculation_metadata?.currency,
    risk_flags: result.risk_flags,
    audit_log: result.audit_log,
    
    // Verificação de conformidade
    integrity_status: result.integrity?.status,
    precision_governance_status: result.precision_governance?.status,
    
    // Snapshot de taxas (se aplicável)
    rate_snapshot: result.calculation_metadata?.rate_snapshot
  };
}

export default { buildFinancialExport, buildAuditPackage };