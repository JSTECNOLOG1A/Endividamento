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
  CAPITALIZACAO_JUROS: "capitalizacao_juros",
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
  capitalizacao_juros: "Capitalização de juros (juros a pagar → principal)",
  reclassificacao_circulante_principal: "Reclassificação de principal para circulante",
  reclassificacao_circulante_juros: "Reclassificação de juros para circulante",
  multa_mora: "Multa e mora",
  desconto_financeiro: "Desconto financeiro obtido",
  ajuste_arredondamento: "Ajuste de arredondamento / diferença de metodologia",
  outros: "Outros",
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const EPS = 0.01;

// payoff_date vem do pg como Date (coluna DATE, sem type parser) ou string —
// normaliza pra "YYYY-MM-DD".
function isoDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

// Chave de idempotência de cada evento (contrato + tipo + data + origem). Reprocessar o
// mesmo período gera as MESMAS chaves — quem grava lançamento deve substituir, nunca somar.
function eventKey(contractId, type, date, origin) {
  return [contractId, type, date, origin || ""].join("|");
}

function isoOf(dateObj) {
  return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
}

/**
 * Concilia um contrato numa competência.
 *
 * Regras (validadas com o responsável — ver plano de virada de saldos):
 *  - Juros apropriados POR COMPETÊNCIA: o evento do mês é o juro acumulado até o último dia
 *    do mês menos o acumulado até o último dia do mês anterior. O juro de cada período do
 *    cronograma (data da parcela anterior até a data da parcela) é rateado por dias corridos.
 *    Não altera o cronograma e não gera títulos: o financeiro segue com o valor cheio.
 *  - Liberação, IOF e custo de transação são reconhecidos NA DATA DA OPERAÇÃO (política única
 *    da ferramenta: custo de transação no ato, cada verba na sua conta; sem apropriação linear).
 *  - Baixa efetiva: a partir de options.requireSettlementFrom (data por cliente, vazia = regra
 *    antiga) a parcela só é paga se houver baixa registrada; sem baixa fica em aberto e entra em
 *    result.pendingUnsettled.
 */
export function reconcileContractForCompetencia(contract, year, month, settlements = [], options = {}) {
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  const monthStart = new Date(yearNum, monthNum - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
  const prevMonthEnd = new Date(yearNum, monthNum - 1, 0, 23, 59, 59, 999);
  const monthEndIso = isoOf(monthEnd);
  const requireFrom = isoDateOnly(options.requireSettlementFrom || "");

  const result = {
    contractId: contract.id,
    contractNumber: contract.contract_number,
    operationCategory: contract.operation_category || "emprestimos",
    events: [],
    opening: { principal: 0, interest: 0, fx: 0 },
    closing: { principal: 0, interest: 0, fx: 0 },
    settlementsUsed: [],
    pendingRecalculation: [],
    pendingUnsettled: [],
  };

  // Contrato renegociado/quitado antecipadamente antes desta competência —
  // nada mais a conciliar a partir daí (payoff_date, gravado em
  // renegotiateContract()/settleContractEarly()).
  const payoffIso = isoDateOnly(contract.payoff_date);
  if (payoffIso && new Date(payoffIso + "T12:00:00") < monthStart) {
    return result;
  }

  // Contrato em implantação de saldos: as competências até a data de corte são do saldo de abertura
  // (lançamento de abertura), não do fechamento — nada a conciliar aqui.
  const cutoffIso = contract.deployment_mode ? isoDateOnly(contract.deployment_cutoff) : "";
  if (cutoffIso && monthEndIso <= cutoffIso) return result;

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

  // Linhas com pagamento efetivo já resolvido (baixa x cronograma x regra de baixa efetiva).
  const rows = schedule.map((row, idx) => {
    const settlement = settlementsByParcela.get(String(row.parcela));
    const unpaidByRule = Boolean(requireFrom) && row.dataVencimento >= requireFrom && !settlement;

    // Juros capitalizados que a parcela paga depois: o motor os inclui em `jurosPagos`, mas eles já
    // viraram principal (evento de capitalização) — então a parte deles amortiza o PRINCIPAL. Aparece
    // como queda do saldo além da amortização: sdInicial + capitalizado − sdFinal − amortização.
    // (Contratos em moeda estrangeira e liberação parcelada ficam fora: o saldo tem outros componentes.)
    const scheduledExtra = !row.liberacaoInjetada && !contract.currency_id
      ? (() => {
          const gap = r2((row.sdInicial || 0) + (row.jurosCapitalizados || 0) - (row.sdFinal || 0) - (row.amortizacao || 0));
          return gap > 0.05 ? gap : 0; // ignora ruído de arredondamento
        })()
      : 0;
    let extra = 0;
    if (settlement) {
      const scheduledInterest = row.jurosPagos || 0;
      extra = scheduledInterest > 0 ? r2(Math.min(scheduledExtra, scheduledExtra * ((settlement.interest_paid || 0) / scheduledInterest))) : 0;
    } else if (!unpaidByRule) {
      extra = scheduledExtra;
    }
    const rawInterestPaid = settlement ? r2(settlement.interest_paid || 0) : (unpaidByRule ? 0 : (row.jurosPagos || 0));
    extra = Math.min(extra, rawInterestPaid);
    return {
      row,
      idx,
      settlement,
      unpaidByRule,
      date: new Date(row.dataVencimento + "T12:00:00"),
      interest: (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0),
      fx: row.varCambial || 0,
      capitalizado: row.jurosCapitalizados || 0,
      liberacao: idx === 0 ? 0 : (row.liberacaoInjetada || 0),
      principalPaid: r2((settlement ? r2(settlement.principal_paid || 0) : (unpaidByRule ? 0 : (row.amortizacao || 0))) + extra),
      interestPaid: r2(rawInterestPaid - extra),
    };
  });

  // Data da liberação: a da operação (não a da primeira parcela).
  const opIso = isoDateOnly(contract.operation_date);
  const opDate = opIso ? new Date(opIso + "T12:00:00") : null;
  const liberationDate = opDate && opDate <= rows[0].date ? opDate : rows[0].date;
  const liberationIso = isoOf(liberationDate);
  const initialPrincipal = rows[0].row.sdInicial || 0;

  // Juros acumulados até "limit": períodos fechados por inteiro + rateio por dias do período em curso.
  const periodStart = (i) => (i === 0 ? liberationDate : rows[i - 1].date);
  const accruedThrough = (limit) => {
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].date <= limit) {
        total += rows[i].interest;
      } else {
        const start = periodStart(i);
        const span = rows[i].date - start;
        if (limit > start && span > 0) total += rows[i].interest * ((limit - start) / span);
        break;
      }
    }
    return total;
  };
  const snapshotAt = (limit) => {
    let principal = liberationDate <= limit ? initialPrincipal : 0;
    let paidInterest = 0;
    let fx = 0;
    rows.forEach((r) => {
      if (r.date <= limit) {
        principal += r.liberacao - r.principalPaid + r.capitalizado;
        paidInterest += r.interestPaid + r.capitalizado;
        fx += r.fx;
      }
    });
    return {
      principal: r2(principal),
      interest: r2(accruedThrough(limit) - paidInterest),
      fx: r2(fx),
    };
  };

  result.opening = snapshotAt(prevMonthEnd);
  result.closing = snapshotAt(monthEnd);

  const push = (type, amount, date, origin, extra = {}) => {
    result.events.push({ type, amount, date, key: eventKey(contract.id, type, date, origin), ...extra });
  };

  // Liberação, IOF e custo de transação: na data da operação.
  if (liberationDate >= monthStart && liberationDate <= monthEnd) {
    if (initialPrincipal) push(SETTLEMENT_EVENT_TYPES.LIBERACAO, r2(initialPrincipal), liberationIso, "abertura", { bankAccountId: contract.disbursement_bank_account_id || null });
    if ((contract.iof_value || 0) > 0) push(SETTLEMENT_EVENT_TYPES.IOF, r2(contract.iof_value), liberationIso, "abertura");
    if ((contract.other_fees || 0) > 0) push(SETTLEMENT_EVENT_TYPES.CUSTO_TRANSACAO_INICIAL, r2(contract.other_fees), liberationIso, "abertura");
  }

  // Juros apropriados por competência (acumulado até o fim do mês − acumulado até o fim do mês anterior).
  const interestMonth = r2(accruedThrough(monthEnd) - accruedThrough(prevMonthEnd));
  if (interestMonth) push(SETTLEMENT_EVENT_TYPES.JUROS_APROPRIADOS, interestMonth, monthEndIso, "competencia");

  rows.forEach((r) => {
    const { row, idx, settlement } = r;
    const rowDate = r.date;
    const isWithinMonth = rowDate >= monthStart && rowDate <= monthEnd;

    // Parcela vencida até o fim do mês, sem baixa, sob a regra de baixa efetiva: pendência.
    if (r.unpaidByRule && rowDate <= monthEnd && ((row.amortizacao || 0) > 0 || (row.jurosPagos || 0) > 0)) {
      result.pendingUnsettled.push({
        contractId: contract.id,
        contractNumber: contract.contract_number,
        parcela: row.parcela,
        dataVencimento: row.dataVencimento,
        principal: r2(row.amortizacao || 0),
        juros: r2(row.jurosPagos || 0),
      });
    }

    if (!isWithinMonth) return;

    // Liberação parcelada: tranche que caiu nesta linha (o motor expõe `liberacaoInjetada`).
    if (idx > 0 && r.liberacao) push(SETTLEMENT_EVENT_TYPES.LIBERACAO, r2(r.liberacao), row.dataVencimento, `tranche-${row.parcela}`, { bankAccountId: contract.disbursement_bank_account_id || null });

    // Juros capitalizados na linha: saem de juros a pagar e passam a compor o principal.
    if (r.capitalizado) push(SETTLEMENT_EVENT_TYPES.CAPITALIZACAO_JUROS, r2(r.capitalizado), row.dataVencimento, `parcela-${row.parcela}`);

    if (r.fx) {
      push(
        r.fx >= 0 ? SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA : SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA,
        r2(Math.abs(r.fx)),
        row.dataVencimento,
        `parcela-${row.parcela}`
      );
    }
    if (r.principalPaid) push(SETTLEMENT_EVENT_TYPES.PAGAMENTO_PRINCIPAL, r2(r.principalPaid), row.dataVencimento, settlement ? `baixa-${settlement.id}` : `parcela-${row.parcela}`, { extraordinary: settlement?.extraordinary_amortization, bankAccountId: settlement?.bank_account_id || null });
    if (r.interestPaid) push(SETTLEMENT_EVENT_TYPES.PAGAMENTO_JUROS, r2(r.interestPaid), row.dataVencimento, settlement ? `baixa-${settlement.id}` : `parcela-${row.parcela}`, { bankAccountId: settlement?.bank_account_id || null });

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
  });

  return result;
}

function addMonths(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function splitCirculanteNaoCirculante(contract, cutoffDate) {
  const result = { principalShort: 0, principalLong: 0, jurosShort: 0, jurosLong: 0 };
  // Contrato já renegociado/quitado antecipadamente no corte (ou antes) — sem
  // saldo a classificar em circulante/não circulante.
  const payoffCut = isoDateOnly(contract.payoff_date);
  if (payoffCut && payoffCut <= isoDateOnly(cutoffDate)) return result;
  if (!contract.schedule_data) return result;

  let schedule;
  try {
    const parsed = typeof contract.schedule_data === "string" ? JSON.parse(contract.schedule_data) : contract.schedule_data;
    schedule = parsed.schedule || [];
  } catch {
    return result;
  }

  const cutoff = new Date(cutoffDate + "T00:00:00");
  const shortLimit = new Date(addMonths(cutoffDate, 12) + "T00:00:00");
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

    // CPC 26: circulante = vence em até 12 meses da data-base (data a data, não
    // por média de dias — 12,9 meses já é não circulante).
    const isShort = rowDate <= shortLimit;

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

export function calculateClosingReconciliation(contracts, settlementsByContract, year, month, dataBase, options = {}) {
  const perContract = contracts.map((c) =>
    reconcileContractForCompetencia(c, year, month, settlementsByContract.get(c.id) || [], options)
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
    // Reclassificação é só o que MIGROU de balde com a passagem do tempo. O
    // saldo de longo prazo só diminui por migração (parcela que entrou na janela
    // de 12 meses) — já o de curto prazo também diminui quando uma parcela é
    // PAGA, e isso não é reclassificação. Por isso a base é o balde longo:
    // contrato inteiramente de curto prazo nunca gera reclassificação.
    // principalDelta > 0: saiu do não circulante para o circulante.
    const principalDelta = r2(prev.principalLong - curr.principalLong);
    // Juros: o saldo apropriado vai inteiro para um balde só (o da próxima
    // liquidação). Migra quando esse balde muda; acréscimo por apropriação
    // dentro do mesmo balde não é reclassificação.
    let jurosDelta = 0;
    if (prev.jurosLong > EPS && curr.jurosLong <= EPS) jurosDelta = r2(prev.jurosLong);
    else if (prev.jurosLong <= EPS && curr.jurosLong > EPS) jurosDelta = -r2(Math.min(Math.max(prev.jurosShort, 0), curr.jurosLong));

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

  const pendingUnsettled = perContract.flatMap((c) => c.pendingUnsettled || []);
  const pendingRecalculation = perContract.flatMap((c) => c.pendingRecalculation.map((sid) => ({ contractId: c.contractId, contractNumber: c.contractNumber, settlementId: sid })));

  return {
    perContract,
    aggregatedEvents,
    eventTotals,
    opening: { ...opening, principal: r2(opening.principal), interest: r2(opening.interest), fx: r2(opening.fx) },
    closing: { ...closing, principal: r2(closing.principal), interest: r2(closing.interest), fx: r2(closing.fx) },
    pendingRecalculation,
    pendingUnsettled,
    hasBlockingDivergence: pendingRecalculation.length > 0,
  };
}

const RECLASSIFICATION_EVENT_TYPES = new Set([
  SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_PRINCIPAL,
  SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_JUROS,
]);

// Pra esses 3 eventos, a perna "Banco" pode ser resolvida pela conta
// bancária real da operação (contract.disbursement_bank_account_id na
// liberação, settlement.bank_account_id no pagamento) em vez da conta
// fixa da matriz — ver buildJournalEntries abaixo. Os demais eventos
// (juros apropriados, IOF, tarifas, reclassificações etc.) não têm perna
// de banco e continuam 100% pela matriz.
const BANK_LEG_BY_EVENT = {
  [SETTLEMENT_EVENT_TYPES.LIBERACAO]: "debito",
  [SETTLEMENT_EVENT_TYPES.PAGAMENTO_PRINCIPAL]: "credito",
  [SETTLEMENT_EVENT_TYPES.PAGAMENTO_JUROS]: "credito",
};

function mappingKey(eventType, operationCategory) {
  return `${eventType}::${operationCategory || "emprestimos"}`;
}

export function buildJournalEntries(reconciliation, eventMappings, entryDate, bankAccountsById = new Map()) {
  const mappingByType = new Map(
    eventMappings
      .filter((m) => m.status !== "inativo" && m.debit_account_id && m.credit_account_id)
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
    // Sobrescreve a perna Banco pela conta bancária real da operação,
    // quando ela existir e tiver conta contábil vinculada — senão, fica a
    // conta da matriz (fallback, comportamento idêntico ao de antes desta
    // opção existir).
    const bankLeg = BANK_LEG_BY_EVENT[evt.type];
    if (bankLeg) {
      const bankAccount = evt.bankAccountId ? bankAccountsById.get(evt.bankAccountId) : null;
      const bankChartAccountId = bankAccount?.chart_account_id || null;
      if (bankChartAccountId) {
        if (bankLeg === "debito") debitAccountId = bankChartAccountId;
        else creditAccountId = bankChartAccountId;
      }
    }
    entries.push({
      contract_id: evt.contractId,
      event_type: evt.type,
      entry_date: evt.date || entryDate,
      account_id: debitAccountId,
      side: "debito",
      amount: evt.amount,
      historico,
      event_key: evt.key || null,
    });
    entries.push({
      contract_id: evt.contractId,
      event_type: evt.type,
      entry_date: evt.date || entryDate,
      account_id: creditAccountId,
      side: "credito",
      amount: evt.amount,
      historico,
      event_key: evt.key || null,
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
