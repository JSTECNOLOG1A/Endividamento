import { apiRequest } from "./base44Client";

export const commercialProposalsApi = {
  list({ q } = {}) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const query = params.toString();
    return apiRequest(`/commercial-proposals${query ? `?${query}` : ""}`);
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
};
