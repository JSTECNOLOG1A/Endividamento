// T0 — Simulação do impacto do calendário de feriados nos contratos. SOMENTE LEITURA: não grava em banco nenhum.
// Roda no container local (motor de cálculo). Entradas: cópia dos contratos de produção e a carga de feriados.
import fs from "node:fs";
import { calculateAmortizationSchedule } from "/app/src/engine/CalculationEngine.js";

const contracts = JSON.parse(fs.readFileSync("/app/t0_prod_contracts.json", "utf8"));
const holidays = JSON.parse(fs.readFileSync("/app/t0_feriados.json", "utf8")).map((h) => ({ holiday_date: h.holiday_date }));
const DATA_BASE = "2026-08-31";
const parse = (v) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);
const num = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));

function paramsFor(c, hol) {
  const sd = parse(c.schedule_data) || {};
  const pct = c.amortization_percentages && c.calculation_system === "PERCENTAGE_RESIDUAL"
    ? Object.fromEntries(String(c.amortization_percentages).split(",").map((p, i) => [i + 1, parseFloat(p.trim()) / 100])) : null;
  return {
    operationValue: c.operation_value, signalValue: c.signal_value, iofValue: c.iof_value, iofFinanced: c.iof_financed,
    encargoGarantiaValue: c.encargo_garantia_value, encargoGarantiaFinanced: c.encargo_garantia_financed,
    otherFees: c.other_fees, otherFeesFinanced: c.other_fees_financed,
    fixedRate: c.fixed_rate, indexer: c.indexer, indexerSpread: c.indexer_spread,
    interestDayCountConvention: c.interest_day_count_convention, indexerCapitalizationMode: c.indexer_capitalization_mode,
    operationDate: c.operation_date, firstPaymentDate: c.first_payment_date, first_payment_date: c.first_payment_date,
    principalGraceMonths: c.principal_grace_months, interestGraceMonths: c.interest_grace_months,
    graceAction: c.grace_action, graceInterestBehavior: c.grace_interest_behavior, amortizationTrigger: c.amortization_trigger,
    principalInstallments: c.principal_installments, interestInstallments: c.interest_installments,
    principalFrequency: c.principal_frequency, interestFrequency: c.interest_frequency, calculationSystem: c.calculation_system,
    cdiRates: sd.cdiRates || [], holidays: hol,
    totalTermMonths: c.total_term_months ? parseInt(c.total_term_months) : null, finalMaturityDate: c.final_maturity_date,
    amortizationSchedule: pct, percentageBase: c.percentage_base || "saldo_devedor",
    currencyId: c.currency_id || null, exchangeLag: c.exchange_lag || 1, exchangeRates: parse(c.exchange_rates) || [],
    amount_foreign: c.amount_foreign || null, exchange_rate_closing: c.exchange_rate_closing || null,
    disbursementSchedule: (() => { const d = parse(c.disbursement_schedule); return Array.isArray(d) && d.length ? d : null; })(),
  };
}

const money = (n) => Math.round(num(n) * 100) / 100;
const out = [];
for (const c of contracts) {
  const stored = (parse(c.schedule_data)?.schedule) || [];
  const item = { contrato: c.contract_number, status: c.status, sistema: c.calculation_system, parcelasArmazenadas: stored.length };
  try {
    const base = (await calculateAmortizationSchedule(paramsFor(c, []))).schedule;
    const withH = (await calculateAmortizationSchedule(paramsFor(c, holidays))).schedule;

    // 1) o motor reproduz o cronograma salvo (sem feriados)?
    let maxDiff = 0, dateDiff = 0;
    const n = Math.min(stored.length, base.length);
    for (let i = 0; i < n; i++) {
      if (stored[i].dataVencimento !== base[i].dataVencimento) dateDiff++;
      for (const k of ["amortizacao", "jurosPagos", "sdFinal"]) maxDiff = Math.max(maxDiff, Math.abs(num(stored[i][k]) - num(base[i][k])));
    }
    item.reproducao = { linhasSalvas: stored.length, linhasMotor: base.length, datasDiferentes: dateDiff, maiorDiferencaValor: money(maxDiff) };

    // 2) impacto dos feriados
    const changes = [];
    let interestBase = 0, interestNew = 0;
    for (let i = 0; i < Math.min(base.length, withH.length); i++) {
      interestBase += num(base[i].jurosPagos); interestNew += num(withH[i].jurosPagos);
      const moved = base[i].dataVencimento !== withH[i].dataVencimento;
      const dj = money(num(withH[i].jurosPagos) - num(base[i].jurosPagos));
      const da = money(num(withH[i].amortizacao) - num(base[i].amortizacao));
      if (moved || dj !== 0 || da !== 0) {
        changes.push({ parcela: base[i].parcela, de: base[i].dataVencimento, para: withH[i].dataVencimento, deltaJuros: dj, deltaAmortizacao: da, periodo: (withH[i].dataVencimento <= DATA_BASE ? "até a data-base" : "depois da data-base") });
      }
    }
    item.impacto = {
      parcelasAlteradas: changes.length,
      deltaJurosTotal: money(interestNew - interestBase),
      deltaSaldoFinal: money(num(withH.at(-1)?.sdFinal) - num(base.at(-1)?.sdFinal)),
      alteradasAteDataBase: changes.filter((x) => x.periodo === "até a data-base").length,
      alteradasDepoisDataBase: changes.filter((x) => x.periodo === "depois da data-base").length,
      detalhe: changes,
    };
  } catch (e) {
    item.erro = String(e.message || e).slice(0, 200);
  }
  out.push(item);
}
fs.writeFileSync("/app/t0_resultado.json", JSON.stringify(out, null, 1));
for (const i of out) {
  console.log(`\n== ${i.contrato} (${i.status}, ${i.sistema})`);
  if (i.erro) { console.log("  ERRO:", i.erro); continue; }
  console.log("  reprodução do cronograma salvo:", JSON.stringify(i.reproducao));
  console.log("  impacto dos feriados:", JSON.stringify({ ...i.impacto, detalhe: undefined }));
}
