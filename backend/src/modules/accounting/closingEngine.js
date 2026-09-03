// 🧮 MOTOR DE FECHAMENTO CONTÁBIL (backend)
//
// Cópia das funções puras de src/lib/accountingClosing.js — o Dockerfile do
// backend só copia backend/src (ver backend/Dockerfile), então não dá pra
// importar o arquivo do frontend direto. As duas cópias precisam ser
// mantidas em sincronia manualmente (mesmo padrão já usado noutras
// duplicações necessárias, ver backend/src/modules/functions/bacen.js).
//
// Usado hoje só pelo fechamento automático (accounting_mode = 'api', ver
// automaticClosing.js) — o fechamento manual continua rodando 100%
// client-side com o arquivo original.

export const OPERATION_CATEGORY_LABELS = {
  emprestimos: "Empréstimos (Capital de Giro)",
  financiamentos: "Financiamentos (Investimento/CAPEX)",
  mutuos_partes_relacionadas: "Mútuos com Partes Relacionadas",
  mutuos_terceiros: "Mútuos com Terceiros",
};

export const SETTLEMENT_EVENT_TYPES = {
  LIBERACAO: "liberacao",
  JUROS_APROPRIADOS: "juros_apropriados",
  PAGAMENTO_PRINCIPAL: "pagamento_principal",
  PAGAMENTO_JUROS: "pagamento_juros",
  VARIACAO_CAMBIAL_PASSIVA: "variacao_cambial_passiva",
  VARIACAO_CAMBIAL_ATIVA: "variacao_cambial_ativa",
  VARIACAO_CAMBIAL_PASSIVA_REALIZADA: "variacao_cambial_passiva_realizada",
  VARIACAO_CAMBIAL_ATIVA_REALIZADA: "variacao_cambial_ativa_realizada",
  TARIFA_BANCARIA: "tarifa_bancaria",
  IOF: "iof",
  CUSTO_TRANSACAO_INICIAL: "custo_transacao_inicial",
  CUSTO_TRANSACAO_APROPRIACAO: "custo_transacao_apropriacao",
  RECLASSIFICACAO_CIRCULANTE_PRINCIPAL: "reclassificacao_circulante_principal",
  RECLASSIFICACAO_CIRCULANTE_JUROS: "reclassificacao_circulante_juros",
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
  variacao_cambial_passiva: "Variação cambial passiva (provisão)",
  variacao_cambial_ativa: "Variação cambial ativa (provisão)",
  variacao_cambial_passiva_realizada: "Variação cambial passiva (realizada na baixa)",
  variacao_cambial_ativa_realizada: "Variação cambial ativa (realizada na baixa)",
  tarifa_bancaria: "Tarifa bancária",
  iof: "IOF",
  custo_transacao_inicial: "Custo de transação inicial",
  custo_transacao_apropriacao: "Apropriação de custo de transação (fee de estruturação)",
  reclassificacao_circulante_principal: "Reclassificação de principal para circulante",
  reclassificacao_circulante_juros: "Reclassificação de juros para circulante",
  multa_mora: "Multa e mora",
  desconto_financeiro: "Desconto financeiro obtido",
  ajuste_arredondamento: "Ajuste de arredondamento / diferença de metodologia",
  outros: "Outros",
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const EPS = 0.01;

export function reconcileContractForCompetencia(contract, year, month, settlements = []) {
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  const monthStart = new Date(yearNum, monthNum - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
  const prevMonthEnd = new Date(yearNum, monthNum - 1, 0, 23, 59, 59, 999);

  const result = {
    contractId: contract.id,
    contractNumber: contract.contract_number,
    operationCategory: contract.operation_category || "emprestimos",
    events: [],
    opening: { principal: 0, interest: 0, fx: 0 },
    closing: { principal: 0, interest: 0, fx: 0 },
    settlementsUsed: [],
    pendingRecalculation: [],
  };

  if (!contract.schedule_data) return result;

  let schedule;
  try {
    const parsed = typeof contract.schedule_data === "string" ? JSON.parse(contract.schedule_data) : contract.schedule_data;
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

      if (idx === 0 && (contract.iof_value || 0) > 0) {
        result.events.push({ type: SETTLEMENT_EVENT_TYPES.IOF, amount: r2(contract.iof_value), date: row.dataVencimento });
      }

      if (contract.other_fees_financed && (contract.other_fees || 0) > 0 && (contract.total_term_months || 0) > 0) {
        const monthlyFee = r2(contract.other_fees / contract.total_term_months);
        if (monthlyFee) {
          result.events.push({ type: SETTLEMENT_EVENT_TYPES.CUSTO_TRANSACAO_APROPRIACAO, amount: monthlyFee, date: row.dataVencimento });
        }
      }

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

        const ptaxPagamento = settlement.exchange_rate_pagamento;
        const sdInicialUSD = row.blocoContabil?.sd_inicial_usd ?? row.sdInicial_USD;
        const ptaxAssumida = row.blocoContabil?.ptax_anterior ?? row.blocoContabil?.ptax_atual;
        if (ptaxPagamento && sdInicialUSD && ptaxAssumida) {
          const fxRealizado = r2(sdInicialUSD * (ptaxPagamento - ptaxAssumida));
          if (fxRealizado) {
            result.events.push({
              type: fxRealizado >= 0 ? SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA_REALIZADA : SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA_REALIZADA,
              amount: r2(Math.abs(fxRealizado)),
              date: settlement.actual_payment_date,
            });
          }
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

function addMonths(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function splitCirculanteNaoCirculante(contract, cutoffDate) {
  const result = { principalShort: 0, principalLong: 0, jurosShort: 0, jurosLong: 0 };
  if (!contract.schedule_data) return result;

  let schedule;
  try {
    const parsed = typeof contract.schedule_data === "string" ? JSON.parse(contract.schedule_data) : contract.schedule_data;
    schedule = parsed.schedule || [];
  } catch {
    return result;
  }

  const cutoff = new Date(cutoffDate + "T00:00:00");
  let jurosLedger = 0;
  let nextInterestPayment = null;

  schedule.forEach((row) => {
    const rowDate = new Date(row.dataVencimento + "T00:00:00");
    const interestAccruedRow = (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
    const interestPaidRow = row.jurosPagos || 0;

    if (rowDate <= cutoff) {
      jurosLedger += interestAccruedRow - interestPaidRow;
      return;
    }

    const daysToMaturity = Math.ceil((rowDate - cutoff) / (1000 * 60 * 60 * 24));
    const monthsToMaturity = Math.floor(daysToMaturity / 30.44);
    const isShort = monthsToMaturity <= 12;

    if (row.amortizacao > 0) {
      if (isShort) result.principalShort += row.amortizacao;
      else result.principalLong += row.amortizacao;
    }
    if (!nextInterestPayment && interestPaidRow > 0) {
      nextInterestPayment = { isShort };
    }
  });

  const jurosBalance = r2(jurosLedger);
  if (Math.abs(jurosBalance) > EPS) {
    if (!nextInterestPayment || nextInterestPayment.isShort) result.jurosShort = jurosBalance;
    else result.jurosLong = jurosBalance;
  }

  result.principalShort = r2(result.principalShort);
  result.principalLong = r2(result.principalLong);
  return result;
}

export function calculateClosingReconciliation(contracts, settlementsByContract, year, month, dataBase) {
  const perContract = contracts.map((c) =>
    reconcileContractForCompetencia(c, year, month, settlementsByContract.get(c.id) || [])
  );

  const aggregatedEvents = [];
  const eventTotals = {};
  perContract.forEach((c) => {
    c.events.forEach((evt) => {
      aggregatedEvents.push({ ...evt, contractId: c.contractId, operationCategory: c.operationCategory });
      eventTotals[evt.type] = r2((eventTotals[evt.type] || 0) + evt.amount);
    });
  });

  const cutoff = dataBase || `${year}-${String(month).padStart(2, "0")}-${new Date(Number(year), Number(month), 0).getDate()}`;
  const previousCutoff = addMonths(cutoff, -1);
  contracts.forEach((contract) => {
    const curr = splitCirculanteNaoCirculante(contract, cutoff);
    const prev = splitCirculanteNaoCirculante(contract, previousCutoff);
    const principalDelta = r2(curr.principalShort - prev.principalShort);
    const jurosDelta = r2(curr.jurosShort - prev.jurosShort);

    const operationCategory = contract.operation_category || "emprestimos";
    if (Math.abs(principalDelta) > EPS) {
      const evt = {
        type: SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_PRINCIPAL,
        amount: Math.abs(principalDelta),
        date: cutoff,
        direction: principalDelta > 0 ? "to_circulante" : "to_nao_circulante",
        contractId: contract.id,
        operationCategory,
      };
      aggregatedEvents.push(evt);
      eventTotals[evt.type] = r2((eventTotals[evt.type] || 0) + evt.amount);
    }
    if (Math.abs(jurosDelta) > EPS) {
      const evt = {
        type: SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_JUROS,
        amount: Math.abs(jurosDelta),
        date: cutoff,
        direction: jurosDelta > 0 ? "to_circulante" : "to_nao_circulante",
        contractId: contract.id,
        operationCategory,
      };
      aggregatedEvents.push(evt);
      eventTotals[evt.type] = r2((eventTotals[evt.type] || 0) + evt.amount);
    }
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

const RECLASSIFICATION_EVENT_TYPES = new Set([
  SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_PRINCIPAL,
  SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_JUROS,
]);

function mappingKey(eventType, operationCategory) {
  return `${eventType}::${operationCategory || "emprestimos"}`;
}

export function buildJournalEntries(reconciliation, eventMappings, entryDate) {
  const mappingByType = new Map(
    eventMappings
      .filter((m) => m.status !== "inativo")
      .map((m) => [mappingKey(m.event_type, m.operation_category), m])
  );
  const entries = [];
  const missingMappingsMap = new Map();

  reconciliation.aggregatedEvents.forEach((evt) => {
    if (evt.amount === 0) return;
    const mapping = mappingByType.get(mappingKey(evt.type, evt.operationCategory));
    if (!mapping) {
      const key = mappingKey(evt.type, evt.operationCategory);
      missingMappingsMap.set(key, { type: evt.type, operationCategory: evt.operationCategory || "emprestimos" });
      return;
    }
    const historico = `${EVENT_TYPE_LABELS[evt.type] || evt.type} — ${evt.date || entryDate}`;
    let debitAccountId = mapping.debit_account_id;
    let creditAccountId = mapping.credit_account_id;
    if (RECLASSIFICATION_EVENT_TYPES.has(evt.type) && evt.direction === "to_nao_circulante") {
      debitAccountId = mapping.credit_account_id;
      creditAccountId = mapping.debit_account_id;
    }
    entries.push({
      contract_id: evt.contractId,
      event_type: evt.type,
      entry_date: evt.date || entryDate,
      account_id: debitAccountId,
      side: "debito",
      amount: evt.amount,
      historico,
    });
    entries.push({
      contract_id: evt.contractId,
      event_type: evt.type,
      entry_date: evt.date || entryDate,
      account_id: creditAccountId,
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
    missingMappings: Array.from(missingMappingsMap.values()),
  };
}

export function canApproveClosing({ journalResult, reconciliation, previousClosingApproved, hasUnresolvedSettlementBlockers }) {
  const reasons = [];
  if (!journalResult.balanced) reasons.push("Total de débitos e créditos não coincide.");
  if (journalResult.missingMappings.length > 0) {
    const labels = journalResult.missingMappings.map(
      (m) => `${EVENT_TYPE_LABELS[m.type] || m.type} (${OPERATION_CATEGORY_LABELS[m.operationCategory] || m.operationCategory})`
    );
    reasons.push(`Matriz contábil incompleta para: ${labels.join(", ")}.`);
  }
  if (reconciliation.hasBlockingDivergence) {
    reasons.push("Existem baixas que exigem recálculo do contrato antes de aprovar (reabra o contrato na Calculadora).");
  }
  if (hasUnresolvedSettlementBlockers) reasons.push("Existem baixas pendentes de validação.");
  if (previousClosingApproved === false) reasons.push("A competência anterior ainda não está aprovada.");

  return { canApprove: reasons.length === 0, reasons };
}
