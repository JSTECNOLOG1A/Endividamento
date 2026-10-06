import { apiRequest, apiRequestBlob } from "./base44Client";

// Guia de pagamento (DARF / guia estadual) das parcelas da Gestão Tributária.
export const taxGuidesApi = {
  /** Guias atuais (uma por parcela) do grupo, ou só de um parcelamento. */
  listCurrent({ agreementId } = {}) {
    const query = agreementId ? `?${new URLSearchParams({ agreement_id: agreementId }).toString()}` : "";
    return apiRequest(`/tax/guides${query}`);
  },
  /** `{ parcela, guia, historico }` de uma parcela. */
  get(installmentId) {
    return apiRequest(`/tax/installments/${encodeURIComponent(installmentId)}/guide`);
  },
  // Com PDF vai como formulário (o arquivo no campo "file"); com a linha digitável, como JSON.
  attach(installmentId, { file, linhaDigitavel, pagarAte, substituir = false }) {
    let body;
    if (file) {
      body = new FormData();
      if (pagarAte) body.append("pagar_ate", pagarAte);
      if (substituir) body.append("substituir", "true");
      body.append("file", file);
    } else {
      body = { linha_digitavel: linhaDigitavel };
      if (pagarAte) body.pagar_ate = pagarAte;
      if (substituir) body.substituir = true;
    }
    return apiRequest(`/tax/installments/${encodeURIComponent(installmentId)}/guide`, { method: "POST", body });
  },
  /** `changes`: `{ linha_digitavel?, pagar_ate? }` — só os campos alterados. */
  correct(installmentId, changes) {
    return apiRequest(`/tax/installments/${encodeURIComponent(installmentId)}/guide`, { method: "PATCH", body: changes });
  },
  remove(installmentId) {
    return apiRequest(`/tax/installments/${encodeURIComponent(installmentId)}/guide`, { method: "DELETE" });
  },
  file(guideId, { download = false } = {}) {
    return apiRequestBlob(`/tax/guides/${encodeURIComponent(guideId)}/file${download ? "?download=1" : ""}`);
  },
  sendEmail(installmentId, { destinatarios, mensagem }) {
    return apiRequest(`/tax/installments/${encodeURIComponent(installmentId)}/guide/send-email`, {
      method: "POST",
      body: { destinatarios, mensagem: mensagem || undefined },
    });
  },
  sends(installmentId) {
    return apiRequest(`/tax/installments/${encodeURIComponent(installmentId)}/guide/sends`);
  },
};
