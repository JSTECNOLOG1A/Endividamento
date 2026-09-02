import { Router } from "express";
import * as store from "../entities/store.js";
import { writeAudit } from "../../middleware/audit.js";
import { snapshotForAudit } from "../audit/records.js";
import { calculateAmortizationScheduleOnServer } from "../calculate/service.js";
import { previewNatures, integrateNatures } from "../natures/integrate.js";
import { previewBankAccounts, integrateBankAccounts } from "../bankAccounts/integrate.js";
import { previewChartAccounts, integrateChartAccounts } from "../chartAccounts/integrate.js";
import { syncPayableTitlesFromApprovedContracts } from "../payables/generate.js";
import { classifyPayableTitles } from "../payables/classify.js";
import { integratePayableTitles, reversePayableTitles, refreshPayableTitlesFromErp } from "../payables/erpIntegrate.js";
import { convertPayablePrToTx } from "../payables/convertPrToTx.js";
import { lookupPayableErp } from "../payables/erpLookup.js";
import { syncReceivableTitlesFromApprovedContracts } from "../receivables/generate.js";
import { classifyReceivableTitles } from "../receivables/classify.js";
import { integrateReceivableTitles, reverseReceivableTitles, refreshReceivableTitlesFromErp } from "../receivables/erpIntegrate.js";
import { assertCanWrite, assertOwner } from "../tenants/policy.js";

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatOlindaDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${date.getFullYear()}`;
}

function parseOlindaItem(item) {
  const raw = item.dataHoraCotacao || item.Data || "";
  return {
    rate_date: String(raw).slice(0, 10),
    ptax_rate: Number(item.cotacaoVenda ?? item.cotacaoCompra),
    source: "BCB_OLINDA",
    series_id: "BCB_PTAX_USD",
    fetched_at: new Date().toISOString(),
  };
}

async function getPTAXFromBACEN(payload = {}) {
  const { targetDate, lag = 1 } = payload;
  if (!targetDate) {
    const err = new Error("targetDate é obrigatório (YYYY-MM-DD)");
    err.status = 400;
    throw err;
  }
  const searchDate = new Date(`${targetDate}T00:00:00`);
  searchDate.setDate(searchDate.getDate() - Number(lag || 0));
  const start = new Date(searchDate);
  start.setDate(start.getDate() - 10);
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${formatOlindaDate(start)}'` +
    `&@dataFinalCotacao='${formatOlindaDate(searchDate)}'` +
    `&$top=20&$format=json`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const err = new Error(`BACEN API retornou ${response.status}`);
    err.status = 502;
    throw err;
  }
  const data = await response.json();
  const values = Array.isArray(data.value) ? data.value : [];
  const searchStr = toIsoDate(searchDate);
  let foundRate = null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const parsed = parseOlindaItem(values[i]);
    if (parsed.rate_date && parsed.rate_date <= searchStr && Number.isFinite(parsed.ptax_rate)) {
      foundRate = parsed;
      break;
    }
  }
  if (!foundRate && values.length) {
    foundRate = {
      ...parseOlindaItem(values[values.length - 1]),
      source: "BCB_LAST_AVAILABLE",
      warning: `Taxa para ${searchStr} não disponível`,
    };
  }
  if (!foundRate) {
    const err = new Error("Nenhuma taxa PTAX disponível no BACEN");
    err.status = 404;
    throw err;
  }
  return { success: true, official: foundRate, targetDate, lag };
}

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
  convertPayablePrToTx: { action: "UPDATE", rotina: "Contas a pagar", resourceType: "PayableTitle", registro: "Converter títulos PR em TX" },
  classifyReceivableTitles: { action: "CLASSIFY", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Classificar títulos a receber" },
  integrateReceivableTitles: { action: "INTEGRATE", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Integrar títulos a receber" },
  reverseReceivableTitles: { action: "REVERSE", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Estornar títulos a receber" },
  refreshReceivableTitlesFromErp: { action: "CONSULT", rotina: "Contas a receber", resourceType: "ReceivableTitle", registro: "Consultar títulos a receber no ERP" },
};

const handlers = {
  getPTAXFromBACEN,
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
  convertPayablePrToTx: (payload) => convertPayablePrToTx(payload || {}),
  lookupPayableErp: (payload) => lookupPayableErp(payload || {}),
  classifyReceivableTitles: (payload) => classifyReceivableTitles(payload || {}),
  integrateReceivableTitles: (payload) => integrateReceivableTitles(payload || {}),
  reverseReceivableTitles: (payload) => reverseReceivableTitles(payload || {}),
  refreshReceivableTitlesFromErp: (payload) => refreshReceivableTitlesFromErp(payload || {}),
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

functionsRouter.post("/:name", async (req, res, next) => {
  try {
    const handler = handlers[req.params.name];
    if (!handler) {
      const err = new Error(`Função não encontrada: ${req.params.name}`);
      err.status = 404;
      throw err;
    }
    if (OWNER_FUNCTIONS.has(req.params.name)) {
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
