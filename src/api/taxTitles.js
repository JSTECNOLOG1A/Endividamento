import { apiRequest } from "./base44Client";

// Títulos a pagar das parcelas de tributo no Protheus (separados dos títulos de empréstimo).
export const taxTitlesApi = {
  /** Lista; filtros opcionais: `situacoes` (lista), `agreementId`, `installmentId`. */
  list({ situacoes, agreementId, installmentId } = {}) {
    const params = new URLSearchParams();
    if (situacoes?.length) params.set("situacao", situacoes.join(","));
    if (agreementId) params.set("agreement_id", agreementId);
    if (installmentId) params.set("installment_id", installmentId);
    const query = params.toString();
    return apiRequest(`/tax/payable-titles${query ? `?${query}` : ""}`);
  },
  /**
   * Consulta no Protheus todos os títulos de tributo consultáveis do cliente (botão "Consultar títulos").
   * Devolve `{ total, consultados, conferencia, por_resultado }`.
   */
  consultAll() {
    return apiRequest("/tax/payable-titles/consult", { method: "POST" });
  },
  /** Envia (ou estorna e envia de novo) agora. Devolve o título. */
  integrate(id) {
    return apiRequest(`/tax/payable-titles/${encodeURIComponent(id)}/integrate`, { method: "POST" });
  },
  /** Consulta saldo e baixa no Protheus. Devolve o título. */
  consult(id) {
    return apiRequest(`/tax/payable-titles/${encodeURIComponent(id)}/consult`, { method: "POST" });
  },
  /** Só para título em conferência: confirma que ele não existe no Protheus. Devolve o título. */
  confirmAbsence(id) {
    return apiRequest(`/tax/payable-titles/${encodeURIComponent(id)}/confirm-absence`, { method: "POST" });
  },
};
