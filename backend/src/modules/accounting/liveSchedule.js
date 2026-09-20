// Cronograma "vivo" de contratos indexados (CDI, SELIC, IPCA, TR...): o cronograma salvo é uma fotografia feita
// quando o contrato foi calculado — para os meses sem índice publicado, o motor repete a última taxa conhecida
// (projeção). A cada fechamento, o cronograma é recalculado com as taxas reais já publicadas; o que ainda não saiu
// segue projetado. O cronograma salvo não é alterado (fica como registro do que foi aprovado).
//
// O recálculo usa os mesmos parâmetros da Calculadora (a partir do contrato salvo). Como o motor não conhece os
// pagamentos reais, ele reproduz o que o banco cobra dadas as taxas reais; as baixas reais entram pelo Contas a Pagar.
import { pool } from "../../db/pool.js";
import { calculateAmortizationSchedule } from "../../engine/CalculationEngine.js";

const INDEXERS = new Set(["CDI", "SELIC", "IPCA", "TJLP", "TR", "INPC", "IGPM"]);

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return String(value).slice(0, 10);
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/** Contratos que dependem de índice publicado (e em reais): os únicos com cronograma vivo. */
export function isIndexedContract(contract) {
  return INDEXERS.has(String(contract.indexer || "").toUpperCase()) && !contract.currency_id;
}

/** Parâmetros do motor a partir do contrato salvo (mesma conversão da Calculadora). */
export function engineParamsFromContract(contract, { cdiRates, holidays }) {
  let amortizationSchedule = null;
  if (contract.calculation_system === "PERCENTAGE_RESIDUAL" && contract.amortization_percentages) {
    amortizationSchedule = {};
    String(contract.amortization_percentages).split(",").forEach((p, idx) => { amortizationSchedule[idx + 1] = parseFloat(p.trim()) / 100; });
  }
  const firstPayment = isoDate(contract.first_payment_date);
  const disb = parseJson(contract.disbursement_schedule, null);
  return {
    operationValue: num(contract.operation_value),
    signalValue: num(contract.signal_value),
    iofValue: num(contract.iof_value),
    iofFinanced: Boolean(contract.iof_financed),
    encargoGarantiaValue: num(contract.encargo_garantia_value),
    encargoGarantiaFinanced: Boolean(contract.encargo_garantia_financed),
    otherFees: num(contract.other_fees),
    otherFeesFinanced: Boolean(contract.other_fees_financed),
    fixedRate: num(contract.fixed_rate),
    indexer: contract.indexer || "NA",
    indexerSpread: num(contract.indexer_spread),
    interestDayCountConvention: contract.interest_day_count_convention,
    indexerCapitalizationMode: contract.indexer_capitalization_mode,
    operationDate: isoDate(contract.operation_date),
    firstPaymentDate: firstPayment,
    first_payment_date: firstPayment,
    principalGraceMonths: num(contract.principal_grace_months),
    interestGraceMonths: num(contract.interest_grace_months),
    graceAction: contract.grace_action,
    graceInterestBehavior: contract.grace_interest_behavior,
    amortizationTrigger: contract.amortization_trigger,
    principalInstallments: num(contract.principal_installments),
    interestInstallments: num(contract.interest_installments),
    principalFrequency: contract.principal_frequency,
    interestFrequency: contract.interest_frequency,
    calculationSystem: contract.calculation_system,
    cdiRates,
    holidays,
    totalTermMonths: contract.total_term_months ? parseInt(contract.total_term_months, 10) : null,
    finalMaturityDate: isoDate(contract.final_maturity_date),
    amortizationSchedule,
    percentageBase: contract.percentage_base || "saldo_devedor",
    currencyId: null,
    exchangeLag: contract.exchange_lag || 1,
    exchangeRates: [],
    amount_foreign: null,
    exchange_rate_closing: null,
    disbursementSchedule: Array.isArray(disb) && disb.length > 0 ? disb : null,
  };
}

/**
 * Índices (CDI, SELIC, IPCA...) e feriados do grupo, no formato do motor. asOfIso limita as taxas às de referência
 * até a data (o fechamento de um mês só conhece as taxas até a data de fechamento; o resto segue projetado).
 */
export async function loadMarketRates(groupId, asOfIso = null) {
  const rates = (await pool.query(
    `SELECT rate_date, annual_rate, rate_type FROM cdi_rates
      WHERE (group_id = $1 OR group_id IS NULL) AND ($2::date IS NULL OR rate_date <= $2::date)
      ORDER BY rate_date ASC`,
    [groupId, asOfIso]
  )).rows.map((r) => ({ rate_date: isoDate(r.rate_date), annual_rate: Number(r.annual_rate), rate_type: r.rate_type }));
  const holidays = (await pool.query(
    `SELECT holiday_date FROM holidays WHERE group_id = $1 OR group_id IS NULL`,
    [groupId]
  )).rows.map((h) => ({ holiday_date: isoDate(h.holiday_date) }));
  return { cdiRates: rates, holidays };
}

/** Recalcula o cronograma do contrato com as taxas publicadas. Devolve as linhas do cronograma. */
export async function computeLiveSchedule(contract, market) {
  const result = await calculateAmortizationSchedule(engineParamsFromContract(contract, market));
  return result.schedule;
}

/**
 * Cronogramas vivos dos contratos indexados: { [contractId]: schedule[] }. Contrato cujo recálculo falha
 * (taxa ausente, parâmetro inválido) fica de fora e volta em `failed`: o fechamento segue o cronograma salvo.
 */
export async function loadLiveSchedules(contracts, groupId, asOfIso = null) {
  const indexed = contracts.filter(isIndexedContract);
  if (!indexed.length) return { schedules: {}, failed: [] };
  const market = await loadMarketRates(groupId, asOfIso);
  const schedules = {};
  const failed = [];
  for (const c of indexed) {
    try {
      const schedule = await computeLiveSchedule(c, market);
      if (Array.isArray(schedule) && schedule.length) schedules[c.id] = schedule;
    } catch (error) {
      failed.push({ contractId: c.id, contractNumber: c.contract_number, message: error.message });
    }
  }
  return { schedules, failed };
}
