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
  CUSTO_TRANSACAO_DIFERIDO: "custo_transacao_diferido",
  CAPITALIZACAO_JUROS: "capitalizacao_juros",
  AJUSTE_PROVISAO_JUROS: "ajuste_provisao_juros",
  RECLASSIFICACAO_CIRCULANTE_PRINCIPAL: "reclassificacao_circulante_principal",
  RECLASSIFICACAO_CIRCULANTE_JUROS: "reclassificacao_circulante_juros",
  MULTA_MORA: "multa_mora",
  DESCONTO_FINANCEIRO: "desconto_financeiro",
  AJUSTE_ARREDONDAMENTO: "ajuste_arredondamento",
  OUTROS: "outros",
};

export const EVENT_TYPE_LABELS = {
  liberacao: "Liberação do empréstimo",
  juros_apropriados: "Provisão de juros (competência)",
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
  custo_transacao_diferido: "Custo de transação diferido (a apropriar — CPC 08)",
  capitalizacao_juros: "Capitalização de juros (juros a pagar → principal)",
  ajuste_provisao_juros: "Ajuste de provisão de juros (taxas publicadas)",
  abertura_implantacao: "Abertura — implantação de saldos",
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

// Parcela do título vem como "013" e a do cronograma como 13: compara pelo número.
function parcelaKey(p) {
  const n = Number(p);
  return Number.isFinite(n) ? String(n) : String(p);
}

function isoOf(dateObj) {
  return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
}

/**
 * Posição aprovada de cada contrato nas implantações cuja virada cai na competência: { [contractId]: {principal, interest} }.
 * Usada para o ajuste cambial da virada de contratos em moeda estrangeira.
 */
export function deploymentOpeningFromConfigs(configs = []) {
  const out = {};
  for (const cfg of configs) {
    let snap = cfg.position_snapshot;
    if (typeof snap === "string") { try { snap = JSON.parse(snap); } catch { snap = null; } }
    for (const c of snap?.contratos || []) {
      out[c.contractId] = { principal: Number(c.position?.principalTotal) || 0, interest: Number(c.position?.jurosTotal) || 0 };
    }
  }
  return out;
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
    fxIssues: [],
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
    settlementsByParcela.set(parcelaKey(s.parcela), s);
  });

  // Implantação de saldos: parcelas até a data de corte informadas como vencidas em aberto continuam
  // devidas depois da virada — só saem do saldo quando existir baixa.
  const deployOpen = new Set((() => {
    let list = contract.deployment_open_parcelas;
    if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
    return (Array.isArray(list) ? list : []).map((p) => String(Number(p)));
  })());

  // Linhas com pagamento efetivo já resolvido (baixa x cronograma x regra de baixa efetiva).
  const rows = schedule.map((row, idx) => {
    const settlement = settlementsByParcela.get(parcelaKey(row.parcela));
    const unpaidByDeployment = Boolean(cutoffIso) && row.dataVencimento <= cutoffIso && deployOpen.has(String(Number(row.parcela))) && !settlement;
    const coveredByDeployment = Boolean(cutoffIso) && row.dataVencimento <= cutoffIso;
    const unpaidByRule = unpaidByDeployment || (Boolean(requireFrom) && row.dataVencimento >= requireFrom && !settlement && !coveredByDeployment);
    const payIso = settlement && settlement.actual_payment_date ? isoDateOnly(settlement.actual_payment_date) : "";

    // Moeda estrangeira: os campos de topo misturam USD e BRL (jurosPagos e jurosCapitalizados vêm em
    // USD). O bloco contábil da linha traz tudo em REAIS — é o que o fechamento usa.
    const bloco = contract.currency_id ? row.blocoContabil : null;
    const brl = bloco
      ? {
        jurosPagos: bloco.jurosPagosBRL ?? 0,
        capitalizado: bloco.jurosCapitalizadosBRL ?? 0,
        amortizacao: bloco.amortizacaoPagaBRL ?? row.amortizacao ?? 0,
        fx: bloco.ajusteCambialMes ?? row.varCambial ?? 0,
        abertura: bloco.valorAberturaBRL ?? 0,
        fechamento: bloco.valorFechamentoBRL ?? 0,
      }
      : null;
    const rowJurosPagos = brl ? brl.jurosPagos : (row.jurosPagos || 0);
    const rowAmortizacao = brl ? brl.amortizacao : (row.amortizacao || 0);
    const rowCapitalizado = brl ? brl.capitalizado : (row.jurosCapitalizados || 0);

    // Juros capitalizados que a parcela paga depois: o motor os inclui em `jurosPagos`, mas eles já
    // viraram principal (evento de capitalização) — então a parte deles amortiza o PRINCIPAL. Aparece
    // como queda do saldo além da amortização: sdInicial + capitalizado − sdFinal − amortização.
    // (Contratos em moeda estrangeira e liberação parcelada ficam fora: o saldo tem outros componentes.)
    const scheduledExtra = brl
      ? (() => {
          const gap = r2(brl.abertura + brl.fx + brl.capitalizado - brl.fechamento - brl.amortizacao);
          return gap > 0.05 ? gap : 0;
        })()
      : !row.liberacaoInjetada && !contract.currency_id
      ? (() => {
          const gap = r2((row.sdInicial || 0) + (row.jurosCapitalizados || 0) - (row.sdFinal || 0) - (row.amortizacao || 0));
          return gap > 0.05 ? gap : 0; // ignora ruído de arredondamento
        })()
      : 0;
    let extra = 0;
    if (settlement) {
      const scheduledInterest = rowJurosPagos;
      extra = scheduledInterest > 0 ? r2(Math.min(scheduledExtra, scheduledExtra * ((settlement.interest_paid || 0) / scheduledInterest))) : 0;
    } else if (!unpaidByRule) {
      extra = scheduledExtra;
    }
    const rawInterestPaid = settlement ? r2(settlement.interest_paid || 0) : (unpaidByRule ? 0 : rowJurosPagos);
    extra = Math.min(extra, rawInterestPaid);
    return {
      row,
      idx,
      settlement,
      unpaidByRule,
      date: new Date(row.dataVencimento + "T12:00:00"),
      payIso,
      payDate: payIso ? new Date(payIso + "T12:00:00") : new Date(row.dataVencimento + "T12:00:00"),
      interest: (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0),
      fx: brl ? brl.fx : (row.varCambial || 0),
      capitalizado: rowCapitalizado,
      liberacao: idx === 0 ? 0 : (row.liberacaoInjetada || 0),
      scheduledPrincipal: rowAmortizacao,
      scheduledInterest: rowJurosPagos,
      principalPaid: r2((settlement ? r2(settlement.principal_paid || 0) : (unpaidByRule ? 0 : rowAmortizacao)) + extra),
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
        principal += r.liberacao + r.capitalizado + (contract.currency_id ? r.fx : 0);
        paidInterest += r.capitalizado;
        fx += r.fx;
      }
      if (r.payDate <= limit) {
        principal -= r.principalPaid;
        paidInterest += r.interestPaid;
      }
    });
    return {
      principal: r2(principal),
      interest: r2(accruedThrough(limit) - paidInterest),
      fx: r2(fx),
    };
  };

  const engineOpening = snapshotAt(prevMonthEnd);
  result.opening = engineOpening;
  // Competência da virada: o "saldo anterior" é a posição aprovada da implantação (o que a abertura lançou),
  // não o saldo que o cronograma projeta — os ajustes do mês partem dela.
  const deploymentStart = options.deploymentOpening && options.deploymentOpening[contract.id];
  if (cutoffIso && deploymentStart) {
    result.opening = { principal: r2(deploymentStart.principal), interest: r2(deploymentStart.interest), fx: result.opening.fx };
  }
  result.closing = snapshotAt(monthEnd);

  const push = (type, amount, date, origin, extra = {}) => {
    result.events.push({ type, amount, date, key: eventKey(contract.id, type, date, origin), ...extra });
  };

  // Implantação em moeda estrangeira: a abertura foi lançada pela PTAX da data-base, e o cronograma mede a
  // variação cambial da virada a partir da PTAX das suas próprias linhas. A diferença entre os dois pontos de
  // partida é ajuste cambial da competência da virada — sem ele o passivo lançado não fecha no saldo apurado.
  const depOpen = options.deploymentOpening && options.deploymentOpening[contract.id];
  if (cutoffIso && contract.currency_id && depOpen) {
    const [cy, cm, cd] = cutoffIso.split("-").map(Number);
    const atCutoff = snapshotAt(new Date(cy, cm - 1, cd, 23, 59, 59, 999));
    const delta = r2((atCutoff.principal + atCutoff.interest) - (depOpen.principal + depOpen.interest));
    if (Math.abs(delta) >= 0.01) {
      push(delta > 0 ? SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA : SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA, r2(Math.abs(delta)), isoOf(monthStart), "implantacao-cambial");
    }
  }

  // Liberação, IOF e custo de transação: na data da operação.
  // Custo de transação: reconhecido no ato (padrão, D8 do plano da virada) ou amortizado ao longo do prazo —
  // opção por contrato. CPC 08 (R1), item 12: os encargos financeiros da captação são apropriados ao resultado
  // em função da fluência do prazo, pelo método dos juros efetivos (TIR da operação). Aqui, simplificação em
  // linha reta por dias corridos (mesmo padrão da apropriação de juros abaixo) — não o método de juros efetivos
  // da norma, que exigiria recalcular a taxa implícita do contrato inteiro.
  const costTotal = r2(contract.other_fees || 0);
  const amortizeCost = contract.transaction_cost_recognition === "amortizado" && costTotal > 0;
  const costTermDays = (rows[rows.length - 1].date - liberationDate) / 86400000;
  const costAccruedThrough = (limit) => {
    if (!amortizeCost) return 0;
    if (!(costTermDays > 0)) return limit >= liberationDate ? costTotal : 0;
    const days = Math.min(costTermDays, Math.max(0, (limit - liberationDate) / 86400000));
    return r2(costTotal * (days / costTermDays));
  };

  if (liberationDate >= monthStart && liberationDate <= monthEnd) {
    if (initialPrincipal) push(SETTLEMENT_EVENT_TYPES.LIBERACAO, r2(initialPrincipal), liberationIso, "abertura", { bankAccountId: contract.disbursement_bank_account_id || null });
    if ((contract.iof_value || 0) > 0) push(SETTLEMENT_EVENT_TYPES.IOF, r2(contract.iof_value), liberationIso, "abertura");
    if (costTotal > 0) {
      // Reconhecimento imediato: despesa direto. Amortizado: vai para o ativo diferido (custo a apropriar);
      // a despesa só entra mês a mês, no bloco de apropriação abaixo.
      push(amortizeCost ? SETTLEMENT_EVENT_TYPES.CUSTO_TRANSACAO_DIFERIDO : SETTLEMENT_EVENT_TYPES.CUSTO_TRANSACAO_INICIAL, costTotal, liberationIso, "abertura");
    }
  }

  // Juros apropriados por competência (acumulado até o fim do mês − acumulado até o fim do mês anterior).
  const interestMonth = r2(accruedThrough(monthEnd) - accruedThrough(prevMonthEnd));
  if (interestMonth) push(SETTLEMENT_EVENT_TYPES.JUROS_APROPRIADOS, interestMonth, monthEndIso, "competencia");

  // Apropriação do custo de transação diferido: mesmo padrão pro-rata por dias corridos dos juros acima.
  // Quitação antecipada ou renegociação (payoff_date cai neste mês): reconhece de uma vez o saldo restante do
  // ativo diferido, na data da baixa, em vez de continuar o rateio mês a mês.
  if (amortizeCost) {
    const payoffDateObj = payoffIso ? new Date(payoffIso + "T12:00:00") : null;
    const payoffInThisMonth = Boolean(payoffDateObj && payoffDateObj >= monthStart && payoffDateObj <= monthEnd);
    const prevCostAccrued = costAccruedThrough(prevMonthEnd);
    const costMonth = payoffInThisMonth ? r2(costTotal - prevCostAccrued) : r2(costAccruedThrough(monthEnd) - prevCostAccrued);
    const costDateIso = payoffInThisMonth ? payoffIso : monthEndIso;
    if (costMonth > 0.005) push(SETTLEMENT_EVENT_TYPES.CUSTO_TRANSACAO_APROPRIACAO, costMonth, costDateIso, "apropriacao");
  }

  rows.forEach((r) => {
    const { row, idx, settlement } = r;
    const rowDate = r.date;
    const inMonthRow = rowDate >= monthStart && rowDate <= monthEnd;
    const inMonthPay = r.payDate >= monthStart && r.payDate <= monthEnd;
    const payDateIso = r.payIso || row.dataVencimento;
    const origin = settlement ? `baixa-${settlement.id}` : `parcela-${row.parcela}`;

    // Parcela vencida até o fim do mês, sem baixa (regra de baixa efetiva ou implantação): pendência.
    if (r.unpaidByRule && rowDate <= monthEnd && ((r.scheduledPrincipal || 0) > 0 || (r.scheduledInterest || 0) > 0)) {
      result.pendingUnsettled.push({
        contractId: contract.id,
        contractNumber: contract.contract_number,
        parcela: row.parcela,
        dataVencimento: row.dataVencimento,
        principal: r2(r.scheduledPrincipal || 0),
        juros: r2(r.scheduledInterest || 0),
      });
    }

    // Eventos do cronograma: no mês da data da parcela.
    if (inMonthRow) {
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
    }

    // Eventos de pagamento: no mês da DATA REAL do pagamento (parcela paga em atraso cai no mês em que foi paga).
    if (inMonthPay) {
      if (r.principalPaid) push(SETTLEMENT_EVENT_TYPES.PAGAMENTO_PRINCIPAL, r2(r.principalPaid), payDateIso, origin, { extraordinary: settlement?.extraordinary_amortization, bankAccountId: settlement?.bank_account_id || null });
      if (r.interestPaid) push(SETTLEMENT_EVENT_TYPES.PAGAMENTO_JUROS, r2(r.interestPaid), payDateIso, origin, { bankAccountId: settlement?.bank_account_id || null });

      if (settlement) {
        result.settlementsUsed.push(settlement.id);
        const extra = (type, amount) => push(type, r2(amount), payDateIso, origin);
        if (settlement.penalty_paid) extra(SETTLEMENT_EVENT_TYPES.MULTA_MORA, settlement.penalty_paid);
        if (settlement.fee_paid) extra(SETTLEMENT_EVENT_TYPES.TARIFA_BANCARIA, settlement.fee_paid);
        if (settlement.discount_amount) extra(SETTLEMENT_EVENT_TYPES.DESCONTO_FINANCEIRO, settlement.discount_amount);
        if (settlement.rounding_adjustment) extra(SETTLEMENT_EVENT_TYPES.AJUSTE_ARREDONDAMENTO, settlement.rounding_adjustment);
        if (settlement.other_amount) extra(SETTLEMENT_EVENT_TYPES.OUTROS, settlement.other_amount);
        if (settlement.triggers_recalculation && !settlement.recalculation_snapshot_id) {
          result.pendingRecalculation.push(settlement.id);
        }

        const ptaxPagamento = settlement.exchange_rate_pagamento;
        const sdInicialUSD = row.blocoContabil?.sd_inicial_usd ?? row.sdInicial_USD;
        const ptaxAssumida = row.blocoContabil?.ptax_anterior ?? row.blocoContabil?.ptax_atual;
        if (ptaxPagamento && sdInicialUSD && ptaxAssumida) {
          const fxRealizado = r2(sdInicialUSD * (ptaxPagamento - ptaxAssumida));
          if (fxRealizado) {
            push(
              fxRealizado >= 0 ? SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA_REALIZADA : SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA_REALIZADA,
              r2(Math.abs(fxRealizado)),
              payDateIso,
              origin
            );
          }
        }
      }
    }
  });

  // Contrato indexado com cronograma recalculado pelas taxas publicadas: a provisão de juros já lançada (saldo de juros
  // a pagar do fechamento anterior, ou a posição da implantação) é ajustada para a estimativa atual, no mês corrente.
  // Mês fechado não é reaberto; o principal recalculado que difere do lançado é apenas sinalizado.
  const trueUp = options.trueUpContracts && options.trueUpContracts[contract.id] && !contract.currency_id;
  if (trueUp) {
    const ledger = cutoffIso && deploymentStart ? deploymentStart : options.ledgerPrev && options.ledgerPrev[contract.id];
    if (ledger) {
      const adjInterest = r2(engineOpening.interest - ledger.interest);
      const adjPrincipal = r2(engineOpening.principal - ledger.principal);
      if (Math.abs(adjInterest) >= 0.01) {
        const dir = adjInterest > 0 ? "aumento" : "reducao";
        push(SETTLEMENT_EVENT_TYPES.AJUSTE_PROVISAO_JUROS, r2(Math.abs(adjInterest)), monthEndIso, "ajuste-" + dir, { direction: dir });
      }
      result.opening = { principal: r2(ledger.principal), interest: r2(ledger.interest), fx: engineOpening.fx };
      if (Math.abs(adjPrincipal) >= 0.01) result.fxIssues.push({ type: "principal_recalculado", contractNumber: contract.contract_number, diferenca: adjPrincipal });
    }
  }

  // Moeda estrangeira: remensuração pela PTAX de fechamento (só quando as cotações são informadas).
  if (contract.currency_id && options.fxRates && options.fxRates[contract.currency_id]?.length) {
    applyForeignRemeasurement({ contract, schedule, settlements, options, result, yearNum, monthNum, monthStart, monthEndIso, engineOpening, deploymentStart });
  }

  return result;
}

function addMonths(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------
// Moeda estrangeira: remensuração do passivo pela PTAX de fechamento (CPC 02 (R2), item 23 e 28).
//
// Os itens monetários em moeda estrangeira são convertidos pela taxa de fechamento — a taxa à vista vigente ao
// término do período — e a variação cambial vai para o resultado do período. Aqui: PTAX de venda do BACEN da data
// de fechamento (último dia útil do mês; sem cotação no dia, a última publicada, no máximo 7 dias antes).
// O passivo em reais do mês é o saldo em moeda × PTAX de fechamento; a variação cambial do mês é a diferença
// entre esse saldo e (saldo anterior lançado + movimentos do mês em reais), e substitui a variação projetada
// pelo cronograma (que repete a última cotação) e a "realizada" (já embutida na diferença).
// ---------------------------------------------------------------------------------------------------
const FX_EVENT_TYPES = new Set([
  SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA,
  SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA,
  SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA_REALIZADA,
  SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA_REALIZADA,
]);

function scheduleRowsOf(contract) {
  try {
    const parsed = typeof contract.schedule_data === "string" ? JSON.parse(contract.schedule_data) : contract.schedule_data;
    return parsed?.schedule || [];
  } catch {
    return [];
  }
}

/**
 * Visão em moeda estrangeira do contrato: cronograma em USD (saldos, amortização, juros) sem o bloco contábil em
 * reais, para reaproveitar a mesma apuração. O resultado é convertido depois pela PTAX de fechamento.
 */
export function toForeignView(contract, scheduleRows) {
  const schedule = scheduleRows || scheduleRowsOf(contract);
  const rows = schedule.map((r) => {
    const { blocoContabil, ...rest } = r;
    return {
      ...rest,
      sdInicial: r.sdInicial_USD ?? 0,
      sdFinal: r.sdFinal_USD ?? 0,
      amortizacao: r.amortizacao_USD ?? 0,
      jurosFixosMes: r.jurosFixosMes_USD ?? 0,
      jurosVariaveisMes: r.jurosVariaveisMes_USD ?? 0,
      liberacaoInjetada: r.liberacaoInjetada_USD ?? 0,
      varCambial: 0,
      ajusteCambialMes: 0,
    };
  });
  return {
    ...contract,
    currency_id: null,
    operation_value: contract.amount_foreign ?? contract.operation_value,
    schedule_data: { schedule: rows },
  };
}

/** Último dia útil (segunda a sexta, fora feriados) até a data. holidays: lista ou Set de AAAA-MM-DD. */
export function lastBusinessDayOnOrBefore(iso, holidays) {
  const skip = holidays instanceof Set ? holidays : new Set(holidays || []);
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 15; i++) {
    const day = dt.getUTCDay();
    const cur = dt.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !skip.has(cur)) return cur;
    dt.setUTCDate(dt.getUTCDate() - 1);
  }
  return iso;
}

/** Cotação vigente na data: a mais recente até ela, no máximo maxAgeDays antes. list = [{rate_date, rate}] em ordem crescente. */
export function fxRateOn(list, iso, maxAgeDays = 7) {
  if (!Array.isArray(list) || !list.length || !iso) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].rate_date <= iso) {
      const age = (new Date(iso + "T12:00:00") - new Date(list[i].rate_date + "T12:00:00")) / 86400000;
      return age <= maxAgeDays && Number(list[i].rate) > 0 ? { rate: Number(list[i].rate), date: list[i].rate_date } : null;
    }
  }
  return null;
}

// Baixa em reais -> baixa em moeda: a mesma fração da parcela que foi paga (baixa parcial reduz proporcionalmente).
function foreignSettlement(settlement, scheduleRows) {
  const row = scheduleRows.find((r) => parcelaKey(r.parcela) === parcelaKey(settlement.parcela));
  if (!row) return settlement;
  const bloco = row.blocoContabil || {};
  const schedP = bloco.amortizacaoPagaBRL ?? 0;
  const schedI = bloco.jurosPagosBRL ?? 0;
  const rp = schedP > 0 ? Math.min(1, (settlement.principal_paid || 0) / schedP) : 1;
  const ri = schedI > 0 ? Math.min(1, (settlement.interest_paid || 0) / schedI) : 1;
  return { ...settlement, principal_paid: r2((row.amortizacao_USD || 0) * rp), interest_paid: r2((row.jurosPagos || 0) * ri) };
}

function applyForeignRemeasurement({ contract, schedule, settlements, options, result, yearNum, monthNum, monthStart, monthEndIso, engineOpening, deploymentStart }) {
  const list = options.fxRates[contract.currency_id];
  const monthStartIso = isoOf(monthStart);
  const from = isoDateOnly(options.fxRemeasureFrom || "");
  // Fechamentos anteriores à regra seguem o cronograma (não mudam o que já foi fechado).
  if (from && monthStartIso < from) return;

  const todayIso = isoDateOnly(options.today) || isoOf(new Date());
  const provisional = monthEndIso > todayIso;
  const endRef = provisional ? todayIso : monthEndIso;
  const ptaxEnd = fxRateOn(list, endRef);
  if (!ptaxEnd) {
    result.fxIssues.push({ type: "ptax_ausente", contractNumber: contract.contract_number, date: endRef });
    return;
  }

  // A PTAX do último dia útil precisa estar carregada: a mais recente só vale se ela é a do último dia útil.
  // (Fim de semana e feriado usam a do último dia útil; competência em andamento é provisória.)
  if (!provisional) {
    const expected = lastBusinessDayOnOrBefore(monthEndIso, options.holidays);
    if (ptaxEnd.date < expected) {
      result.fxIssues.push({ type: "ptax_defasada", contractNumber: contract.contract_number, esperada: expected, usada: ptaxEnd.date });
    }
  }

  const view = toForeignView(contract, schedule);
  const usdSettlements = settlements.filter((s) => s.status !== "estornado").map((s) => foreignSettlement(s, schedule));
  const recU = reconcileContractForCompetencia(view, yearNum, monthNum, usdSettlements, { requireSettlementFrom: options.requireSettlementFrom });
  const openUSD = recU.opening.principal + recU.opening.interest;

  // Saldo lançado no início do mês: a posição da implantação, o saldo do cronograma no 1º mês sob a regra
  // (o que já estava lançado antes) ou o saldo em moeda × PTAX do fim do mês anterior.
  let prev;
  const legacyStart = Boolean(from) && monthStartIso === from && !deploymentStart;
  if (deploymentStart) prev = { principal: deploymentStart.principal, interest: deploymentStart.interest };
  else if (legacyStart) prev = { principal: engineOpening.principal, interest: engineOpening.interest };
  else if (Math.abs(openUSD) < EPS) prev = { principal: 0, interest: 0 };
  else {
    const prevEndIso = isoOf(new Date(yearNum, monthNum - 1, 0));
    const ptaxPrev = fxRateOn(list, prevEndIso);
    if (!ptaxPrev) {
      result.fxIssues.push({ type: "ptax_ausente", contractNumber: contract.contract_number, date: prevEndIso });
      return;
    }
    prev = { principal: r2(recU.opening.principal * ptaxPrev.rate), interest: r2(recU.opening.interest * ptaxPrev.rate) };
  }

  const endPrincipal = r2(recU.closing.principal * ptaxEnd.rate);
  const endInterest = r2(recU.closing.interest * ptaxEnd.rate);
  // Movimentos do mês em reais (liberação, juros, pagamentos...), sem a variação cambial do cronograma.
  const flowsExFx = (result.closing.principal + result.closing.interest) - (engineOpening.principal + engineOpening.interest) - (result.closing.fx - engineOpening.fx);
  const adjustment = r2(endPrincipal + endInterest - (prev.principal + prev.interest) - flowsExFx);

  result.events = result.events.filter((e) => !FX_EVENT_TYPES.has(e.type));
  if (Math.abs(adjustment) >= 0.01) {
    const type = adjustment > 0 ? SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA : SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA;
    result.events.push({
      type, amount: r2(Math.abs(adjustment)), date: monthEndIso, key: eventKey(contract.id, type, monthEndIso, "remensuracao"),
      remeasurement: true, ptax: ptaxEnd.rate, ptaxDate: ptaxEnd.date,
    });
  }
  result.opening = { principal: r2(prev.principal), interest: r2(prev.interest), fx: engineOpening.fx };
  result.closing = { principal: endPrincipal, interest: endInterest, fx: result.closing.fx };
  result.remeasurement = { ptax: ptaxEnd.rate, ptaxDate: ptaxEnd.date, provisional, adjustment, saldoMoeda: r2(recU.closing.principal + recU.closing.interest) };
  if (provisional) result.fxIssues.push({ type: "ptax_provisoria", contractNumber: contract.contract_number, date: ptaxEnd.date });
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
    let curr = splitCirculanteNaoCirculante(contract, cutoff);
    let prev = splitCirculanteNaoCirculante(contract, previousCutoff);
    // Moeda estrangeira: os baldes são calculados em moeda e convertidos pela PTAX de fechamento (mesma taxa nos dois
    // pontos: só a migração entre circulante e não circulante conta; a variação cambial fica na remensuração).
    const fxList = contract.currency_id && options.fxRates ? options.fxRates[contract.currency_id] : null;
    if (fxList && fxList.length) {
      const todayIso = isoDateOnly(options.today) || isoOf(new Date());
      const ptaxClose = fxRateOn(fxList, cutoff > todayIso ? todayIso : cutoff);
      if (ptaxClose) {
        const view = toForeignView(contract);
        const scale = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v * ptaxClose.rate)]));
        curr = scale(splitCirculanteNaoCirculante(view, cutoff));
        prev = scale(splitCirculanteNaoCirculante(view, previousCutoff));
      }
    }
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
    fxIssues: perContract.flatMap((c) => c.fxIssues || []),
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

export const OPENING_EVENT_TYPE = "abertura_implantacao";

/**
 * Lançamento de abertura da Implantação de Saldos: um lançamento por contrato, contra a conta
 * transitória, com os valores da FOTOGRAFIA aprovada (não recalcula nada).
 *   Débito  — conta transitória (total do contrato)
 *   Crédito — passivo principal circulante / não circulante e provisão de juros circulante / não circulante
 * A data do lançamento é a da virada. Cada linha tem chave de idempotência
 * (abertura|configuração|contrato|componente): lançar duas vezes não duplica.
 */
const OPENING_ACCOUNT_PARTS = [
  ["principalCP", "principal_cp", "principal_cp_account_id", "principal circulante"],
  ["principalLP", "principal_lp", "principal_lp_account_id", "principal não circulante"],
  ["jurosCP", "juros_cp", "juros_cp_account_id", "provisão de juros circulante"],
  ["jurosLP", "juros_lp", "juros_lp_account_id", "provisão de juros não circulante"],
];

/**
 * Contas de passivo da abertura para uma categoria de operação: as da própria categoria
 * (config.category_accounts, ou as congeladas na fotografia); sem elas, as quatro colunas antigas
 * (uma conta para todas as categorias). Devolve null se faltar alguma das quatro.
 */
export function resolveOpeningAccounts(config, category, snapshot = null) {
  const key = category || "emprestimos";
  const parse = (v) => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v || null; };
  const own = (parse(snapshot?.contas?.categorias) || parse(config?.category_accounts) || {})[key];
  if (own && OPENING_ACCOUNT_PARTS.every(([, k]) => own[k])) {
    return Object.fromEntries(OPENING_ACCOUNT_PARTS.map(([part, k]) => [part, own[k]]));
  }
  if (config && OPENING_ACCOUNT_PARTS.every(([, , col]) => config[col])) {
    return Object.fromEntries(OPENING_ACCOUNT_PARTS.map(([part, , col]) => [part, config[col]]));
  }
  return null;
}

export function buildOpeningEntries(config, snapshot) {
  if (!config || !snapshot?.contratos?.length) return [];
  const date = String(config.data_virada || "").slice(0, 10);
  const entries = [];
  snapshot.contratos.forEach((c) => {
    const pos = c.position || {};
    const accounts = resolveOpeningAccounts(config, c.operationCategory, snapshot);
    if (!accounts) return;
    const credits = OPENING_ACCOUNT_PARTS
      .map(([part, , , label]) => ({ k: part, account: accounts[part], label, amount: r2(pos[part]) }))
      .filter((p) => p.amount > 0);
    const total = r2(credits.reduce((s, p) => s + p.amount, 0));
    if (!total) return;
    const historico = `Abertura da implantação de saldos — contrato ${c.contractNumber}`;
    const base = { contract_id: c.contractId, event_type: OPENING_EVENT_TYPE, entry_date: date, historico };
    entries.push({ ...base, account_id: config.transitoria_account_id, side: "debito", amount: total, event_key: `abertura|${config.id}|${c.contractId}|transitoria` });
    credits.forEach((p) => entries.push({ ...base, account_id: p.account, side: "credito", amount: p.amount, historico: `${historico} (${p.label})`, event_key: `abertura|${config.id}|${c.contractId}|${p.k}` }));
  });
  return entries;
}

export function buildJournalEntries(reconciliation, eventMappings, entryDate, bankAccountsById = new Map(), openingEntries = []) {
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
    const historico = evt.remeasurement
      ? `${EVENT_TYPE_LABELS[evt.type] || evt.type} — remensuração pela PTAX de ${evt.ptaxDate} (${Number(evt.ptax).toFixed(4)}) — ${evt.date || entryDate}`
      : `${EVENT_TYPE_LABELS[evt.type] || evt.type} — ${evt.date || entryDate}`;
    let debitAccountId = mapping.debit_account_id;
    let creditAccountId = mapping.credit_account_id;
    if ((RECLASSIFICATION_EVENT_TYPES.has(evt.type) && evt.direction === "to_nao_circulante")
      || (evt.type === SETTLEMENT_EVENT_TYPES.AJUSTE_PROVISAO_JUROS && evt.direction === "reducao")) {
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

  // Abertura da implantação de saldos (contas já definidas na configuração, não passam pela matriz).
  openingEntries.forEach((e) => entries.push(e));

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
  const fxBlocking = (reconciliation.fxIssues || []).filter((f) => f.type === "ptax_ausente" || f.type === "ptax_defasada");
  if (fxBlocking.length > 0) {
    const fmt = (iso) => String(iso || "").split("-").reverse().join("/");
    const detail = fxBlocking.map((f) => (f.type === "ptax_defasada"
      ? `${f.contractNumber} (esperada ${fmt(f.esperada)}, disponível ${fmt(f.usada)})`
      : `${f.contractNumber} (sem cotação até ${fmt(f.date)})`)).join("; ");
    reasons.push(`PTAX de fechamento do último dia útil não carregada: ${detail}. Atualize as cotações em Moedas e calcule de novo.`);
  }
  if (previousClosingApproved === false) reasons.push("A competência anterior ainda não está aprovada.");

  return { canApprove: reasons.length === 0, reasons };
}
