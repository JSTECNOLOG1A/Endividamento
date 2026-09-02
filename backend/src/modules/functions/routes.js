import { Router } from "express";
import * as store from "../entities/store.js";
import { writeAudit } from "../../middleware/audit.js";
import { snapshotForAudit } from "../audit/records.js";
import { calculateAmortizationScheduleOnServer } from "../calculate/service.js";
import { previewNatures, integrateNatures } from "../natures/integrate.js";
import { previewBankAccounts, integrateBankAccounts } from "../bankAccounts/integrate.js";
import { previewChartAccounts, integrateChartAccounts } from "../chartAccounts/integrate.js";
import { syncPayableTitlesFromApprovedContracts, refreshPayableTitlesFxValue, reopenApprovedContractForEditing, cleanupOrphanedPayableTitles, refreshGuaranteedAccountPayableTitle, deleteGuaranteedAccount } from "../payables/generate.js";
import { classifyPayableTitles } from "../payables/classify.js";
import { integratePayableTitles, reversePayableTitles, refreshPayableTitlesFromErp } from "../payables/erpIntegrate.js";
import { convertPayablePrToTx } from "../payables/convertPrToTx.js";
import { lookupPayableErp } from "../payables/erpLookup.js";
import { syncReceivableTitlesFromApprovedContracts } from "../receivables/generate.js";
import { classifyReceivableTitles } from "../receivables/classify.js";
import { integrateReceivableTitles, reverseReceivableTitles, refreshReceivableTitlesFromErp } from "../receivables/erpIntegrate.js";
import { sendDocumentByEmail } from "../documents/sendByEmail.js";
import { getPTAXFromBACEN, getPTAXRangeFromBACEN, getRatesFromBACEN, getIPCAFromBACEN, getTJLPFromBACEN, getTRFromBACEN, getINPCFromBACEN, getIGPMFromBACEN, clearCDIRatesByType, clearCurrencyRates } from "./bacen.js";
import { getHolidaysFromBrasilAPI } from "./holidays.js";
import { calculateGuaranteedAccountStatement, renewGuaranteedAccount } from "./guaranteedAccount.js";
import { assertCanWrite, assertOwner, assertPlatformAdminWithTenant, assertTenantAdmin } from "../tenants/policy.js";

async function validateAllApprovedContracts(payload = {}) {
  const { group_ids = null, entity_ids = null, limit = 1000 } = payload;
  const started = Date.now();
  const contracts = (await store.filter("LoanContract", { status: "aprovado" }, "-approved_date", limit))
    .filter((contract) => {
      if (group_ids?.length && !group_ids.includes(contract.group_id)) return false;
      if (entity_ids?.length && !entity_ids.includes(contract.entity_id)) return false;
      return true;
    });
  if (!contracts.length) {
    return { status: "NO_DATA", message: "Nenhum contrato aprovado encontrado", timestamp: new Date().toISOString() };
  }
  const validations = [];
  for (const contract of contracts) {
    const validation = {
      contract_id: contract.id,
      contract_number: contract.contract_number,
      current_snapshot_id: contract.current_snapshot_id,
      status: "OK",
      flags: [],
    };
    if (!contract.current_snapshot_id) {
      validation.status = "ERROR";
      validation.flags.push("SNAPSHOT_MISSING");
      validations.push(validation);
      continue;
    }
    try {
      const snapshot = await store.getById("CalculationSnapshot", contract.current_snapshot_id);
      if (!snapshot.calculation_hash_strict || String(snapshot.calculation_hash_strict).length !== 64) {
        validation.status = "WARNING";
        validation.flags.push("INVALID_HASH_FORMAT");
      }
    } catch (error) {
      validation.status = "ERROR";
      validation.flags.push("SNAPSHOT_READ_ERROR");
      validation.error = error.message;
    }
    validations.push(validation);
  }
  return {
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - started,
    summary: {
      total_validated: contracts.length,
      ok: validations.filter((item) => item.status === "OK").length,
      warnings: validations.filter((item) => item.status === "WARNING").length,
      errors: validations.filter((item) => item.status === "ERROR").length,
    },
    all_validations: validations,
  };
}

async function calculateAmortizationSchedule(payload = {}, req) {
  try {
    return await calculateAmortizationScheduleOnServer(payload, req);
  } catch (error) {
    if (!error.status) {
      error.status = error.name === "TypeError" ? 500 : 400;
    }
    throw error;
  }
}

const FUNCTION_AUDIT = {
  integrateNatures: { action: "INTEGRATE", rotina: "Governança", resourceType: "Nature", registro: "Integrar naturezas" },
  integrateBankAccounts: { action: "INTEGRATE", rotina: "Governança", resourceType: "BankAccount", registro: "Integrar contas bancárias" },
  integrateChartAccounts: { action: "INTEGRATE", rotina: "Governança", resourceType: "ChartOfAccount", registro: "Integrar plano de contas" },
  syncPayableTitles: { action: "CREATE", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Gerar títulos a pagar" },
  syncReceivableTitles: { action: "CREATE", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Gerar títulos a receber" },
  classifyPayableTitles: { action: "CLASSIFY", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Classificar títulos a pagar" },
  integratePayableTitles: { action: "INTEGRATE", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Integrar títulos a pagar" },
  reversePayableTitles: { action: "REVERSE", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Estornar títulos a pagar" },
  refreshPayableTitlesFromErp: { action: "CONSULT", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Consultar títulos a pagar no ERP" },
  refreshPayableTitlesFxValue: { action: "UPDATE", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Reconverter títulos a pagar pela PTAX mais recente" },
  refreshGuaranteedAccountPayableTitle: { action: "UPDATE", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Recalcular título de conta garantida" },
  convertPayablePrToTx: { action: "UPDATE", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Converter títulos PR em TX" },
  classifyReceivableTitles: { action: "CLASSIFY", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Classificar títulos a receber" },
  integrateReceivableTitles: { action: "INTEGRATE", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Integrar títulos a receber" },
  reverseReceivableTitles: { action: "REVERSE", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Estornar títulos a receber" },
  refreshReceivableTitlesFromErp: { action: "CONSULT", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Consultar títulos a receber no ERP" },
};

const handlers = {
  getPTAXFromBACEN,
  getPTAXRangeFromBACEN,
  getRatesFromBACEN,
  getIPCAFromBACEN,
  getTJLPFromBACEN,
  getTRFromBACEN,
  getINPCFromBACEN,
  getIGPMFromBACEN,
  clearCDIRatesByType,
  clearCurrencyRates,
  getHolidaysFromBrasilAPI,
  calculateGuaranteedAccountStatement,
  renewGuaranteedAccount: (payload, req) => renewGuaranteedAccount(payload, req.user?.email || "system"),
  validateAllApprovedContracts,
  calculateAmortizationSchedule,
  previewNatures: () => previewNatures(),
  integrateNatures: (payload, req) => integrateNatures(payload, req.user?.email || "system"),
  previewBankAccounts: () => previewBankAccounts(),
  integrateBankAccounts: (payload, req) => integrateBankAccounts(payload, req.user?.email || "system"),
  previewChartAccounts: () => previewChartAccounts(),
  integrateChartAccounts: (payload, req) => integrateChartAccounts(payload, req.user?.email || "system"),
  syncPayableTitles: () => syncPayableTitlesFromApprovedContracts(),
  syncReceivableTitles: () => syncReceivableTitlesFromApprovedContracts(),
  classifyPayableTitles: (payload) => classifyPayableTitles(payload || {}),
  integratePayableTitles: (payload) => integratePayableTitles(payload || {}),
  reversePayableTitles: (payload) => reversePayableTitles(payload || {}),
  refreshPayableTitlesFromErp: (payload) => refreshPayableTitlesFromErp(payload || {}),
  refreshPayableTitlesFxValue: (payload) => refreshPayableTitlesFxValue(payload || {}),
  refreshGuaranteedAccountPayableTitle: (payload) => refreshGuaranteedAccountPayableTitle(payload || {}),
  // Auditoria própria (writeAudit chamado dentro da função) — não passa por
  // FUNCTION_AUDIT abaixo pra não duplicar o registro.
  deleteGuaranteedAccount: (payload, req) => deleteGuaranteedAccount(payload || {}, req),
  // Auditoria própria (writeAudit chamado dentro da função) — não passa por
  // FUNCTION_AUDIT abaixo pra não duplicar o registro.
  reopenApprovedContractForEditing: (payload, req) => reopenApprovedContractForEditing(payload || {}, req),
  // Auditoria própria também — mesma razão da linha acima.
  cleanupOrphanedPayableTitles: (payload, req) => cleanupOrphanedPayableTitles(payload || {}, req),
  convertPayablePrToTx: (payload) => convertPayablePrToTx(payload || {}),
  lookupPayableErp: (payload) => lookupPayableErp(payload || {}),
  classifyReceivableTitles: (payload) => classifyReceivableTitles(payload || {}),
  integrateReceivableTitles: (payload) => integrateReceivableTitles(payload || {}),
  reverseReceivableTitles: (payload) => reverseReceivableTitles(payload || {}),
  refreshReceivableTitlesFromErp: (payload) => refreshReceivableTitlesFromErp(payload || {}),
  sendDocumentByEmail: (payload) => sendDocumentByEmail(payload || {}),
};

export const functionsRouter = Router();

const OWNER_FUNCTIONS = new Set([
  "integrateNatures",
  "integrateBankAccounts",
  "integrateChartAccounts",
  "integratePayableTitles",
  "reversePayableTitles",
  "integrateReceivableTitles",
  "reverseReceivableTitles",
]);

const PLATFORM_TENANT_FUNCTIONS = new Set([
  "cleanupOrphanedPayableTitles",
]);

const ADMIN_FUNCTIONS = new Set([
  "deleteGuaranteedAccount",
]);

functionsRouter.post("/:name", async (req, res, next) => {
  try {
    const handler = handlers[req.params.name];
    if (!handler) {
      const err = new Error(`Função não encontrada: ${req.params.name}`);
      err.status = 404;
      throw err;
    }
    if (PLATFORM_TENANT_FUNCTIONS.has(req.params.name)) {
      await assertPlatformAdminWithTenant();
    } else if (ADMIN_FUNCTIONS.has(req.params.name)) {
      await assertTenantAdmin("Apenas administradores podem excluir uma conta garantida.");
    } else if (OWNER_FUNCTIONS.has(req.params.name)) {
      await assertOwner("Apenas o proprietário pode integrar ou estornar no ERP.");
    } else {
      await assertCanWrite();
    }
    const result = await handler(req.body || {}, req);
    const audit = FUNCTION_AUDIT[req.params.name];
    if (audit) {
      const snapshot = await snapshotForAudit({
        resourceType: audit.resourceType,
        result,
        payload: req.body || {},
        fallbackLabel: audit.registro,
      });
      await writeAudit({
        req,
        action: audit.action,
        resourceType: audit.resourceType,
        rotina: audit.rotina,
        registro: snapshot.registro,
        processingType: "processamento",
        after: snapshot.after,
      });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});
