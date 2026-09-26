import { apiRequest } from "./base44Client";

export const implementationsApi = {
  template() {
    return apiRequest("/implementations/template");
  },
  availableTenants() {
    return apiRequest("/implementations/available-tenants");
  },
  list({ q, status } = {}) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const query = params.toString();
    return apiRequest(`/implementations${query ? `?${query}` : ""}`);
  },
  get(id) {
    return apiRequest(`/implementations/${id}`);
  },
  create(data) {
    return apiRequest("/implementations", { method: "POST", body: data });
  },
  update(id, data) {
    return apiRequest(`/implementations/${id}`, { method: "PATCH", body: data });
  },
  updateActivity(id, activityId, data) {
    return apiRequest(`/implementations/${id}/activities/${activityId}`, { method: "PATCH", body: data });
  },
};
