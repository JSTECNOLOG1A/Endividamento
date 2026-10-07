import { formatCivilDate } from "./taxDates.js";
import { PAID_INSTALLMENT_STATUSES } from "./taxLabels.js";

// Pagamento da parcela registrado pela baixa do título de tributo no Protheus, e a versão da parcela que a tela
// carregou. Regra do servidor (rules.js): toda edição de parcela manda o `updated_date` lido; alterar à mão um
// pagamento que veio do Protheus exige essa versão.

/** Erros do servidor que pedem recarregar a parcela antes de salvar. */
export const INSTALLMENT_CONFLICT_CODES = new Set(["TAX_INSTALLMENT_CHANGED", "TAX_INSTALLMENT_PAID_BY_ERP"]);

export function isInstallmentConflict(error) {
  return INSTALLMENT_CONFLICT_CODES.has(error?.code);
}

/** Corpo da edição com a versão da parcela que a tela carregou. */
export function withInstallmentVersion(changes, installment) {
  return installment?.updated_date ? { ...changes, updated_date: installment.updated_date } : { ...changes };
}

/** True quando o pagamento da parcela foi registrado pela baixa no Protheus. */
export function isPaidByErp(installment) {
  return installment?.pagamento_origem === "protheus";
}

/** "Pagamento registrado pela baixa no Protheus em 31/03/2026" (data do pagamento; sem ela, a do registro). */
export function erpPaymentNote(installment) {
  if (!isPaidByErp(installment)) return null;
  const civil = installment.data_pagamento || String(installment.pagamento_registrado_em || "").slice(0, 10);
  const date = civil ? formatCivilDate(civil) : "";
  return `Pagamento registrado pela baixa no Protheus${date ? ` em ${date}` : ""}`;
}

function cents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * True quando a edição desfaz ou troca o pagamento que veio do Protheus: sai de paga (volta a vencer/vencida ou
 * cancela) ou muda data/valor pago. Passar para "Paga" (reconhecida) não desfaz. Espelha undoesErpPayment do servidor.
 * @param {object} previous parcela carregada
 * @param {{ situacao: string, data_pagamento?: string | null, valor_pago?: number | null }} next
 */
export function undoesErpPayment(previous, next) {
  if (!isPaidByErp(previous)) return false;
  if (!PAID_INSTALLMENT_STATUSES.has(next.situacao)) return true;
  if ((next.data_pagamento || null) !== (previous.data_pagamento || null)) return true;
  return cents(next.valor_pago) !== cents(previous.valor_pago);
}
