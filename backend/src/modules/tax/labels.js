// Situação da parcela como o usuário a vê. O valor interno `em_aberto` aparece como "A vencer" ou "Vencida"
// conforme o vencimento; sem uma data de referência, como "A vencer ou vencida".
const INSTALLMENT_STATUS_LABELS = {
  paga_aguardando_reconhecimento: "Paga, aguardando reconhecimento",
  reconhecida: "Paga",
  cancelada: "Cancelada",
};

export const OPEN_INSTALLMENT_LABEL = "A vencer ou vencida";

/**
 * @param {string} situacao valor interno gravado
 * @param {string|null} vencimento AAAA-MM-DD
 * @param {string|null} referenceDate AAAA-MM-DD do dia em que a situação vale
 */
export function installmentStatusLabel(situacao, vencimento = null, referenceDate = null) {
  if (situacao === "em_aberto") {
    const due = vencimento ? String(vencimento).slice(0, 10) : null;
    if (!due || !referenceDate) return OPEN_INSTALLMENT_LABEL;
    return due < referenceDate ? "Vencida" : "A vencer";
  }
  return INSTALLMENT_STATUS_LABELS[situacao] || situacao;
}
