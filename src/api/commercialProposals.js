import { apiRequest, apiRequestBlob } from "./base44Client";

export const commercialProposalsApi = {
  // `status`: uma situação ou várias separadas por vírgula.
  list({ q, status } = {}) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const query = params.toString();
    return apiRequest(`/commercial-proposals${query ? `?${query}` : ""}`);
  },
  // Sem período, o servidor usa o mês corrente.
  summary({ de, ate } = {}) {
    const params = new URLSearchParams();
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    const query = params.toString();
    return apiRequest(`/commercial-proposals/summary${query ? `?${query}` : ""}`);
  },
  history(id) {
    return apiRequest(`/commercial-proposals/${id}/history`);
  },
  get(id) {
    return apiRequest(`/commercial-proposals/${id}`);
  },
  create(data) {
    return apiRequest("/commercial-proposals", { method: "POST", body: data });
  },
  update(id, data) {
    return apiRequest(`/commercial-proposals/${id}`, { method: "PUT", body: data });
  },
  sendEmail(id, { to, nomeDestinatario, mensagem, pdfBase64, nomeArquivo }) {
    return apiRequest(`/commercial-proposals/${id}/send-email`, {
      method: "POST",
      body: { to, nomeDestinatario, mensagem, pdfBase64, nomeArquivo },
    });
  },
  // Com arquivo assinado vai como formulário (o arquivo no campo "file");
  // sem arquivo, como JSON.
  accept(id, { file, ...fields }) {
    let body = fields;
    if (file) {
      body = new FormData();
      Object.entries(fields).forEach(([key, value]) => {
        if (value != null && value !== "") body.append(key, value);
      });
      body.append("file", file);
    }
    return apiRequest(`/commercial-proposals/${id}/accept`, { method: "POST", body });
  },
  reject(id, { motivo_recusa }) {
    return apiRequest(`/commercial-proposals/${id}/reject`, { method: "POST", body: { motivo_recusa } });
  },
  signedFile(id) {
    return apiRequestBlob(`/commercial-proposals/${id}/signed-file`);
  },
  sentFile(id, sendId) {
    return apiRequestBlob(`/commercial-proposals/${id}/sends/${sendId}/file`);
  },
};
