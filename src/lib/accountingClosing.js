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
// resolver pelo fluxo já existente de reabertura do contrato na Calculadora
// — o mesmo caminho que já gera snapshots "RECALCULATED" hoje.

import { OPERATION_CATEGORIES } from "./contractOptions.js";

// Rótulos de categoria de operação (empréstimos/financiamentos/mútuos com
// partes relacionadas/mútuos com terceiros) — reaproveitados aqui só pra
// montar mensagens legíveis; a matriz contábil do Fechamento é configurada
// por evento + categoria (ver AccountingEventMapping), não só por evento,
// porque contas de mútuos com partes relacionadas e com terceiros precisam
// ficar separadas entre si e do restante no balancete.
export const OPERATION_CATEGORY_LABELS = Object.fromEntries(
  OPERATION_CATEGORIES.map((c) => [c.value, c.label])
);

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

// payoff_date/operation_date podem vir como Date ou string — normaliza pra "YYYY-MM-DD".
function isoDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

/**
 * ---- Parâmetros de materialidade da baixa (painel de configuração) ----
 *
 * Na prática, o valor efetivamente pago (extrato do banco) quase nunca bate
 * cravado com o principal/juros calculados pelo motor de cálculo — base de
 * dias, arredondamentos e pequenas diferenças de metodologia entre os dois
 * motores são normais. A regra de negócio (decidida com o cliente em
 * ago/2026) é: aceitar automaticamente como "ajuste de arredondamento"
 * qualquer diferença dentro da margem abaixo, sem exigir que ninguém —
 * usuário na baixa manual, ou uma futura integração automática de títulos
 * pagos — discrimine isso manualmente. Acima da margem, a diferença é
 * grande demais pra ser "só arredondamento": bloqueia até alguém
 * reclassificar conscientemente (evita mascarar amortização extraordinária,
 * juro a maior/menor ou encargo bancário real como se fosse ruído).
 *
 * Ajuste os dois valores abaixo pra mudar a política — usada tanto pela
 * baixa manual (SettlementDialog, em FechamentoContabil.jsx) quanto por
 * qualquer integração automática de títulos que vier a existir, pra sempre
 * aplicar exatamente a mesma régua nas duas vias.
 */
export const SETTLEMENT_MATERIALITY_CONFIG = {
  // Percentual da parcela (principal + juros previstos) aceito automaticamente.
  percentThreshold: 0.01, // 1%
  // Piso mínimo em R$ — evita que parcelas pequenas travem por diferenças
  // irrisórias de poucos centavos (1% de uma parcela pequena pode dar menos
  // que isso).
  floorAmount: 10,
};

/**
 * Avalia se a diferença entre o valor efetivamente pago e o valor calculado
 * (principal + juros previstos pelo cronograma) está dentro da margem de
 * arredondamento aceitável — ver SETTLEMENT_MATERIALITY_CONFIG acima.
 *
 * @param {number} paidTotal - valor total efetivamente pago (extrato)
 * @param {number} scheduledPrincipal - principal previsto pelo cronograma
 * @param {number} scheduledInterest - juros previstos pelo cronograma
 * @param {{percentThreshold:number, floorAmount:number}} [config]
 */
export function evaluateSettlementMateriality(
  paidTotal,
  scheduledPrincipal,
  scheduledInterest,
  config = SETTLEMENT_MATERIALITY_CONFIG
) {
  const parcelaTotal = r2((scheduledPrincipal || 0) + (scheduledInterest || 0));
  const diferenca = r2((paidTotal || 0) - parcelaTotal);
  const thresholdAmount = r2(Math.max((config.percentThreshold || 0) * parcelaTotal, config.floorAmount || 0));
  const percentual = parcelaTotal > EPS ? Math.abs(diferenca) / parcelaTotal : (Math.abs(diferenca) > EPS ? 1 : 0);
  const withinMargin = Math.abs(diferenca) <= thresholdAmount + EPS;
  return { parcelaTotal, diferenca, thresholdAmount, percentual, withinMargin };
}

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

  const scheduledPrincipal = r2(scheduleRow?.amortizacao || 0);
  const scheduledInterest = r2(scheduleRow?.jurosPagos ?? ((scheduleRow?.jurosFixosMes || 0) + (scheduleRow?.jurosVariaveisMes || 0)));

  if (scheduleRow && (settlement.principal_paid || 0) > scheduledPrincipal + EPS) {
    warnings.push("Principal pago é maior que o previsto — será tratado como amortização extraordinária.");
  }

  // Regra de materialidade (ver SETTLEMENT_MATERIALITY_CONFIG): diferenças
  // pequenas entre o pago e o calculado são normais (base de dias,
  // arredondamento) e cabem em "ajuste de arredondamento" sem
  // questionamento. Diferenças grandes demais pra isso são bloqueadas —
  // precisam ser reclassificadas manualmente em multa/tarifa/outros, ou em
  // principal/juros se o pagamento realmente destoou do programado.
  const materiality = evaluateSettlementMateriality(totalPaid, scheduledPrincipal, scheduledInterest);
  if (Math.abs(settlement.rounding_adjustment || 0) > materiality.thresholdAmount + EPS) {
    blockers.push(
      `O "ajuste de arredondamento" informado (R$ ${Math.abs(settlement.rounding_adjustment || 0).toFixed(2)}) está acima da ` +
      `margem aceitável pra essa parcela (R$ ${materiality.thresholdAmount.toFixed(2)} — ` +
      `${(SETTLEMENT_MATERIALITY_CONFIG.percentThreshold * 100).toFixed(0)}% da parcela ou o piso mínimo, o que for maior). ` +
      "Diferenças desse tamanho não podem ser tratadas como arredondamento — mova o valor pra Multa/Tarifa/Outros, " +
      "ou ajuste Principal/Juros pago se o pagamento realmente foi diferente do previsto."
    );
  }

  return { valid: blockers.length === 0, blockers, warnings };
}

/**
 * Decide se uma baixa exige recálculo do cronograma do contrato (evento
 * RECALCULATED, via o fluxo já existente de reabertura na Calculadora).
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

  // Implantação de saldos: parcelas até a data de corte informadas como vencidas em aberto continuam
  // devidas depois da virada — só saem do saldo quando existir baixa.
  const deployOpen = new Set((() => {
    let list = contract.deployment_open_parcelas;
    if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
    return (Array.isArray(list) ? list : []).map((p) => String(Number(p)));
  })());

  // Linhas com pagamento efetivo já resolvido (baixa x cronograma x regra de baixa efetiva).
  const rows = schedule.map((row, idx) => {
    const settlement = settlementsByParcela.get(String(row.parcela));
    const unpaidByDeployment = Boolean(cutoffIso) && row.dataVencimento <= cutoffIso && deployOpen.has(String(Number(row.parcela))) && !settlement;
    const unpaidByRule = unpaidByDeployment || (Boolean(requireFrom) && row.dataVencimento >= requireFrom && !settlement);
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

  return result;
}

function addMonths(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Separa, a partir do cronograma contratual (schedule_data), o saldo ainda
 * NÃO vencido de principal e de juros apropriados-mas-não-pagos entre
 * "circulante" (liquida em até 12 meses da data de corte) e "não circulante"
 * (depois disso) — mesma régua de 0-12 meses já usada em
 * getDebtMaturityBreakdown (aba Posição Contábil), pra este módulo nunca
 * destoar do que já é mostrado lá.
 *
 * Linhas já vencidas na data de corte (rowDate <= cutoff) não entram no
 * split de principal — nesse ponto já são uma baixa a resolver no Step 1,
 * não mais um problema de classificação LP/CP. Para juros, o que importa é
 * o saldo ACUMULADO já apropriado e ainda não pago (jurosLedger) e a data
 * do próximo pagamento de juros previsto: se essa liquidação está a mais de
 * 12 meses da data de corte, o saldo inteiro é não circulante; senão, é
 * circulante inteiro (não é um valor que se parcela ao longo do tempo como
 * o principal — liquida de uma vez, na próxima parcela que pagar juros).
 *
 * @param {Object} contract
 * @param {string} cutoffDate - YYYY-MM-DD (data-base do fechamento)
 */
export function splitCirculanteNaoCirculante(contract, cutoffDate) {
  const result = { principalShort: 0, principalLong: 0, jurosShort: 0, jurosLong: 0 };
  // Contrato já renegociado/quitado antecipadamente na data de corte (ou
  // antes) — não tem mais saldo a classificar em circulante/não circulante.
  if (contract.payoff_date && contract.payoff_date <= cutoffDate) return result;
  if (!contract.schedule_data) return result;

  let schedule;
  try {
    schedule = JSON.parse(contract.schedule_data).schedule || [];
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

/**
 * Concilia todos os contratos de uma empresa para a competência e agrega os
 * eventos — a base do Step 2 (tabela de conciliação) e do Step 3 (insumo
 * para os lançamentos).
 *
 * @param {Array} contracts - contratos já filtrados por entity_id + aprovados
 * @param {Map<string, Array>} settlementsByContract - contract_id -> baixas
 * @param {string} [dataBase] - data-base do fechamento (YYYY-MM-DD); se
 *   omitida, cai no último dia do mês (competência fechada em cheio).
 */
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

  // Reclassificação circulante/não circulante — compara o saldo ainda não
  // vencido (principal e juros apropriados não pagos) na data-base atual
  // contra um mês antes, contrato por contrato. A diferença é o valor que
  // "andou" de um balde pro outro só com a passagem do tempo.
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
 *   Crédito — passivo principal circulante / não circulante e juros a pagar circulante / não circulante
 * A data do lançamento é a da virada. Cada linha tem chave de idempotência
 * (abertura|configuração|contrato|componente): lançar duas vezes não duplica.
 */
export function buildOpeningEntries(config, snapshot) {
  if (!config || !snapshot?.contratos?.length) return [];
  const date = String(config.data_virada || "").slice(0, 10);
  const parts = [
    ["principalCP", config.principal_cp_account_id, "principal circulante"],
    ["principalLP", config.principal_lp_account_id, "principal não circulante"],
    ["jurosCP", config.juros_cp_account_id, "juros a pagar circulante"],
    ["jurosLP", config.juros_lp_account_id, "juros a pagar não circulante"],
  ];
  const entries = [];
  snapshot.contratos.forEach((c) => {
    const pos = c.position || {};
    const credits = parts.map(([k, account, label]) => ({ k, account, label, amount: r2(pos[k]) })).filter((p) => p.amount > 0);
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
    const historico = `${EVENT_TYPE_LABELS[evt.type] || evt.type} — ${evt.date || entryDate}`;
    // Nos dois eventos de reclassificação, "conta de débito" na matriz
    // significa sempre "conta não circulante" e "conta de crédito" sempre
    // "conta circulante" — mas qual das duas efetivamente debita e qual
    // credita no lançamento depende do sentido do movimento do mês (o
    // normal é migrar de não circulante pra circulante; o inverso só
    // acontece se um recálculo esticar o prazo do contrato).
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

/**
 * Gate final do botão "Aprovar fechamento" (Step 3) — reúne todas as
 * condições combinadas com o ChatGPT no desenho original.
 */
export function canApproveClosing({ journalResult, reconciliation, previousClosingApproved, hasUnresolvedSettlementBlockers }) {
  const reasons = [];
  if (!journalResult.balanced) reasons.push("Total de débitos e créditos não coincide.");
  if (journalResult.missingMappings.length > 0) {
    const labels = journalResult.missingMappings.map(
      (m) => `${EVENT_TYPE_LABELS[m.type] || m.type} (${OPERATION_CATEGORY_LABELS[m.operationCategory] || m.operationCategory})`
    );
    reasons.push(`Matriz contábil incompleta para: ${labels.join(", ")}. Complete em Configurações → Lógica Contábil.`);
  }
  if (reconciliation.hasBlockingDivergence) {
    reasons.push("Existem baixas que exigem recálculo do contrato antes de aprovar (reabra o contrato na Calculadora).");
  }
  if (hasUnresolvedSettlementBlockers) reasons.push("Existem baixas pendentes de validação.");
  if (previousClosingApproved === false) reasons.push("A competência anterior ainda não está aprovada.");

  return { canApprove: reasons.length === 0, reasons };
}
