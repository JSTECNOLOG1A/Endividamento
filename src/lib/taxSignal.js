import { addDays, addMonthsKeepingDay, daysBetween, isCivilDate } from "./taxDates.js";

// Semáforo dos parcelamentos de tributos — fonte única para a lista e para a Visão geral.
// Os limites ficam aqui e só aqui.

/** Dias sem conferência no e-CAC/portal a partir dos quais o acordo é tratado como desatualizado. */
export const STALE_AFTER_DAYS = 30;
/** Janela (em dias a partir de hoje, inclusive) em que uma parcela em aberto conta como "a vencer". */
export const DUE_SOON_DAYS = 7;
/** Limite de parcelas geradas de uma vez (o mesmo teto de quantidade de parcelas do servidor). */
export const MAX_GENERATED_INSTALLMENTS = 1000;

export const SIGNALS = {
  desatualizado: { key: "desatualizado", label: "Desatualizado", hint: "sem conferência recente" },
  em_atraso: { key: "em_atraso", label: "Em atraso", hint: "parcela vencida" },
  aguardando_reconhecimento: {
    key: "aguardando_reconhecimento",
    label: "Pago, aguardando reconhecimento",
    hint: "pagamento aguardando reconhecimento",
  },
  a_vencer: { key: "a_vencer", label: "A vencer", hint: `parcela vencendo nos próximos ${DUE_SOON_DAYS} dias` },
  em_dia: { key: "em_dia", label: "Em dia", hint: "em dia" },
};

/** Ordem de precedência (e de exibição): desatualizado > em atraso > aguardando reconhecimento > a vencer > em dia. */
export const SIGNAL_ORDER = ["desatualizado", "em_atraso", "aguardando_reconhecimento", "a_vencer", "em_dia"];

function isOverdue(installment, today) {
  return installment.situacao === "em_aberto" && isCivilDate(installment.vencimento) && installment.vencimento < today;
}

function isDueSoon(installment, today) {
  if (installment.situacao !== "em_aberto" || !isCivilDate(installment.vencimento)) return false;
  const limit = addDays(today, DUE_SOON_DAYS);
  return installment.vencimento >= today && installment.vencimento <= limit;
}

/** O que os dados registrados indicam, sem considerar a data da última conferência. */
function signalFromRecords(installments, today) {
  if (installments.some((item) => isOverdue(item, today))) return "em_atraso";
  if (installments.some((item) => item.situacao === "paga_aguardando_reconhecimento")) return "aguardando_reconhecimento";
  if (installments.some((item) => isDueSoon(item, today))) return "a_vencer";
  return "em_dia";
}

export function isStale(agreement, today) {
  if (!agreement?.ultima_conferencia) return true;
  const age = daysBetween(agreement.ultima_conferencia, today);
  return age === null || age > STALE_AFTER_DAYS;
}

/**
 * Semáforo de um parcelamento.
 * - Só acordos "ativo" entram: os demais devolvem `signal: null` e mostram a própria situação.
 * - Desatualizado tem precedência; `recordsSignal` traz o que os dados registrados indicam, para exibir como
 *   informação secundária — nunca como o estado do acordo.
 *
 * @param {object} agreement parcelamento (TaxAgreement)
 * @param {object[]} installments parcelas DESTE parcelamento
 * @param {string} today data civil AAAA-MM-DD (use todayInBrazil())
 * @returns {{ signal: string|null, recordsSignal: string|null }}
 */
export function computeTaxSignal(agreement, installments, today) {
  if (!agreement || agreement.situacao !== "ativo") return { signal: null, recordsSignal: null };
  const recordsSignal = signalFromRecords(installments || [], today);
  if (isStale(agreement, today)) return { signal: "desatualizado", recordsSignal };
  return { signal: recordsSignal, recordsSignal };
}

/**
 * Saldo sem conferência que o cubra: nunca conferido, ou com data-base posterior à última conferência
 * (ex.: cadastrado já com uma data de conferência anterior à data-base informada).
 */
export function isBalanceUnverified(agreement) {
  if (!agreement || agreement.saldo_oficial === null || agreement.saldo_oficial === undefined) return false;
  if (!agreement.ultima_conferencia) return true;
  return Boolean(agreement.saldo_data_base) && agreement.saldo_data_base > agreement.ultima_conferencia;
}

/** Parcela em aberto de vencimento mais próximo (pode estar vencida). */
export function nextOpenInstallment(installments) {
  let next = null;
  for (const item of installments || []) {
    if (item.situacao !== "em_aberto" || !isCivilDate(item.vencimento)) continue;
    if (!next || item.vencimento < next.vencimento) next = item;
  }
  return next;
}

/** Agrupa parcelas pelo parcelamento a que pertencem. */
export function groupInstallmentsByAgreement(installments) {
  const map = new Map();
  for (const item of installments || []) {
    const list = map.get(item.agreement_id);
    if (list) list.push(item);
    else map.set(item.agreement_id, [item]);
  }
  return map;
}

/**
 * Parcelas mensais a partir do 1º vencimento: mesmo dia todo mês, ajustado para o último dia em meses curtos.
 * Devolve só os campos da parcela; quem chama acrescenta o parcelamento.
 */
export function buildMonthlySchedule({ firstDueDate, count, amount, startNumber = 1 }) {
  if (!isCivilDate(firstDueDate) || !Number.isInteger(count) || count < 1) return [];
  const anchorDay = Number(firstDueDate.slice(8, 10));
  return Array.from({ length: count }, (_, index) => ({
    numero_parcela: startNumber + index,
    vencimento: addMonthsKeepingDay(firstDueDate, index, anchorDay),
    valor: amount,
  }));
}
