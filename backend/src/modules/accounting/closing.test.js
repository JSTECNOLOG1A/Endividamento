// Invariantes do fechamento contábil (sem banco): juros por competência, liberação/IOF/custo na data
// da operação, capitalização e regra de baixa efetiva. Rodar: npm run test:closing
import { calculateAmortizationSchedule } from "../../engine/CalculationEngine.js";
import { reconcileContractForCompetencia, buildOpeningEntries } from "./closingEngine.js";
import { computeDeploymentPosition } from "./deploymentPosition.js";

const r2 = (v) => Math.round(v * 100) / 100;
let failures = 0;
const check = (label, cond, extra = "") => {
  if (!cond) failures += 1;
  console.log(`${cond ? "PASS" : "FAIL"} - ${label}${extra ? ` | ${extra}` : ""}`);
};

const base = {
  signalValue: 0, iofValue: 0, iofFinanced: false, otherFees: 0, otherFeesFinanced: false,
  encargoGarantiaValue: 0, encargoGarantiaFinanced: false,
  indexer: "NA", indexerSpread: 0, interestDayCountConvention: "dias_corridos_360",
  principalGraceMonths: 0, interestGraceMonths: 0, graceAction: "capitalizar",
  cdiRates: [], holidays: [], percentageBase: "saldo_devedor", exchangeLag: 1, exchangeRates: [],
};

// Tabela de PTAX de teste: uma taxa a cada 5 dias entre 2023 e 2032 (constante ou oscilando).
function ptaxTable(kind) {
  const rows = [];
  for (let t = new Date(Date.UTC(2023, 0, 2)); t < new Date(Date.UTC(2032, 6, 1)); t = new Date(t.getTime() + 5 * 86400000)) {
    const i = Math.round((t - new Date(Date.UTC(2023, 0, 2))) / (5 * 86400000));
    const rate = kind === "fixa" ? 5.5 : r2(5 + 0.7 * Math.sin(i / 23) + 0.0004 * i);
    rows.push({ rate_date: t.toISOString().slice(0, 10), ptax_rate: rate, source: "teste" });
  }
  return rows;
}

const usdBase = {
  ...base, operationValue: 4813331.99, currencyId: "cur_usd", amount_foreign: 962858.97, exchange_rate_closing: 4.999, exchangeLag: 1,
  fixedRate: 7.36, operationDate: "2023-05-31", firstPaymentDate: "2024-10-16", first_payment_date: "2024-10-16",
  principalInstallments: 8, interestInstallments: 8, principalFrequency: 12, interestFrequency: 12,
  calculationSystem: "SAC", totalTermMonths: 85, finalMaturityDate: "2031-10-16", graceInterestBehavior: "CAPITALIZAR",
};

const cases = [
  {
    name: "PRICE mensal com IOF e taxas financiados (perfil do piloto)",
    params: {
      ...base, operationValue: 370000, signalValue: 70000, iofValue: 4931.9, iofFinanced: true, otherFees: 3233.33, otherFeesFinanced: true,
      fixedRate: 14.07, operationDate: "2024-03-05", firstPaymentDate: "2024-04-05", first_payment_date: "2024-04-05",
      principalInstallments: 36, interestInstallments: 36, principalFrequency: 1, interestFrequency: 1,
      calculationSystem: "PRICE", totalTermMonths: 36, finalMaturityDate: "2027-03-05", graceInterestBehavior: "PAGAR",
    },
  },
  {
    name: "SAC anual com capitalização periódica",
    params: {
      ...base, operationValue: 1500000, fixedRate: 12, operationDate: "2020-08-04", firstPaymentDate: "2021-05-17", first_payment_date: "2021-05-17",
      principalInstallments: 7, interestInstallments: 7, principalFrequency: 12, interestFrequency: 12,
      calculationSystem: "SAC", totalTermMonths: 73, finalMaturityDate: "2027-05-17", graceInterestBehavior: "CAPITALIZAR_PERIODICO",
    },
  },
  {
    name: "SAC anual com capitalização até o pagamento",
    params: {
      ...base, operationValue: 1400000, fixedRate: 5, operationDate: "2020-11-23", firstPaymentDate: "2024-10-01", first_payment_date: "2024-10-01",
      principalInstallments: 9, interestInstallments: 9, principalFrequency: 12, interestFrequency: 12,
      calculationSystem: "SAC", totalTermMonths: 97, finalMaturityDate: "2032-10-01", graceInterestBehavior: "CAPITALIZAR",
    },
  },
  { name: "USD com PTAX constante, capitalização até o pagamento", currency: true, params: { ...usdBase, exchangeRates: ptaxTable("fixa") } },
  { name: "USD com PTAX oscilando (variação cambial mensal)", currency: true, params: { ...usdBase, exchangeRates: ptaxTable("variavel") } },
  { name: "USD com PTAX oscilando e capitalização periódica", currency: true, params: { ...usdBase, graceInterestBehavior: "CAPITALIZAR_PERIODICO", exchangeRates: ptaxTable("variavel") } },
];

for (const c of cases) {
  console.log(`\n== ${c.name}`);
  const result = await calculateAmortizationSchedule(c.params);
  const schedule = result.schedule;
  const contract = {
    id: "t", contract_number: "T", operation_category: "emprestimos", operation_date: c.params.operationDate,
    iof_value: c.params.iofValue, other_fees: c.params.otherFees, schedule_data: JSON.stringify({ schedule }),
    currency_id: c.currency ? "cur_usd" : null,
  };
  const totalInterest = r2(schedule.reduce((s, r) => s + (r.jurosFixosMes || 0) + (r.jurosVariaveisMes || 0), 0));
  const start = new Date(c.params.operationDate + "T12:00:00");
  const last = new Date(schedule.at(-1).dataVencimento + "T12:00:00");
  const months = (last.getFullYear() - start.getFullYear()) * 12 + last.getMonth() - start.getMonth() + 2;

  let accrued = 0, chain = true, prev = null, lib = [], tail = null;
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const rec = reconcileContractForCompetencia(contract, d.getFullYear(), d.getMonth() + 1);
    accrued += rec.events.filter((e) => e.type === "juros_apropriados").reduce((s, e) => s + e.amount, 0);
    lib.push(...rec.events.filter((e) => e.type === "liberacao"));
    if (prev && (Math.abs(prev.principal - rec.opening.principal) > 0.02 || Math.abs(prev.interest - rec.opening.interest) > 0.02)) chain = false;
    prev = rec.closing;
    tail = rec;
  }
  check("juros apropriados por competência somam o juro do cronograma", Math.abs(r2(accrued) - totalInterest) < 0.2, `${r2(accrued)} x ${totalInterest}`);
  check("abertura de cada mês = fechamento do mês anterior", chain);
  check("uma liberação, na data da operação", lib.length === 1 && lib[0].date === c.params.operationDate, `${lib.length}x ${lib[0]?.date}`);
  check("no fim, principal e juros a pagar zerados", Math.abs(tail.closing.principal) < 0.2 && Math.abs(tail.closing.interest) < 0.2, JSON.stringify(tail.closing));

  // IOF e custo de transação no ato, sem apropriação mensal
  const opMonth = reconcileContractForCompetencia(contract, start.getFullYear(), start.getMonth() + 1);
  const fees = c.params.otherFees;
  check("IOF na data da operação", !c.params.iofValue || opMonth.events.some((e) => e.type === "iof" && e.date === c.params.operationDate));
  check("custo de transação no ato", !fees || opMonth.events.some((e) => e.type === "custo_transacao_inicial" && e.amount === r2(fees)));
  let apropriacao = 0;
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    apropriacao += reconcileContractForCompetencia(contract, d.getFullYear(), d.getMonth() + 1).events.filter((e) => e.type === "custo_transacao_apropriacao").length;
  }
  check("sem apropriação mensal de custo de transação", apropriacao === 0);

  // chaves de evento estáveis (idempotência)
  const a = reconcileContractForCompetencia(contract, start.getFullYear(), start.getMonth() + 1).events.map((e) => e.key);
  const b = reconcileContractForCompetencia(contract, start.getFullYear(), start.getMonth() + 1).events.map((e) => e.key);
  check("reprocessar gera as mesmas chaves de evento", JSON.stringify(a) === JSON.stringify(b) && a.every(Boolean));

  // regra de baixa efetiva
  const row = schedule.find((r) => (r.amortizacao || 0) > 0 || (r.jurosPagos || 0) > 0);
  const rd = new Date(row.dataVencimento + "T12:00:00");
  const y = rd.getFullYear(), m = rd.getMonth() + 1;
  const oldRule = reconcileContractForCompetencia(contract, y, m);
  const noSettlement = reconcileContractForCompetencia(contract, y, m, [], { requireSettlementFrom: "2000-01-01" });
  const withSettlement = reconcileContractForCompetencia(contract, y, m, [{ id: "s", parcela: row.parcela, status: "baixado", principal_paid: row.amortizacao, interest_paid: row.jurosPagos }], { requireSettlementFrom: "2000-01-01" });
  check("regra antiga: cronograma conta como pago", oldRule.events.some((e) => e.type.startsWith("pagamento")));
  check("baixa efetiva: sem baixa não há pagamento e a parcela vira pendência", !noSettlement.events.some((e) => e.type.startsWith("pagamento")) && noSettlement.pendingUnsettled.length >= 1);
  check("baixa efetiva: com baixa o pagamento entra e a pendência some", withSettlement.events.some((e) => e.type.startsWith("pagamento")) && withSettlement.pendingUnsettled.length < noSettlement.pendingUnsettled.length);
}

// ---------------------------------------------------------------------------------------------
console.log("== T8: pagamento no mês da data real; parcelas em aberto da implantação; abertura");
{
  const pilot = cases[0];
  const { schedule } = await calculateAmortizationSchedule(pilot.params);
  const mk = (extra = {}) => ({ id: "p", contract_number: "PILOTO", operation_category: "emprestimos", operation_date: pilot.params.operationDate,
    iof_value: pilot.params.iofValue, other_fees: pilot.params.otherFees, schedule_data: JSON.stringify({ schedule }), ...extra });
  const ym = (iso) => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];

  // pagamento em atraso: parcela de agosto/2026 paga em outubro
  const row = schedule.find((r) => r.dataVencimento >= "2026-08-01");
  const late = { id: "s1", parcela: row.parcela, status: "baixado", principal_paid: row.amortizacao, interest_paid: row.jurosPagos, actual_payment_date: "2026-10-10" };
  const [ry, rm] = ym(row.dataVencimento);
  const inRowMonth = reconcileContractForCompetencia(mk(), ry, rm, [late]);
  const inPayMonth = reconcileContractForCompetencia(mk(), 2026, 10, [late]);
  check("parcela paga em atraso: sem pagamento no mês da parcela", !inRowMonth.events.some((e) => e.type.startsWith("pagamento")));
  const lateEvents = inPayMonth.events.filter((e) => e.type.startsWith("pagamento") && e.key.includes("baixa-s1"));
  check("parcela paga em atraso: pagamento no mês da data real, com a data real", lateEvents.length >= 1 && lateEvents.every((e) => e.date === "2026-10-10"));
  check("parcela paga em atraso: saldo cai só no mês do pagamento", inPayMonth.closing.principal < inPayMonth.opening.principal - 0.5 && Math.abs(inRowMonth.closing.principal - inRowMonth.opening.principal) < row.amortizacao + 1);
  const lateOpen = reconcileContractForCompetencia(mk(), 2026, 9, [late]);
  const lastSep = schedule.filter((r) => r.dataVencimento <= "2026-09-30").at(-1);
  check("parcela em atraso continua no passivo até o pagamento", Math.abs(lateOpen.closing.principal - (lastSep.sdFinal + row.amortizacao)) < 0.05, `${lateOpen.closing.principal} x ${r2(lastSep.sdFinal + row.amortizacao)}`);

  // implantação: fechamento de setembro parte da posição de abertura
  const CUT = "2026-08-31";
  const openParcela = String(schedule.filter((r) => r.dataVencimento <= CUT).at(-1).parcela);
  const dep = mk({ deployment_mode: true, deployment_cutoff: CUT, deployment_open_parcelas: [openParcela] });
  const pos = computeDeploymentPosition(mk(), CUT, [openParcela]).position;
  const aug = reconcileContractForCompetencia(dep, 2026, 8);
  check("implantação: agosto (até o corte) fica de fora do fechamento", aug.events.length === 0 && aug.closing.principal === 0);
  const sep = reconcileContractForCompetencia(dep, 2026, 9);
  check("saldo de abertura do 1º fechamento = principal da posição de abertura", Math.abs(sep.opening.principal - pos.principalTotal) < 0.05, `${sep.opening.principal} x ${pos.principalTotal}`);
  check("saldo de abertura do 1º fechamento = juros da posição de abertura", Math.abs(sep.opening.interest - pos.jurosTotal) < 0.05, `${sep.opening.interest} x ${pos.jurosTotal}`);
  check("parcela em aberto da implantação vira pendência", sep.pendingUnsettled.some((p) => String(Number(p.parcela)) === openParcela));
  const openRow = schedule.find((r) => String(r.parcela) === openParcela);
  const paid = reconcileContractForCompetencia(dep, 2026, 9, [{ id: "s2", parcela: openRow.parcela, status: "baixado", principal_paid: openRow.amortizacao, interest_paid: openRow.jurosPagos, actual_payment_date: "2026-09-10" }]);
  check("baixa de setembro da parcela em aberto gera o pagamento em setembro", paid.events.some((e) => e.type === "pagamento_principal" && e.date === "2026-09-10" && Math.abs(e.amount - openRow.amortizacao) < 0.02));
  check("baixa tira a parcela das pendências", !paid.pendingUnsettled.some((p) => String(Number(p.parcela)) === openParcela));

  // lançamento de abertura
  const config = { id: "cfg", data_virada: "2026-09-01", principal_cp_account_id: "CP", principal_lp_account_id: "LP", juros_cp_account_id: "JCP", juros_lp_account_id: "JLP", transitoria_account_id: "TR" };
  const snapshot = { contratos: [{ contractId: "p", contractNumber: "PILOTO", position: pos }] };
  const entries = buildOpeningEntries(config, snapshot);
  const deb = r2(entries.filter((e) => e.side === "debito").reduce((s, e) => s + e.amount, 0));
  const cred = r2(entries.filter((e) => e.side === "credito").reduce((s, e) => s + e.amount, 0));
  check("abertura: débito na transitória = total da posição", entries.some((e) => e.side === "debito" && e.account_id === "TR") && Math.abs(deb - pos.total) < 0.02, `${deb} x ${pos.total}`);
  check("abertura: débitos = créditos", Math.abs(deb - cred) < 0.01);
  check("abertura: data da virada e chave por linha, sem repetição", entries.every((e) => e.entry_date === "2026-09-01" && e.event_key) && new Set(entries.map((e) => e.event_key + e.side)).size === entries.length);
  check("abertura: sem snapshot não gera nada", buildOpeningEntries(config, null).length === 0);
}

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log("\nclosing ok");
