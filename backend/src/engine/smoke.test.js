import { calculateAmortizationSchedule, ENGINE_VERSION, ENGINE_BUILD_ID } from "./CalculationEngine.js";

const result = await calculateAmortizationSchedule({
  operationValue: 100000,
  fixedRate: 1.5,
  operationDate: "2026-01-15",
  firstPaymentDate: "2026-02-15",
  principalInstallments: 12,
  interestInstallments: 12,
  principalFrequency: "1",
  interestFrequency: "1",
  calculationSystem: "PRICE",
  principalGraceMonths: 0,
  interestGraceMonths: 0,
  indexer: "NA",
  cdiRates: [],
  holidays: [],
});

if (!Array.isArray(result.schedule) || result.schedule.length === 0) {
  throw new Error("smoke: schedule vazio");
}

const lastRow = result.schedule[result.schedule.length - 1];
if (!Number.isFinite(lastRow.sdFinal) || Math.abs(lastRow.sdFinal) >= 0.10) {
  throw new Error(`smoke: saldo final inválido (${lastRow.sdFinal})`);
}

const totalAmort = result.schedule.reduce((sum, row) => sum + row.amortizacao, 0);
if (Math.abs(totalAmort - result.principal) >= 1) {
  throw new Error(`smoke: amortização divergente (${totalAmort} vs ${result.principal})`);
}

// Dia de referência se repete no calendário (não é data + 30/31).
// 10/04/2026 = sexta; 10/05/2026 = domingo → 11/05; 10/06/2026 = feriado → 11/06.
const anchored = await calculateAmortizationSchedule({
  operationValue: 100000,
  fixedRate: 1.5,
  operationDate: "2026-03-15",
  firstPaymentDate: "2026-04-10",
  principalInstallments: 3,
  interestInstallments: 3,
  principalFrequency: "1",
  interestFrequency: "1",
  calculationSystem: "PRICE",
  principalGraceMonths: 0,
  interestGraceMonths: 0,
  indexer: "NA",
  cdiRates: [],
  holidays: [{ holiday_date: "2026-06-10" }],
  totalTermMonths: 3,
});

const dates = anchored.schedule.map((row) => row.dataVencimento);
const expected = ["2026-04-10", "2026-05-11", "2026-06-11"];
if (dates.join(",") !== expected.join(",")) {
  throw new Error(`smoke: datas ancoradas inválidas (${dates.join(", ")} vs ${expected.join(", ")})`);
}
if (dates.some((d) => d.endsWith("-15"))) {
  throw new Error("smoke: dia da operação vazou para o vencimento (não deve somar 30/31 dias)");
}

console.log(`engine smoke OK ${ENGINE_VERSION} ${ENGINE_BUILD_ID} parcelas=${result.schedule.length} datas=${dates.join(",")}`);
