// Invariantes do fechamento contábil (sem banco): juros por competência, liberação/IOF/custo na data
// da operação, capitalização e regra de baixa efetiva. Rodar: npm run test:closing
import { calculateAmortizationSchedule } from "../../engine/CalculationEngine.js";
import { reconcileContractForCompetencia, buildOpeningEntries, calculateClosingReconciliation, fxRateOn, buildJournalEntries, lastBusinessDayOnOrBefore, canApproveClosing } from "./closingEngine.js";
import { competenciaEmSaoPaulo, todayInSaoPaulo } from "./saoPaulo.js";
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

// ---------------------------------------------------------------------------------------------
console.log("== Moeda estrangeira: remensuração do passivo pela PTAX de fechamento (CPC 02)");
{
  // Cronograma calculado com a PTAX projetada/antiga (a tabela "variavel"); o fechamento usa OUTRA série (a real de cada data).
  const sched = (await calculateAmortizationSchedule({ ...usdBase, exchangeRates: ptaxTable("variavel") })).schedule;
  const mkU = (extra = {}) => ({ id: "u", contract_number: "USD", operation_category: "emprestimos", operation_date: usdBase.operationDate,
    amount_foreign: usdBase.amount_foreign, schedule_data: JSON.stringify({ schedule: sched }), currency_id: "cur_usd", ...extra });
  // PTAX real de fechamento: série diária diferente da usada no cronograma
  const fxList = [];
  for (let t = new Date(Date.UTC(2023, 0, 2)); t < new Date(Date.UTC(2032, 11, 31)); t = new Date(t.getTime() + 86400000)) {
    const i = Math.round((t - new Date(Date.UTC(2023, 0, 2))) / 86400000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    fxList.push({ rate_date: t.toISOString().slice(0, 10), rate: r2(4.9 + 0.9 * Math.sin(i / 31) + 0.0003 * i) });
  }
  const fxRates = { cur_usd: fxList };
  const opts = { fxRates, today: "2040-01-01" };
  const start = new Date(usdBase.operationDate + "T12:00:00");
  const last = new Date(sched.at(-1).dataVencimento + "T12:00:00");
  const months = (last.getFullYear() - start.getFullYear()) * 12 + last.getMonth() - start.getMonth() + 2;

  // razão do passivo (principal + juros) mês a mês: abertura + movimentos = saldo em moeda × PTAX de fechamento
  let ledger = 0, chain = true, maxGap = 0, allFxRemeasured = true, prevClose = null, tail = null, fxEvents = 0;
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const rec = reconcileContractForCompetencia(mkU(), d.getFullYear(), d.getMonth() + 1, [], opts);
    const sum = (types) => rec.events.filter((e) => types.includes(e.type)).reduce((t, e) => t + e.amount, 0);
    ledger += sum(["liberacao", "juros_apropriados", "variacao_cambial_passiva"]) - sum(["pagamento_principal", "pagamento_juros", "variacao_cambial_ativa"]);
    const closeTotal = rec.closing.principal + rec.closing.interest;
    maxGap = Math.max(maxGap, Math.abs(ledger - closeTotal));
    if (prevClose !== null && Math.abs(prevClose - (rec.opening.principal + rec.opening.interest)) > 0.05) chain = false;
    const fx = rec.events.filter((e) => e.type.startsWith("variacao_cambial"));
    fxEvents += fx.length;
    if (fx.some((e) => !e.remeasurement)) allFxRemeasured = false;
    prevClose = closeTotal;
    tail = rec;
  }
  check("USD: razão do passivo (abertura + movimentos + variação cambial) = saldo em moeda × PTAX, todos os meses", maxGap < 0.1, "maior diferença " + maxGap.toFixed(4));
  check("USD: abertura de cada mês = fechamento do mês anterior", chain);
  check("USD: só há variação cambial de remensuração (a projetada e a realizada do cronograma saem)", allFxRemeasured && fxEvents > 0, "eventos " + fxEvents);
  check("USD: no fim do contrato o passivo zera", Math.abs(tail.closing.principal) < 0.2 && Math.abs(tail.closing.interest) < 0.2, JSON.stringify(tail.closing));

  // o saldo de fechamento é o saldo em moeda da linha × a PTAX do último dia do mês (não a do cronograma)
  const row = sched.filter((r) => r.dataVencimento <= "2026-03-31").at(-1);
  const rec = reconcileContractForCompetencia(mkU(), 2026, 3, [], opts);
  const ptax = fxRateOn(fxList, "2026-03-31");
  check("USD: principal de fechamento = saldo em USD × PTAX de 31/03", Math.abs(rec.closing.principal - r2(row.sdFinal_USD * ptax.rate)) < 0.5, `${rec.closing.principal} x ${r2(row.sdFinal_USD * ptax.rate)}`);
  check("USD: registra a PTAX e a data usadas", rec.remeasurement && rec.remeasurement.ptax === ptax.rate && rec.remeasurement.ptaxDate === ptax.date);
  const fxEv = rec.events.find((e) => e.type.startsWith("variacao_cambial"));
  check("USD: evento de câmbio datado no fim do mês, com PTAX no evento", !fxEv || (fxEv.date === "2026-03-31" && fxEv.ptax === ptax.rate));

  // fim de semana: vale a última cotação publicada; sem cotação recente: avisa e não usa taxa antiga
  check("PTAX de fim de semana usa a última publicada", fxRateOn(fxList, "2026-05-31").date === "2026-05-29");
  check("PTAX sem cotação nos 7 dias anteriores não é usada", fxRateOn([{ rate_date: "2026-01-02", rate: 5 }], "2026-03-31") === null);
  const semPtax = reconcileContractForCompetencia(mkU(), 2026, 3, [], { fxRates: { cur_usd: [{ rate_date: "2020-01-02", rate: 5 }] }, today: "2040-01-01" });
  check("sem PTAX de fechamento: avisa (ptax_ausente) e mantém o cronograma", semPtax.fxIssues.some((f) => f.type === "ptax_ausente") && !semPtax.remeasurement);
  const antiga = reconcileContractForCompetencia(mkU(), 2026, 3);
  check("sem cotações informadas, o comportamento anterior é o mesmo", antiga.events.every((e) => !e.remeasurement) && antiga.fxIssues.length === 0);

  // mês em andamento: usa a última cotação disponível e sinaliza como provisório
  const prov = reconcileContractForCompetencia(mkU(), 2026, 3, [], { fxRates, today: "2026-03-15" });
  check("mês em andamento: PTAX provisória (última publicada) e aviso", prov.remeasurement?.provisional === true && prov.remeasurement.ptaxDate <= "2026-03-15" && prov.fxIssues.some((f) => f.type === "ptax_provisoria"));

  // 1º mês sob a regra: o saldo anterior é o que já estava lançado (cronograma), não a PTAX
  const legacy = reconcileContractForCompetencia(mkU(), 2026, 3, [], { ...opts, fxRemeasureFrom: "2026-03-01" });
  const noFx = reconcileContractForCompetencia(mkU(), 2026, 3);
  check("1º mês sob a regra parte do saldo já lançado", Math.abs(legacy.opening.principal - noFx.opening.principal) < 0.01 && Math.abs(legacy.opening.interest - noFx.opening.interest) < 0.01);
  const before = reconcileContractForCompetencia(mkU(), 2026, 2, [], { ...opts, fxRemeasureFrom: "2026-03-01" });
  check("mês anterior à regra segue o cronograma (não remensura)", before.events.every((e) => !e.remeasurement) && !before.remeasurement);

  // implantação: saldo anterior = posição da implantação; a remensuração parte dele
  const CUT = "2026-02-28";
  const dep = mkU({ deployment_mode: true, deployment_cutoff: CUT, deployment_open_parcelas: [] });
  const ptaxCut = fxRateOn(fxList, CUT);
  const posUSD = computeDeploymentPosition(mkU(), CUT, [], { ptax: ptaxCut.rate, ptaxDate: ptaxCut.date }).position;
  const opening = { principal: posUSD.principalTotal, interest: posUSD.jurosTotal };
  const depRec = reconcileContractForCompetencia(dep, 2026, 3, [], { ...opts, deploymentOpening: { u: opening } });
  const dsum = (types) => depRec.events.filter((e) => types.includes(e.type)).reduce((t, e) => t + e.amount, 0);
  const depLedger = opening.principal + opening.interest + dsum(["liberacao", "juros_apropriados", "variacao_cambial_passiva"]) - dsum(["pagamento_principal", "pagamento_juros", "variacao_cambial_ativa"]);
  check("implantação USD: saldo anterior = posição da implantação", Math.abs(depRec.opening.principal - opening.principal) < 0.01 && Math.abs(depRec.opening.interest - opening.interest) < 0.01);
  check("implantação USD: posição + movimentos + câmbio = saldo em moeda × PTAX de fechamento", Math.abs(depLedger - (depRec.closing.principal + depRec.closing.interest)) < 0.1, `${r2(depLedger)} x ${r2(depRec.closing.principal + depRec.closing.interest)}`);

  // reclassificação: a migração para o circulante é medida pela PTAX de fechamento
  const recon = calculateClosingReconciliation([mkU()], new Map(), 2026, 3, "2026-03-31", opts);
  const reclass = recon.aggregatedEvents.find((e) => e.type === "reclassificacao_circulante_principal");
  const semFx = calculateClosingReconciliation([mkU()], new Map(), 2026, 3, "2026-03-31", {});
  const reclassOld = semFx.aggregatedEvents.find((e) => e.type === "reclassificacao_circulante_principal");
  check("reclassificação em USD segue a PTAX de fechamento (não a do cronograma)", !reclass || !reclassOld || Math.abs(reclass.amount - reclassOld.amount) > 0.5 || Math.abs(ptax.rate - 5) < 0.05, reclass ? `${reclass.amount} x ${reclassOld?.amount}` : "sem reclassificação no mês");
}

// ---------------------------------------------------------------------------------------------
console.log("== Ajuste de provisão de juros: cronograma recalculado com as taxas publicadas");
{
  const sacParams = (rate) => ({ ...base, operationValue: 1200000, fixedRate: rate, operationDate: "2026-01-05", firstPaymentDate: "2026-02-05", first_payment_date: "2026-02-05",
    principalInstallments: 24, interestInstallments: 24, principalFrequency: 1, interestFrequency: 1, calculationSystem: "SAC", totalTermMonths: 24, finalMaturityDate: "2028-01-05", graceInterestBehavior: "PAGAR" });
  const schedOf = async (rate) => (await calculateAmortizationSchedule(sacParams(rate))).schedule;
  const mkC = (schedule, extra = {}) => ({ id: "ix", contract_number: "INDEXADO", operation_category: "emprestimos", operation_date: "2026-01-05", schedule_data: JSON.stringify({ schedule }), ...extra });
  const projected = await schedOf(12);   // fotografia: última taxa conhecida repetida
  const real = await schedOf(15);        // taxa publicada depois: mais alta
  const sumEv = (rec, types) => rec.events.filter((e) => types.includes(e.type)).reduce((t, e) => t + e.amount, 0);

  // maio fechado com a projeção; junho recalculado com a taxa real
  const may = reconcileContractForCompetencia(mkC(projected), 2026, 5);
  const ledgerPrev = { ix: { principal: may.closing.principal, interest: may.closing.interest } };
  const junUp = reconcileContractForCompetencia(mkC(real), 2026, 6, [], { trueUpContracts: { ix: true }, ledgerPrev });
  const adj = junUp.events.find((e) => e.type === "ajuste_provisao_juros");
  const engineOpen = reconcileContractForCompetencia(mkC(real), 2026, 6).opening;
  check("indexado: taxa real maior gera ajuste de provisão (aumento) no mês corrente", adj && adj.direction === "aumento" && adj.date === "2026-06-30", JSON.stringify(adj));
  check("indexado: ajuste = provisão pelas taxas publicadas − provisão já lançada", adj && Math.abs(adj.amount - r2(engineOpen.interest - ledgerPrev.ix.interest)) < 0.02, adj ? `${adj.amount} x ${r2(engineOpen.interest - ledgerPrev.ix.interest)}` : "sem ajuste");
  const ledgerInterestEnd = ledgerPrev.ix.interest + sumEv(junUp, ["juros_apropriados", "ajuste_provisao_juros"]) - sumEv(junUp, ["pagamento_juros"]);
  check("indexado: juros a pagar lançados (anterior + provisão + ajuste − pagamentos) = juros do cronograma recalculado", Math.abs(ledgerInterestEnd - junUp.closing.interest) < 0.05, `${r2(ledgerInterestEnd)} x ${junUp.closing.interest}`);
  check("indexado: saldo anterior do fechamento é o saldo lançado", Math.abs(junUp.opening.interest - ledgerPrev.ix.interest) < 0.01);
  check("indexado SAC: sem diferença de principal, nada a sinalizar", !junUp.fxIssues.some((f) => f.type === "principal_recalculado"));

  // taxa real menor: reduz a provisão (o lançamento inverte débito e crédito)
  const mayHigh = reconcileContractForCompetencia(mkC(real), 2026, 5);
  const junDown = reconcileContractForCompetencia(mkC(projected), 2026, 6, [], { trueUpContracts: { ix: true }, ledgerPrev: { ix: { principal: mayHigh.closing.principal, interest: mayHigh.closing.interest } } });
  const adjDown = junDown.events.find((e) => e.type === "ajuste_provisao_juros");
  check("indexado: taxa real menor reduz a provisão", adjDown && adjDown.direction === "reducao");
  const mappings = ["juros_apropriados", "ajuste_provisao_juros", "pagamento_juros", "pagamento_principal", "reclassificacao_circulante_principal"].map((event_type) => ({ event_type, operation_category: "emprestimos", debit_account_id: "DESPESA", credit_account_id: "PROVISAO", status: "ativo" }));
  const recon = calculateClosingReconciliation([mkC(projected)], new Map(), 2026, 6, "2026-06-30", { trueUpContracts: { ix: true }, ledgerPrev: { ix: { principal: mayHigh.closing.principal, interest: mayHigh.closing.interest } } });
  const journal = buildJournalEntries(recon, mappings, "2026-06-30");
  const adjEntries = journal.entries.filter((e) => e.event_type === "ajuste_provisao_juros");
  check("redução da provisão: débito na provisão e crédito na despesa (invertido)", adjEntries.length === 2 && adjEntries.find((e) => e.side === "debito")?.account_id === "PROVISAO" && adjEntries.find((e) => e.side === "credito")?.account_id === "DESPESA");
  const recon2 = calculateClosingReconciliation([mkC(real)], new Map(), 2026, 6, "2026-06-30", { trueUpContracts: { ix: true }, ledgerPrev });
  const adjUp = buildJournalEntries(recon2, mappings, "2026-06-30").entries.filter((e) => e.event_type === "ajuste_provisao_juros");
  check("aumento da provisão: débito na despesa e crédito na provisão", adjUp.find((e) => e.side === "debito")?.account_id === "DESPESA" && adjUp.find((e) => e.side === "credito")?.account_id === "PROVISAO");

  // sem saldo lançado anterior (início do acompanhamento) ou contrato não indexado: nada muda
  const semPrev = reconcileContractForCompetencia(mkC(real), 2026, 6, [], { trueUpContracts: { ix: true } });
  check("sem saldo lançado anterior não há ajuste", !semPrev.events.some((e) => e.type === "ajuste_provisao_juros"));
  const naoIndexado = reconcileContractForCompetencia(mkC(real), 2026, 6, [], { ledgerPrev });
  check("contrato fora da lista de ajuste não gera o evento", !naoIndexado.events.some((e) => e.type === "ajuste_provisao_juros"));
  const igual = reconcileContractForCompetencia(mkC(projected), 2026, 6, [], { trueUpContracts: { ix: true }, ledgerPrev });
  check("taxa real igual à projetada: sem ajuste", !igual.events.some((e) => e.type === "ajuste_provisao_juros"));
  check("reprocessar mantém a chave do evento (idempotência)", JSON.stringify(reconcileContractForCompetencia(mkC(real), 2026, 6, [], { trueUpContracts: { ix: true }, ledgerPrev }).events.map((e) => e.key)) === JSON.stringify(junUp.events.map((e) => e.key)));

  // implantação: a posição aprovada é o saldo lançado; o ajuste parte dela
  const CUT = "2026-05-31";
  const posInterest = may.closing.interest;
  const dep = mkC(real, { deployment_mode: true, deployment_cutoff: CUT, deployment_open_parcelas: [] });
  const depRec = reconcileContractForCompetencia(dep, 2026, 6, [], { trueUpContracts: { ix: true }, deploymentOpening: { ix: { principal: may.closing.principal, interest: posInterest } } });
  const depAdj = depRec.events.find((e) => e.type === "ajuste_provisao_juros");
  check("implantação indexada: saldo anterior = posição e o ajuste parte dela", Math.abs(depRec.opening.interest - posInterest) < 0.01 && depAdj && depAdj.direction === "aumento");

  // PRICE: a parcela muda com a taxa, então o principal recalculado difere do lançado — sinaliza sem lançar
  const priceOf = async (rate) => (await calculateAmortizationSchedule({ ...sacParams(rate), calculationSystem: "PRICE" })).schedule;
  const pMay = reconcileContractForCompetencia(mkC(await priceOf(12)), 2026, 5);
  const pJun = reconcileContractForCompetencia(mkC(await priceOf(15)), 2026, 6, [], { trueUpContracts: { ix: true }, ledgerPrev: { ix: { principal: pMay.closing.principal, interest: pMay.closing.interest } } });
  check("PRICE indexado: diferença de principal recalculado é sinalizada", pJun.fxIssues.some((f) => f.type === "principal_recalculado"));
}

// ---------------------------------------------------------------------------------------------
console.log("== Fuso de São Paulo e PTAX do último dia útil");
{
  // 22:00 de 30/09 em Brasília é 01:00 de 01/10 em UTC: a competência é setembro, não outubro
  const at = (iso) => new Date(iso);
  check("22:00 de 30/09 em Brasília (01:00Z de 01/10): a competência é setembro", competenciaEmSaoPaulo(at("2026-10-01T01:00:00Z")).month === 9 && todayInSaoPaulo(at("2026-10-01T01:00:00Z")) === "2026-09-30");
  check("competência traz início e fim do mês", (() => { const c = competenciaEmSaoPaulo(at("2026-10-01T01:00:00Z")); return c.start === "2026-09-01" && c.end === "2026-09-30" && c.year === 2026; })());
  check("meio-dia em Brasília: mesmo dia", todayInSaoPaulo(at("2026-05-31T15:00:00Z")) === "2026-05-31");
  check("02:59Z de 01/06 ainda é 31/05 em Brasília", competenciaEmSaoPaulo(at("2026-06-01T02:59:00Z")).month === 5);
  check("03:00Z de 01/06 já é junho em Brasília", competenciaEmSaoPaulo(at("2026-06-01T03:00:00Z")).month === 6);

  check("último dia útil: domingo 31/05 -> sexta 29/05", lastBusinessDayOnOrBefore("2026-05-31") === "2026-05-29");
  check("último dia útil: dia útil é ele mesmo", lastBusinessDayOnOrBefore("2026-03-31") === "2026-03-31");
  check("último dia útil: feriado na sexta -> quinta", lastBusinessDayOnOrBefore("2026-05-31", ["2026-05-29"]) === "2026-05-28");

  // contrato USD e cotações: a última carregada precisa ser a do último dia útil
  const sched = (await calculateAmortizationSchedule({ ...usdBase, exchangeRates: ptaxTable("variavel") })).schedule;
  const mkU = () => ({ id: "u", contract_number: "USD", operation_category: "emprestimos", operation_date: usdBase.operationDate, amount_foreign: usdBase.amount_foreign,
    schedule_data: JSON.stringify({ schedule: sched }), currency_id: "cur_usd" });
  const daily = (until) => { const l = []; for (let t = new Date(Date.UTC(2023, 0, 2)); t <= new Date(until + "T00:00:00Z"); t = new Date(t.getTime() + 86400000)) { if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue; l.push({ rate_date: t.toISOString().slice(0, 10), rate: 5.1 }); } return l; };
  const run = (until, extra = {}) => reconcileContractForCompetencia(mkU(), 2026, 3, [], { fxRates: { cur_usd: daily(until) }, today: "2026-04-05", ...extra });

  const ok31 = run("2026-03-31");
  check("PTAX do último dia útil carregada: sem aviso", !ok31.fxIssues.some((f) => f.type === "ptax_defasada"));
  const late = run("2026-03-30");
  const lateIssue = late.fxIssues.find((f) => f.type === "ptax_defasada");
  check("PTAX do último dia útil ausente (só a do dia anterior): aviso de defasagem", lateIssue && lateIssue.esperada === "2026-03-31" && lateIssue.usada === "2026-03-30", JSON.stringify(lateIssue));
  const holidayOk = run("2026-03-30", { holidays: ["2026-03-31"] });
  check("feriado no último dia: a PTAX do dia útil anterior basta", !holidayOk.fxIssues.some((f) => f.type === "ptax_defasada"));
  const weekend = reconcileContractForCompetencia(mkU(), 2026, 5, [], { fxRates: { cur_usd: daily("2026-05-29") }, today: "2026-06-05" });
  check("mês termina em domingo: a de sexta basta", !weekend.fxIssues.some((f) => f.type === "ptax_defasada"));
  const prov = run("2026-03-19", { today: "2026-03-20" });
  check("competência em andamento: provisória, sem exigir a do último dia", !prov.fxIssues.some((f) => f.type === "ptax_defasada") && prov.remeasurement?.provisional === true);

  // o gate: não aprova (nem posta) com a PTAX de fechamento faltando
  const recon = (until) => calculateClosingReconciliation([mkU()], new Map(), 2026, 3, "2026-03-31", { fxRates: { cur_usd: daily(until) }, today: "2026-04-05" });
  const gate = (until) => canApproveClosing({ journalResult: { balanced: true, missingMappings: [] }, reconciliation: recon(until), previousClosingApproved: true, hasUnresolvedSettlementBlockers: false });
  const gLate = gate("2026-03-30");
  check("PTAX defasada: o fechamento não pode ser aprovado", !gLate.canApprove && gLate.reasons.some((r) => r.includes("PTAX de fechamento")), gLate.reasons.join(" | "));
  check("PTAX do último dia útil carregada: o gate libera", gate("2026-03-31").canApprove);
  const gNone = canApproveClosing({ journalResult: { balanced: true, missingMappings: [] }, reconciliation: calculateClosingReconciliation([mkU()], new Map(), 2026, 3, "2026-03-31", { fxRates: { cur_usd: [{ rate_date: "2020-01-02", rate: 5 }] }, today: "2026-04-05" }), previousClosingApproved: true, hasUnresolvedSettlementBlockers: false });
  check("sem nenhuma cotação recente: também bloqueia", !gNone.canApprove);
}

// ---------------------------------------------------------------------------------------------
console.log("== Custo de transação amortizado (CPC 08 (R1), item 12 — simplificação em linha reta)");
{
  const feeParams = { ...base, operationValue: 370000, otherFees: 12000, fixedRate: 12, operationDate: "2026-01-05", firstPaymentDate: "2026-02-05", first_payment_date: "2026-02-05",
    principalInstallments: 12, interestInstallments: 12, principalFrequency: 1, interestFrequency: 1, calculationSystem: "SAC",
    totalTermMonths: 12, finalMaturityDate: "2027-01-05", graceInterestBehavior: "PAGAR" };
  const { schedule } = await calculateAmortizationSchedule(feeParams);
  const mk = (extra = {}) => ({ id: "ct", contract_number: "CT", operation_category: "emprestimos", operation_date: feeParams.operationDate,
    other_fees: feeParams.otherFees, schedule_data: JSON.stringify({ schedule }), ...extra });

  // padrão (sem a flag, ou "imediato"): comportamento de sempre — tudo no ato, nada de apropriação
  const imediato = reconcileContractForCompetencia(mk(), 2026, 1);
  check("sem a política (undefined): continua 100% no ato, como antes", imediato.events.some((e) => e.type === "custo_transacao_inicial" && e.amount === feeParams.otherFees) && !imediato.events.some((e) => e.type === "custo_transacao_diferido" || e.type === "custo_transacao_apropriacao"));
  const explicitoImediato = reconcileContractForCompetencia(mk({ transaction_cost_recognition: "imediato" }), 2026, 1);
  check("\"imediato\" explícito: mesmo resultado", JSON.stringify(explicitoImediato.events) === JSON.stringify(imediato.events));

  // amortizado: no desembolso vai para o diferido, não para despesa
  const amort = mk({ transaction_cost_recognition: "amortizado" });
  const jan = reconcileContractForCompetencia(amort, 2026, 1);
  check("amortizado: no desembolso vai para custo_transacao_diferido (não custo_transacao_inicial)", jan.events.some((e) => e.type === "custo_transacao_diferido" && e.amount === feeParams.otherFees) && !jan.events.some((e) => e.type === "custo_transacao_inicial"));
  check("amortizado: já apropria uma fração no mês do desembolso (linha reta desde o dia da liberação)", jan.events.some((e) => e.type === "custo_transacao_apropriacao" && e.amount > 0));

  // soma das apropriações mensais = o total do custo, no fim do prazo
  const start = new Date(feeParams.operationDate + "T12:00:00");
  const last = new Date(schedule.at(-1).dataVencimento + "T12:00:00");
  const months = (last.getFullYear() - start.getFullYear()) * 12 + last.getMonth() - start.getMonth() + 2;
  let totalApropriado = 0, diferidoCount = 0;
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const rec = reconcileContractForCompetencia(amort, d.getFullYear(), d.getMonth() + 1);
    totalApropriado += rec.events.filter((e) => e.type === "custo_transacao_apropriacao").reduce((s2, e) => s2 + e.amount, 0);
    diferidoCount += rec.events.filter((e) => e.type === "custo_transacao_diferido").length;
  }
  check("amortizado: a soma das apropriações mensais fecha no total do custo", Math.abs(totalApropriado - feeParams.otherFees) < 0.05, `${totalApropriado} x ${feeParams.otherFees}`);
  check("amortizado: o diferido é lançado uma única vez (no desembolso)", diferidoCount === 1);

  // quitação antecipada no meio do prazo: reconhece de uma vez o saldo restante, na data da baixa
  const payoffIso = schedule[5].dataVencimento; // sexto vencimento, no meio do prazo de 12 meses
  const quitado = mk({ transaction_cost_recognition: "amortizado", payoff_date: payoffIso });
  const [py, pm] = payoffIso.split("-").map(Number);
  const rec = reconcileContractForCompetencia(quitado, py, pm);
  const evQuitacao = rec.events.find((e) => e.type === "custo_transacao_apropriacao");
  check("quitação antecipada: o evento de apropriação cai na data real da baixa, não no fim do mês", evQuitacao && evQuitacao.date === payoffIso, JSON.stringify(evQuitacao));
  let acumuladoAntes = 0;
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    if (d.getFullYear() > py || (d.getFullYear() === py && d.getMonth() + 1 >= pm)) break;
    acumuladoAntes += reconcileContractForCompetencia(quitado, d.getFullYear(), d.getMonth() + 1).events.filter((e) => e.type === "custo_transacao_apropriacao").reduce((s2, e) => s2 + e.amount, 0);
  }
  check("quitação antecipada: reconhece de uma vez o saldo ainda não apropriado (não continua o rateio)", evQuitacao && Math.abs(evQuitacao.amount - (feeParams.otherFees - acumuladoAntes)) < 0.05, `${evQuitacao?.amount} x ${r2(feeParams.otherFees - acumuladoAntes)}`);
  const depoisDaQuitacao = reconcileContractForCompetencia(quitado, py, pm + 2 <= 12 ? pm + 2 : 12);
  check("mês seguinte à quitação: nada mais é apropriado (o contrato já saiu da conciliação)", depoisDaQuitacao.events.length === 0);

  // sem custo de transação: a flag não gera nenhum evento, mesmo marcada como "amortizado"
  const semCusto = reconcileContractForCompetencia(mk({ other_fees: 0, transaction_cost_recognition: "amortizado" }), 2026, 1);
  check("sem custo de transação: nenhum evento de diferido ou apropriação", !semCusto.events.some((e) => e.type.startsWith("custo_transacao_diferido") || e.type === "custo_transacao_apropriacao"));

  // chave de evento estável (idempotência) também para a apropriação
  const a1 = reconcileContractForCompetencia(amort, 2026, 3).events.filter((e) => e.type === "custo_transacao_apropriacao").map((e) => e.key);
  const a2 = reconcileContractForCompetencia(amort, 2026, 3).events.filter((e) => e.type === "custo_transacao_apropriacao").map((e) => e.key);
  check("reprocessar a apropriação gera a mesma chave (idempotência)", JSON.stringify(a1) === JSON.stringify(a2) && a1.every(Boolean) && a1.length > 0);
}

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log("\nclosing ok");
