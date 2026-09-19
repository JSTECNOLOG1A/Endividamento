// Invariantes do fechamento contábil (sem banco): juros por competência, liberação/IOF/custo na data
// da operação, capitalização e regra de baixa efetiva. Rodar: npm run test:closing
import { calculateAmortizationSchedule } from "../../engine/CalculationEngine.js";
import { reconcileContractForCompetencia } from "./closingEngine.js";

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
];

for (const c of cases) {
  console.log(`\n== ${c.name}`);
  const result = await calculateAmortizationSchedule(c.params);
  const schedule = result.schedule;
  const contract = {
    id: "t", contract_number: "T", operation_category: "emprestimos", operation_date: c.params.operationDate,
    iof_value: c.params.iofValue, other_fees: c.params.otherFees, schedule_data: JSON.stringify({ schedule }),
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

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log("\nclosing ok");
