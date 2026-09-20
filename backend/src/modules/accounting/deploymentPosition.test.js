// Posição de abertura da Implantação de Saldos (sem banco). Rodar: npm run test:deployment
import { calculateAmortizationSchedule } from "../../engine/CalculationEngine.js";
import { computeDeploymentPosition, isLastDayOfMonthIso } from "./deploymentPosition.js";
import { reconcileContractForCompetencia } from "./closingEngine.js";

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

console.log("\n== Contrato em USD: posição em reais pela PTAX da data-base");
const usdRates = [];
for (let t = new Date(Date.UTC(2024, 0, 2)); t < new Date(Date.UTC(2028, 0, 1)); t = new Date(t.getTime() + 86400000)) {
  const i = Math.round((t - new Date(Date.UTC(2024, 0, 2))) / 86400000);
  usdRates.push({ rate_date: t.toISOString().slice(0, 10), ptax_rate: r2(5 + 0.0007 * i), source: "teste" });
}
const usdParams = { ...base, operationValue: 1000000, currencyId: "cur_usd", amount_foreign: 200000, exchange_rate_closing: 5, exchangeLag: 1, exchangeRates: usdRates,
  fixedRate: 8, operationDate: "2024-01-10", firstPaymentDate: "2024-02-10", first_payment_date: "2024-02-10", principalInstallments: 36, interestInstallments: 36,
  principalFrequency: 1, interestFrequency: 1, calculationSystem: "SAC", totalTermMonths: 36, finalMaturityDate: "2027-01-10", graceInterestBehavior: "PAGAR" };
const usd = await calculateAmortizationSchedule(usdParams);
const usdContract = { id: "u", contract_number: "USD", operation_date: "2024-01-10", currency_id: "cur_usd", amount_foreign: 200000, schedule_data: JSON.stringify({ schedule: usd.schedule }) };
const lastUsd = usd.schedule.filter((r) => r.dataVencimento <= CUT).at(-1);
const PTAX = 5.4321;
const u = computeDeploymentPosition(usdContract, CUT, [], { ptax: PTAX, ptaxDate: "2026-08-31" });
check("USD: principal em reais = saldo em USD da última parcela × PTAX da data-base", Math.abs(u.position.principalTotal - lastUsd.sdFinal_USD * PTAX) < 0.5, `${u.position.principalTotal} x ${r2(lastUsd.sdFinal_USD * PTAX)}`);
check("USD: não usa a PTAX das linhas do cronograma", Math.abs(u.position.principalTotal - lastUsd.sdFinal) > 1);
check("USD: posição em moeda e PTAX registradas", u.ptax === PTAX && Math.abs(u.positionForeign.principalTotal - lastUsd.sdFinal_USD) < 0.1);
check("USD: total = principal + juros e CP + LP = total", Math.abs(u.position.total - (u.position.principalTotal + u.position.jurosTotal)) < 0.02 && Math.abs(u.position.principalCP + u.position.principalLP - u.position.principalTotal) < 0.02);
const u2 = computeDeploymentPosition(usdContract, CUT, [], { ptax: PTAX * 2, ptaxDate: "2026-08-31" });
check("USD: dobrar a PTAX dobra a posição em reais", Math.abs(u2.position.total - 2 * u.position.total) < 0.05);
const uOpen = computeDeploymentPosition(usdContract, CUT, [String(lastUsd.parcela)], { ptax: PTAX });
check("USD: parcela vencida em aberto soma a amortização em USD × PTAX", Math.abs(uOpen.position.principalVencido - lastUsd.amortizacao_USD * PTAX) < 0.05, `${uOpen.position.principalVencido}`);
const noPtax = computeDeploymentPosition(usdContract, CUT, [], {});
check("USD sem PTAX da data-base: sinaliza para bloquear a aprovação", noPtax.missingPtax === true && noPtax.warnings.some((w) => w.includes("PTAX da data-base ausente")));

console.log("\n== USD: o passivo lançado na virada fecha no saldo apurado (ajuste cambial da virada)");
{
  const depContract = { ...usdContract, deployment_mode: true, deployment_cutoff: CUT, deployment_open_parcelas: [] };
  const pos = computeDeploymentPosition(usdContract, CUT, [], { ptax: 5.9, ptaxDate: CUT }).position;
  const opening = { principal: pos.principalTotal, interest: pos.jurosTotal };
  const rec = reconcileContractForCompetencia(depContract, 2026, 9, [], { deploymentOpening: { [usdContract.id]: opening } });
  const sum = (types) => rec.events.filter((e) => types.includes(e.type)).reduce((t, e) => t + e.amount, 0);
  const flows = sum(["juros_apropriados", "variacao_cambial_passiva"]) - sum(["pagamento_principal", "pagamento_juros", "variacao_cambial_ativa"]);
  const closingTotal = rec.closing.principal + rec.closing.interest;
  check("USD: razão (abertura pela PTAX da data-base + movimentos) = saldo do motor", Math.abs(opening.principal + opening.interest + flows - closingTotal) < 0.05, `${r2(opening.principal + opening.interest + flows)} x ${r2(closingTotal)}`);
  const recSem = reconcileContractForCompetencia(depContract, 2026, 9, []);
  check("USD: sem a abertura informada não há ajuste (comportamento anterior)", !recSem.events.some((e) => String(e.key).includes("implantacao-cambial")));
  check("USD: com a abertura há evento de ajuste cambial da virada", rec.events.some((e) => String(e.key).includes("implantacao-cambial")));
}

console.log("\n== Mês da virada: o saldo anterior é a posição da implantação (regra de baixa efetiva desde sempre)");
for (const openParcelas of [[], [String(lastBefore.parcela)]]) {
  const pos = computeDeploymentPosition(contract, CUT, openParcelas).position;
  const opening = { principal: pos.principalTotal, interest: pos.jurosTotal };
  const dep = { ...contract, deployment_mode: true, deployment_cutoff: CUT, deployment_open_parcelas: openParcelas };
  const rec = reconcileContractForCompetencia(dep, 2026, 9, [], { requireSettlementFrom: "1900-01-01", deploymentOpening: { [contract.id]: opening } });
  const label = openParcelas.length ? "com parcela vencida em aberto" : "sem parcela em aberto";
  check(`BRL ${label}: saldo anterior do fechamento = posição da implantação`, Math.abs(rec.opening.principal - opening.principal) < 0.01 && Math.abs(rec.opening.interest - opening.interest) < 0.01, `${rec.opening.principal}/${rec.opening.interest} x ${opening.principal}/${opening.interest}`);
  const sum = (types) => rec.events.filter((e) => types.includes(e.type)).reduce((t, e) => t + e.amount, 0);
  const flows = sum(["juros_apropriados", "variacao_cambial_passiva"]) - sum(["pagamento_principal", "pagamento_juros", "variacao_cambial_ativa"]);
  const closingTotal = rec.closing.principal + rec.closing.interest;
  check(`BRL ${label}: saldo anterior + eventos do mês = saldo final`, Math.abs(opening.principal + opening.interest + flows - closingTotal) < 0.05, `${r2(opening.principal + opening.interest + flows)} x ${r2(closingTotal)}`);
  check(`BRL ${label}: parcelas até a data-base (já na posição) não voltam como pendência`, rec.pendingUnsettled.every((p) => p.dataVencimento > CUT || openParcelas.map(String).includes(String(Number(p.parcela)))));
}

console.log("\n== Sem duplicidade e sem efeito colateral");
const again = computeDeploymentPosition(contract, CUT, []);
check("mesma entrada, mesma posição (reprodutível)", JSON.stringify(again.position) === JSON.stringify(a.position));
check("não altera o cronograma do contrato", contract.schedule_data === JSON.stringify({ schedule }));

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log("\ndeployment ok");
