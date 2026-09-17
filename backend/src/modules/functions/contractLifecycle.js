import * as store from "../entities/store.js";
import { roundMoney } from "../../engine/CalculationEngine.js";

const DISCOUNT_MODES = ["juros_futuros", "percentual_saldo", "valor_fixo"];

function parseScheduleData(raw) {
  if (!raw) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed?.schedule) ? parsed.schedule : [];
}

// Saldo devedor "as of" uma data de corte, direto do schedule_data já
// calculado (granularidade mensal, sem juros pro-rata-dia — ver plano
// "Renegociação de contrato e Quitação antecipada com desconto", fora de
// escopo por ora). A linha cujo vencimento é a primeira >= cutoffDate ainda
// não venceu — seu sdInicial é o saldo devedor "hoje". Se a data de corte
// for depois de tudo, usa o sdFinal da última linha (deveria ser ~0).
function balanceAsOfDate(schedule, cutoffDate) {
  if (!schedule.length) return 0;
  const nextRow = schedule.find((r) => r.dataVencimento >= cutoffDate);
  if (nextRow) return Number(nextRow.sdInicial) || 0;
  return Number(schedule[schedule.length - 1].sdFinal) || 0;
}

export async function calculateContractBalanceAsOf(payload = {}) {
  const { contractId, asOfDate } = payload;
  if (!contractId || !asOfDate) {
    const err = new Error("contractId e asOfDate são obrigatórios");
    err.status = 400;
    throw err;
  }
  const contract = await store.getById("LoanContract", contractId);
  const schedule = parseScheduleData(contract.schedule_data);
  const balance = balanceAsOfDate(schedule, asOfDate);
  return { contract_id: contractId, as_of_date: asOfDate, balance };
}

// Renegociação: encerra a vigência atual (marca 'renegociado') e cria uma
// nova LoanContract com o saldo (líquido de entrada) como principal —
// mesmo espírito de renewGuaranteedAccount() em guaranteedAccount.js, mas
// pra contratos amortizados (SAC/PRICE/etc, com cronograma fixo) em vez de
// conta garantida (saldo rotativo sem cronograma). Termos novos (taxa,
// sistema, carência, periodicidade) ficam em branco — o usuário preenche
// na Calculadora antes de calcular/enviar pra aprovação, sem nenhuma
// novidade no motor de cálculo.
export async function renegotiateContract(payload = {}, actor = "system") {
  const { contractId, renegotiationDate, entrada = 0 } = payload;
  if (!contractId || !renegotiationDate) {
    const err = new Error("contractId e renegotiationDate são obrigatórios");
    err.status = 400;
    throw err;
  }
  const oldContract = await store.getById("LoanContract", contractId);
  if (oldContract.status !== "aprovado") {
    const err = new Error("Só é possível renegociar um contrato aprovado");
    err.status = 409;
    throw err;
  }
  const schedule = parseScheduleData(oldContract.schedule_data);
  const balance = balanceAsOfDate(schedule, renegotiationDate);
  const novoPrincipal = Math.max(0, roundMoney(balance - (Number(entrada) || 0)));

  const newContract = await store.create(
    "LoanContract",
    {
      group_id: oldContract.group_id,
      entity_id: oldContract.entity_id,
      bank_id: oldContract.bank_id,
      disbursement_bank_account_id: oldContract.disbursement_bank_account_id,
      contract_number: `${oldContract.contract_number}-REN${Date.now().toString().slice(-4)}`,
      operation_category: oldContract.operation_category,
      operation_type: oldContract.operation_type,
      operation_value: novoPrincipal,
      operation_date: renegotiationDate,
      renegotiated_from_id: contractId,
      guarantee_real_type: oldContract.guarantee_real_type,
      guarantee_personal_type: oldContract.guarantee_personal_type,
    },
    actor
  );

  await store.update("LoanContract", contractId, {
    status: "renegociado",
    payoff_date: renegotiationDate,
    rejection_comments: `Renegociado em ${renegotiationDate} — novo contrato ${newContract.contract_number}. `
      + `Saldo apurado: ${balance.toFixed(2)}${Number(entrada) > 0 ? `; entrada: ${Number(entrada).toFixed(2)}` : ""}; `
      + `novo principal: ${novoPrincipal.toFixed(2)}.`,
  });

  return {
    old_contract_id: contractId,
    new_contract_id: newContract.id,
    new_contract_number: newContract.contract_number,
    saldo_apurado: balance,
    entrada: Number(entrada) || 0,
    novo_principal: novoPrincipal,
  };
}

// Quitação antecipada: calcula o valor final conforme o modo de desconto
// negociado, registra uma baixa extraordinária (contract_settlements,
// mesmo schema já usado no Fechamento Contábil) e envia o contrato pra
// 'pendente_aprovacao' — reaproveita a MESMA alçada de aprovação de
// nível 1/2 de um contrato novo (ver applyLoanContractRules em
// entities/store.js: aprovar essa pendência específica grava 'quitado' em
// vez de 'aprovado' comum, por já ter settlement_discount_mode setado).
export async function settleContractEarly(payload = {}, actor = "system") {
  const { contractId, payoffDate, discountMode, discountValue = 0, bankAccountId } = payload;
  if (!contractId || !payoffDate || !discountMode) {
    const err = new Error("contractId, payoffDate e discountMode são obrigatórios");
    err.status = 400;
    throw err;
  }
  if (!DISCOUNT_MODES.includes(discountMode)) {
    const err = new Error(`discountMode inválido — use um de: ${DISCOUNT_MODES.join(", ")}`);
    err.status = 400;
    throw err;
  }
  const contract = await store.getById("LoanContract", contractId);
  if (contract.status !== "aprovado") {
    const err = new Error("Só é possível quitar antecipadamente um contrato aprovado");
    err.status = 409;
    throw err;
  }
  const schedule = parseScheduleData(contract.schedule_data);
  const balance = balanceAsOfDate(schedule, payoffDate);

  let discountAmount = 0;
  let finalAmount = balance;
  if (discountMode === "juros_futuros") {
    // O valor negociado É o desconto (quanto de juros futuros o banco abre mão).
    discountAmount = Math.min(balance, Number(discountValue) || 0);
    finalAmount = roundMoney(balance - discountAmount);
  } else if (discountMode === "percentual_saldo") {
    const pct = Math.min(100, Math.max(0, Number(discountValue) || 0));
    discountAmount = roundMoney(balance * (pct / 100));
    finalAmount = roundMoney(balance - discountAmount);
  } else {
    // valor_fixo: o usuário informa o valor final negociado diretamente.
    finalAmount = Math.max(0, Number(discountValue) || 0);
    discountAmount = roundMoney(Math.max(0, balance - finalAmount));
  }

  await store.create(
    "ContractSettlement",
    {
      contract_id: contractId,
      actual_payment_date: payoffDate,
      scheduled_amount: balance,
      principal_paid: finalAmount,
      discount_amount: discountAmount,
      extraordinary_amortization: true,
      bank_account_id: bankAccountId || contract.disbursement_bank_account_id || null,
      observacao: `Quitação antecipada — saldo apurado ${balance.toFixed(2)}, desconto (${discountMode}) ${discountAmount.toFixed(2)}, valor final ${finalAmount.toFixed(2)}.`,
    },
    actor
  );

  await store.update("LoanContract", contractId, {
    status: "pendente_aprovacao",
    payoff_date: payoffDate,
    settlement_discount_amount: discountAmount,
    settlement_discount_mode: discountMode,
  });

  return {
    contract_id: contractId,
    saldo_apurado: balance,
    desconto: discountAmount,
    valor_final: finalAmount,
    discount_mode: discountMode,
  };
}
