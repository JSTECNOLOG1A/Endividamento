/**
 * 🔐 EXPORT ORCHESTRATOR — ETAPA 4A
 * 
 * Orquestra todas as exportações (Financial, Accounting, Audit)
 * Interface única para ERP, contabilidade e auditoria
 */

import { buildFinancialExport, buildAuditPackage } from "./FinancialExport";
import {
  buildAccountingEntries,
  formatAccountingEntriesCSV,
  formatAccountingEntriesJSON,
  validateAccountingEntries
} from "./AccountingEntries";

/**
 * Gera pacote completo de exportação
 * @param {Object} result - Output de calculateAmortizationSchedule()
 * @param {Object} contract - Dados do contrato
 * @param {Object} options - Opções de exportação
 * @returns {Object} Pacote consolidado
 */
export function generateExportPackage(result, contract = {}, options = {}) {
  const {
    includeAccounting = true,
    includeAudit = true,
    accountingFormat = "json", // "json" ou "csv"
    entry_mode = "ACCRUAL_ONLY",
    validation_scope = "date"
  } = options;

  // 🔐 ETAPA 4A: Clonar schedule para evitar mutações externas
  const clonedResult = {
    ...result,
    schedule: structuredClone(result.schedule),
    calculation_metadata: structuredClone(result.calculation_metadata),
    disclosure_automated: structuredClone(result.disclosure_automated),
    risk_flags: structuredClone(result.risk_flags)
  };

  const exportPackage = {
    timestamp: new Date().toISOString(),
    financial: buildFinancialExport(clonedResult, contract)
  };

  // Lançamentos contábeis (opcional)
  if (includeAccounting) {
    const entries = buildAccountingEntries(clonedResult, { entry_mode });
    const validation = validateAccountingEntries(entries, { validation_scope });

    exportPackage.accounting = {
      entries: entries,
      validation: validation,
      formatted:
        accountingFormat === "csv"
          ? formatAccountingEntriesCSV(entries)
          : formatAccountingEntriesJSON(entries)
    };
  }

  // Pacote de auditoria (opcional)
  if (includeAudit) {
    exportPackage.audit = buildAuditPackage(clonedResult);
  }

  return exportPackage;
}

export default { generateExportPackage };