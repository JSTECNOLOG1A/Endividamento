// Posição de abertura da Implantação de Saldos (sem banco). Rodar: npm run test:deployment
import { calculateAmortizationSchedule } from "../../engine/CalculationEngine.js";
import { computeDeploymentPosition, isLastDayOfMonthIso } from "./deploymentPosition.js";

const r2 = (v) => Math.round(v * 100) / 100;
let failures = 0;
const check = (label, cond, extra = "") => {
  if (!cond) failures += 1;
  console.log(`${cond ? "PASS" : "FAIL"} - ${label}${extra ? ` | ${extra}` : ""}`);
};

check("data-base só aceita último dia do mês", isLastDayOfMonthIso("2026-08-31") && isLastDayOfMonthIso("2028-02-29") && !isLastDayOfMonthIso("2026-08-30") && !isLastDayOfMonthIso("2026-8-31"));

const base = {
  signalValue: 70000, iofValue: 4931.9, iofFinanced: true, otherFees: 3233.33, otherFeesFinanced: true,
  encargoGarantiaValue: 0, encargoGarantiaFinanced: false, indexer: "NA", indexerSpread: 0, interestDayCountConvention: "dias_corridos_360",
  principalGraceMonths: 0, interestGraceMonths: 0, graceAction: "capitalizar", cdiRates: [], holidays: [], percentageBase: "saldo_devedor", exchangeLag: 1, exchangeRates: [],
  operationValue: 370000, fixedRate: 14.07, operationDate: "2024-03-05", firstPaymentDate: "2024-04-05", first_payment_date: "2024-04-05",
  principalInstallments: 36, interestInstallments: 36, principalFrequency: 1, interestFrequency: 1,
  calculationSystem: "PRICE", totalTermMonths: 36, finalMaturityDate: "2027-03-05", graceInterestBehavior: "PAGAR",
};
const { schedule } = await calculateAmortizationSchedule(base);
const contract = { id: "t", contract_number: "PILOTO", operation_date: "2024-03-05", schedule_data: JSON.stringify({ schedule }) };
const CUT = "2026-08-31";
const lastBefore = schedule.filter((r) => r.dataVencimento <= CUT).at(-1);

console.log("\n== Piloto na data-base (todas as parcelas até 31/08 pagas)");
const a = computeDeploymentPosition(contract, CUT, []);
check("principal total = saldo da última parcela até a data-base", Math.abs(a.position.principalTotal - lastBefore.sdFinal) < 0.1, `${a.position.principalTotal} x ${lastBefore.sdFinal}`);
check("nada vencido em aberto", a.position.principalVencido === 0 && a.position.jurosVencido === 0);
check("contrato dentro de 12 meses: tudo circulante", a.position.principalLP === 0 && a.position.jurosLP === 0 && Math.abs(a.position.principalCP - a.position.principalTotal) < 0.01);
check("juros a pagar apropriados até a data-base (pro rata)", a.position.jurosTotal > 0 && a.position.jurosTotal < schedule.find((r) => r.dataVencimento > CUT).jurosPagos, `${a.position.jurosTotal}`);
check("total = principal + juros", Math.abs(a.position.total - (a.position.principalTotal + a.position.jurosTotal)) < 0.02);
check("lista as parcelas até a data-base para marcação", a.parcelasAteDataBase.length === schedule.filter((r) => r.dataVencimento <= CUT).length);

console.log("\n== Parcela 29 vencida e não paga");
const open = String(lastBefore.parcela);
const b = computeDeploymentPosition(contract, CUT, [open]);
check("principal total soma a amortização não paga", Math.abs(b.position.principalTotal - (a.position.principalTotal + lastBefore.amortizacao)) < 0.05, `${b.position.principalTotal}`);
check("principal vencido = amortização da parcela em aberto (sem duplicar)", Math.abs(b.position.principalVencido - lastBefore.amortizacao) < 0.05, `${b.position.principalVencido}`);
check("vencido conta no circulante", Math.abs(b.position.principalCP - b.position.principalTotal) < 0.01);
check("juros vencidos = juros da parcela em aberto", Math.abs(b.position.jurosVencido - lastBefore.jurosPagos) < 0.05, `${b.position.jurosVencido}`);
check("parcela marcada aparece como em aberto", b.parcelasAteDataBase.find((p) => String(p.parcela) === open)?.emAberto === true);

console.log("\n== Contrato longo: separação circulante / não circulante");
const longP = { ...base, operationValue: 1000000, signalValue: 0, iofValue: 0, otherFees: 0, iofFinanced: false, otherFeesFinanced: false, fixedRate: 12,
  operationDate: "2026-01-05", firstPaymentDate: "2026-02-05", first_payment_date: "2026-02-05", principalInstallments: 60, interestInstallments: 60,
  totalTermMonths: 60, finalMaturityDate: "2031-01-05", calculationSystem: "SAC" };
const long = await calculateAmortizationSchedule(longP);
const lc = { id: "l", contract_number: "LONGO", operation_date: "2026-01-05", schedule_data: JSON.stringify({ schedule: long.schedule }) };
const l = computeDeploymentPosition(lc, CUT, []);
const within12 = long.schedule.filter((r) => r.dataVencimento > CUT && r.dataVencimento <= "2027-08-31").reduce((s, r) => s + r.amortizacao, 0);
check("circulante = amortizações que vencem até data-base + 12 meses", Math.abs(l.position.principalCP - within12) < 0.1, `${l.position.principalCP} x ${r2(within12)}`);
check("não circulante = o restante", l.position.principalLP > 0 && Math.abs(l.position.principalCP + l.position.principalLP - l.position.principalTotal) < 0.01);

console.log("\n== Sem duplicidade e sem efeito colateral");
const again = computeDeploymentPosition(contract, CUT, []);
check("mesma entrada, mesma posição (reprodutível)", JSON.stringify(again.position) === JSON.stringify(a.position));
check("não altera o cronograma do contrato", contract.schedule_data === JSON.stringify({ schedule }));

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log("\ndeployment ok");
