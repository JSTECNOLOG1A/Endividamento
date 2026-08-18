// 🧮 MOTOR DE FECHAMENTO CONTÁBIL
//
// Camada que fica ENTRE o schedule_data/CalculationSnapshot do contrato
// (que continua sendo a projeção contratual, gerada pelo motor de cálculo
// em @engine/CalculationEngine.js — nada aqui recalcula juros/amortização)
// e os lançamentos contábeis (D/C) de um fechamento mensal por empresa.
//
// Responsabilidades:
// 1) Validar e categorizar uma baixa manual de parcela (Step 1).
// 2) Conciliar abertura → eventos → pagamentos → fechamento por contrato,
//    injetando as baixas reais no lugar da projeção quando existirem
//    (Step 2), reaproveitando a mesma lógica de ledger de
//    getMonthlyRollForward (debtAnalytics.jsx).
// 3) Traduzir os eventos conciliados em lançamentos D/C usando a matriz
//    contábil configurada por empresa (Step 3).
//
// O que este arquivo NUNCA faz: chamar calculateAmortizationSchedule ou
// alterar current_snapshot_id/approved_snapshot_id de um contrato. Quando
// uma baixa diverge do previsto o suficiente para exigir um novo
// cronograma, isso é sinalizado (triggers_recalculation) para o usuário
// resolver pelo fluxo já existente de reabertura do contrato no Simulador
// — o mesmo caminho que já gera snapshots "RECALCULATED" hoje.

export const SETTLEMENT_EVENT_TYPES = {
  LIBERACAO: "liberacao",
  JUROS_APROPRIADOS: "juros_apropriados",
  PAGAMENTO_PRINCIPAL: "pagamento_principal",
  PAGAMENTO_JUROS: "pagamento_juros",
  VARIACAO_CAMBIAL_PASSIVA: "variacao_cambial_passiva",
  VARIACAO_CAMBIAL_ATIVA: "variacao_cambial_ativa",
  TARIFA_BANCARIA: "tarifa_bancaria",
  CUSTO_TRANSACAO_INICIAL: "custo_transacao_inicial",
  CUSTO_TRANSACAO_APROPRIACAO: "custo_transacao_apropriacao",
  RECLASSIFICACAO_CIRCULANTE: "reclassificacao_circulante",
  MULTA_MORA: "multa_mora",
  DESCONTO_FINANCEIRO: "desconto_financeiro",
  AJUSTE_ARREDONDAMENTO: "ajuste_arredondamento",
  OUTROS: "outros",
};

export const EVENT_TYPE_LABELS = {
  liberacao: "Liberação do empréstimo",
  juros_apropriados: "Juros apropriados (competência)",
  pagamento_principal: "Pagamento de principal",
  pagamento_juros: "Pagamento de juros",
  variacao_cambial_passiva: "Variação cambial passiva",
  variacao_cambial_ativa: "Variação cambial ativa",
  tarifa_bancaria: "Tarifa bancária",
  custo_transacao_inicial: "Custo de transação inicial",
  custo_transacao_apropriacao: "Apropriação de custo de transação",
  reclassificacao_circulante: "Reclassificação para circulante",
  multa_mora: "Multa e mora",
  desconto_financeiro: "Desconto financeiro obtido",
  ajuste_arredondamento: "Ajuste de arredondamento / diferença de metodologia",
  outros: "Outros",
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const EPS = 0.01;

/**
 * Limite padrão (R$) acima do qual um "ajuste de arredondamento" deixa de
 * ser tratado como ruído esperado e passa a gerar alerta — sinal de que
 * pode ser parâmetro de contrato errado (taxa, indexador, base de dias),
 * não arredondamento de fato. Configurável por chamada.
 */
export const DEFAULT_ROUNDING_MATERIALITY_THRESHOLD = 50;

/**
 * Soma os componentes em CAIXA de uma baixa (o que de fato saiu do banco).
 * `discount_amount` NÃO entra aqui — é uma remissão não-monetária (o banco
 * perdoou parte da dívida), não um desembolso.
 */
export function sumSettlementCashBuckets(settlement) {
  return r2(
    (settlement.principal_paid || 0) +
    (settlement.interest_paid || 0) +
    (settlement.penalty_paid || 0) +
    (settlement.fee_paid || 0) +
    (settlement.rounding_adjustment || 0) +
    (settlement.other_amount || 0)
  );
}

/**
 * Validações do Step 1 (baixa manual). Retorna { valid, blockers, warnings }.
 * `blockers` impede salvar a baixa; `warnings` só alerta.
 *
 * @param {Object} settlement - dados da baixa em edição
 * @param {Object|null} scheduleRow - linha correspondente do schedule_data
 *   do contrato (para comparar com o previsto), se houver
 * @param {string} dataBase - data-base do fechamento (YYYY-MM-DD)
 */
export function validateSettlement(settlement, scheduleRow, dataBase) {
  const blockers = [];
  const warnings = [];

  const cashSum = sumSettlementCashBuckets(settlement);
  const totalPaid = r2(settlement.total_paid);
  if (Math.abs(cashSum - totalPaid) > EPS) {
    blockers.push(
      `O valor pago (${totalPaid.toFixed(2)}) não bate com a soma dos componentes ` +
      `informados (principal + juros + multa + tarifa + ajuste + outros = ${cashSum.toFixed(2)}).`
    );
  }

  if (!settlement.actual_payment_date) {
    blockers.push("Informe a data efetiva do pagamento.");
  } else if (dataBase && settlement.actual_payment_date > dataBase) {
    blockers.push("A data do pagamento não pode ser posterior à data-base do fechamento.");
  }

  if (!settlement.bank_account_id) {
    warnings.push("Baixa sem conta bancária informada.");
  }

  if ((settlement.discount_amount || 0) > 0) {
    warnings.push(
      "Desconto financeiro informado — isso reduz o saldo devedor e exige recálculo do contrato (não é rotina)."
    );
  }

  if (scheduleRow) {
    const scheduledPrincipal = r2(scheduleRow.amortizacao || 0);
    const scheduledInterest = r2(scheduleRow.jurosPagos ?? ((scheduleRow.jurosFixosMes || 0) + (scheduleRow.jurosVariaveisMes || 0)));
    if ((settlement.principal_paid || 0) > scheduledPrincipal + EPS) {
      warnings.push("Principal pago é maior que o previsto — será tratado como amortização extraordinária.");
    }
    if (totalPaid > scheduledPrincipal + scheduledInterest + EPS &&
        Math.abs((settlement.rounding_adjustment || 0)) < EPS &&
        (settlement.penalty_paid || 0) < EPS && (settlement.fee_paid || 0) < EPS) {
      warnings.push(
        "O valor pago é maior que o previsto e nenhum componente (multa, tarifa, ajuste) explica a diferença. " +
        "Categorize a diferença antes de salvar."
      );
    }
  }

  return { valid: blockers.length === 0, blockers, warnings };
}

/**
 * Decide se uma baixa exige recálculo do cronograma do contrato (evento
 * RECALCULATED, via o fluxo já existente de reabertura no Simulador).
 *
 * Regra: só principal e juros pagos em caixa afetam a trajetória futura do
 * saldo — por isso só eles disparam recálculo. Multa, tarifa, desconto e
 * ajuste de arredondamento são desembolsos/adjustments à parte, que não
 * tocam o saldo do contrato.
 */
export function settlementTriggersRecalculation(settlement, scheduleRow) {
  if ((settlement.discount_amount || 0) > EPS) return true; // remissão de dívida: sempre revisar
  if (!scheduleRow) return true; // pagamento sem parcela prevista correspondente (ex.: fora do cronograma)

  const scheduledPrincipal = r2(scheduleRow.amortizacao || 0);
  const scheduledInterest = r2(scheduleRow.jurosPagos ?? ((scheduleRow.jurosFixosMes || 0) + (scheduleRow.jurosVariaveisMes || 0)));

  const principalDiff = Math.abs(r2(settlement.principal_paid || 0) - scheduledPrincipal);
  const interestDiff = Math.abs(r2(settlement.interest_paid || 0) - scheduledInterest);

  return principalDiff > EPS || interestDiff > EPS;
}

/**
 * Verifica se o "ajuste de arredondamento" de uma baixa está dentro do
 * esperado ou se deveria virar alerta de revisão de parâmetros do contrato.
 */
export function checkRoundingMateriality(settlement, threshold = DEFAULT_ROUNDING_MATERIALITY_THRESHOLD) {
  const adjustment = Math.abs(settlement.rounding_adjustment || 0);
  if (adjustment <= threshold) return { material: false };
  return {
    material: true,
    message:
      `Ajuste de arredondamento de R$ ${adjustment.toFixed(2)} está acima do limite configurado ` +
      `(R$ ${threshold.toFixed(2)}). Revise taxa, indexador ou base de dias do contrato — ` +
      "isso normalmente não é só arredondamento.",
  };
}

/**
 * Concilia um único contrato para a competência informada, injetando as
 * baixas reais (quando existirem) no lugar da projeção do schedule_data.
 * Mesma lógica de ledger de getMonthlyRollForward, por contrato, com os
 * eventos discriminados para geração de lançamentos.
 *
 * @param {Object} contract
 * @param {number|string} year
 * @param {number|string} month
 * @param {Array} settlements - baixas do contrato (qualquer competência;
 *   filtradas aqui pela data de vencimento da parcela correspondente)
 */
export function reconcileContractForCompetencia(contract, year, month, settlements = []) {
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  const monthStart = new Date(yearNum, monthNum - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
  const prevMonthEnd = new Date(yearNum, monthNum - 1, 0, 23, 59, 59, 999);

  const result = {
    contractId: contract.id,
    contractNumber: contract.contract_number,
    events: [], // { type, amount, date, extraordinary }
    opening: { principal: 0, interest: 0, fx: 0 },
    closing: { principal: 0, interest: 0, fx: 0 },
    settlementsUsed: [],
    pendingRecalculation: [],
  };

  if (!contract.schedule_data) return result;

  let schedule;
  try {
    const parsed = JSON.parse(contract.schedule_data);
    schedule = parsed.schedule || [];
  } catch {
    return result;
  }
  if (schedule.length === 0) return result;

  const settlementsByParcela = new Map();
  settlements.forEach((s) => {
    if (s.status === "estornado") return;
    settlementsByParcela.set(String(s.parcela), s);
  });

  let principalLedger = 0;
  let jurosLedger = 0;
  let fxLedger = 0;
  let openingSnapshot = null;
  let closingSnapshot = null;

  schedule.forEach((row, idx) => {
    const rowDate = new Date(row.dataVencimento + "T12:00:00");
    if (!openingSnapshot && rowDate > prevMonthEnd) {
      openingSnapshot = { principal: principalLedger, interest: jurosLedger, fx: fxLedger };
    }

    const isWithinMonth = rowDate >= monthStart && rowDate <= monthEnd;
    const settlement = settlementsByParcela.get(String(row.parcela));

    const newPrincipalRow = idx === 0 ? (row.sdInicial || 0) : 0;
    const interestAccruedRow = (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
    const fxAccruedRow = row.varCambial || 0;

    // Usa a baixa real quando existir; senão, cai na projeção do schedule.
    const principalPaidRow = settlement ? r2(settlement.principal_paid || 0) : (row.amortizacao || 0);
    const interestPaidRow = settlement ? r2(settlement.interest_paid || 0) : (row.jurosPagos || 0);

    if (isWithinMonth) {
      if (newPrincipalRow) result.events.push({ type: SETTLEMENT_EVENT_TYPES.LIBERACAO, amount: r2(newPrincipalRow), date: row.dataVencimento });
      if (interestAccruedRow) result.events.push({ type: SETTLEMENT_EVENT_TYPES.JUROS_APROPRIADOS, amount: r2(interestAccruedRow), date: row.dataVencimento });
      if (fxAccruedRow) {
        result.events.push({
          type: fxAccruedRow >= 0 ? SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA : SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA,
          amount: r2(Math.abs(fxAccruedRow)),
          date: row.dataVencimento,
        });
      }
      if (principalPaidRow) result.events.push({ type: SETTLEMENT_EVENT_TYPES.PAGAMENTO_PRINCIPAL, amount: r2(principalPaidRow), date: row.dataVencimento, extraordinary: settlement?.extraordinary_amortization });
      if (interestPaidRow) result.events.push({ type: SETTLEMENT_EVENT_TYPES.PAGAMENTO_JUROS, amount: r2(interestPaidRow), date: row.dataVencimento });

      if (settlement) {
        result.settlementsUsed.push(settlement.id);
        if (settlement.penalty_paid) result.events.push({ type: SETTLEMENT_EVENT_TYPES.MULTA_MORA, amount: r2(settlement.penalty_paid), date: settlement.actual_payment_date });
        if (settlement.fee_paid) result.events.push({ type: SETTLEMENT_EVENT_TYPES.TARIFA_BANCARIA, amount: r2(settlement.fee_paid), date: settlement.actual_payment_date });
        if (settlement.discount_amount) result.events.push({ type: SETTLEMENT_EVENT_TYPES.DESCONTO_FINANCEIRO, amount: r2(settlement.discount_amount), date: settlement.actual_payment_date });
        if (settlement.rounding_adjustment) result.events.push({ type: SETTLEMENT_EVENT_TYPES.AJUSTE_ARREDONDAMENTO, amount: r2(settlement.rounding_adjustment), date: settlement.actual_payment_date });
        if (settlement.other_amount) result.events.push({ type: SETTLEMENT_EVENT_TYPES.OUTROS, amount: r2(settlement.other_amount), date: settlement.actual_payment_date });
        if (settlement.triggers_recalculation && !settlement.recalculation_snapshot_id) {
          result.pendingRecalculation.push(settlement.id);
        }
      }
    }

    principalLedger += newPrincipalRow - principalPaidRow;
    jurosLedger += interestAccruedRow - interestPaidRow;
    fxLedger += fxAccruedRow;

    if (rowDate <= monthEnd) {
      closingSnapshot = { principal: principalLedger, interest: jurosLedger, fx: fxLedger };
    }
  });

  if (!openingSnapshot) openingSnapshot = closingSnapshot || { principal: 0, interest: 0, fx: 0 };
  if (!closingSnapshot) closingSnapshot = openingSnapshot;

  result.opening = { principal: r2(openingSnapshot.principal), interest: r2(openingSnapshot.interest), fx: r2(openingSnapshot.fx) };
  result.closing = { principal: r2(closingSnapshot.principal), interest: r2(closingSnapshot.interest), fx: r2(closingSnapshot.fx) };
  return result;
}

/**
 * Concilia todos os contratos de uma empresa para a competência e agrega os
 * eventos — a base do Step 2 (tabela de conciliação) e do Step 3 (insumo
 * para os lançamentos).
 *
 * @param {Array} contracts - contratos já filtrados por entity_id + aprovados
 * @param {Map<string, Array>} settlementsByContract - contract_id -> baixas
 */
export function calculateClosingReconciliation(contracts, settlementsByContract, year, month) {
  const perContract = contracts.map((c) =>
    reconcileContractForCompetencia(c, year, month, settlementsByContract.get(c.id) || [])
  );

  const aggregatedEvents = [];
  const eventTotals = {};
  perContract.forEach((c) => {
    c.events.forEach((evt) => {
      aggregatedEvents.push({ ...evt, contractId: c.contractId });
      eventTotals[evt.type] = r2((eventTotals[evt.type] || 0) + evt.amount);
    });
  });

  const opening = perContract.reduce(
    (acc, c) => ({ principal: acc.principal + c.opening.principal, interest: acc.interest + c.opening.interest, fx: acc.fx + c.opening.fx }),
    { principal: 0, interest: 0, fx: 0 }
  );
  const closing = perContract.reduce(
    (acc, c) => ({ principal: acc.principal + c.closing.principal, interest: acc.interest + c.closing.interest, fx: acc.fx + c.closing.fx }),
    { principal: 0, interest: 0, fx: 0 }
  );

  const pendingRecalculation = perContract.flatMap((c) => c.pendingRecalculation.map((sid) => ({ contractId: c.contractId, contractNumber: c.contractNumber, settlementId: sid })));

  return {
    perContract,
    aggregatedEvents,
    eventTotals,
    opening: { ...opening, principal: r2(opening.principal), interest: r2(opening.interest), fx: r2(opening.fx) },
    closing: { ...closing, principal: r2(closing.principal), interest: r2(closing.interest), fx: r2(closing.fx) },
    pendingRecalculation,
    hasBlockingDivergence: pendingRecalculation.length > 0,
  };
}

/**
 * Traduz os eventos agregados em linhas de lançamento (débito/crédito
 * separados), usando a matriz contábil da empresa. Eventos sem mapeamento
 * configurado ficam de fora e são reportados em `missingMappings` — o lote
 * fica desbalanceado de propósito, para o Step 3 bloquear a aprovação.
 *
 * @param {Object} reconciliation - saída de calculateClosingReconciliation
 * @param {Array} eventMappings - AccountingEventMapping da empresa (ativos)
 * @param {string} entryDate - data de referência dos lançamentos (data-base)
 */
export function buildJournalEntries(reconciliation, eventMappings, entryDate) {
  const mappingByType = new Map(eventMappings.filter((m) => m.status !== "inativo").map((m) => [m.event_type, m]));
  const entries = [];
  const missingMappings = new Set();

  reconciliation.aggregatedEvents.forEach((evt) => {
    if (evt.amount === 0) return;
    const mapping = mappingByType.get(evt.type);
    if (!mapping) {
      missingMappings.add(evt.type);
      return;
    }
    const historico = `${EVENT_TYPE_LABELS[evt.type] || evt.type} — ${evt.date || entryDate}`;
    entries.push({
      contract_id: evt.contractId,
      event_type: evt.type,
      entry_date: evt.date || entryDate,
      account_id: mapping.debit_account_id,
      side: "debito",
      amount: evt.amount,
      historico,
    });
    entries.push({
      contract_id: evt.contractId,
      event_type: evt.type,
      entry_date: evt.date || entryDate,
      account_id: mapping.credit_account_id,
      side: "credito",
      amount: evt.amount,
      historico,
    });
  });

  const totalDebito = r2(entries.filter((e) => e.side === "debito").reduce((s, e) => s + e.amount, 0));
  const totalCredito = r2(entries.filter((e) => e.side === "credito").reduce((s, e) => s + e.amount, 0));

  return {
    entries,
    totalDebito,
    totalCredito,
    balanced: Math.abs(totalDebito - totalCredito) < EPS,
    missingMappings: Array.from(missingMappings),
  };
}

/**
 * Gate final do botão "Aprovar fechamento" (Step 3) — reúne todas as
 * condições combinadas com o ChatGPT no desenho original.
 */
export function canApproveClosing({ journalResult, reconciliation, previousClosingApproved, hasUnresolvedSettlementBlockers }) {
  const reasons = [];
  if (!journalResult.balanced) reasons.push("Total de débitos e créditos não coincide.");
  if (journalResult.missingMappings.length > 0) {
    reasons.push(`Matriz contábil incompleta para: ${journalResult.missingMappings.map((t) => EVENT_TYPE_LABELS[t] || t).join(", ")}.`);
  }
  if (reconciliation.hasBlockingDivergence) {
    reasons.push("Existem baixas que exigem recálculo do contrato antes de aprovar (reabra o contrato no Simulador).");
  }
  if (hasUnresolvedSettlementBlockers) reasons.push("Existem baixas pendentes de validação.");
  if (previousClosingApproved === false) reasons.push("A competência anterior ainda não está aprovada.");

  return { canApprove: reasons.length === 0, reasons };
}
