import { apiRequest } from "./base44Client";

export const platformApi = {
  overview() {
    return apiRequest("/platform/overview");
  },
  listTenants(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.plan) qs.set("plan", params.plan);
    const query = qs.toString();
    return apiRequest(`/platform/tenants${query ? `?${query}` : ""}`);
  },
  getTenant(id) {
    return apiRequest(`/platform/tenants/${id}`);
  },
  createTenant(data) {
    return apiRequest("/platform/tenants", { method: "POST", body: data });
  },
  updateTenant(id, data) {
    return apiRequest(`/platform/tenants/${id}`, { method: "PATCH", body: data });
  },
  updateTenantPlan(id, data) {
    return apiRequest(`/platform/tenants/${id}/plan`, { method: "PATCH", body: data });
  },
  suspendTenant(id, data) {
    return apiRequest(`/platform/tenants/${id}/suspend`, { method: "POST", body: data });
  },
  reactivateTenant(id, data = {}) {
    return apiRequest(`/platform/tenants/${id}/reactivate`, { method: "POST", body: data });
  },
  disableTenant(id, data = {}) {
    return apiRequest(`/platform/tenants/${id}/disable`, { method: "POST", body: data });
  },
  cancelTenant(id, data) {
    return apiRequest(`/platform/tenants/${id}/cancel`, { method: "POST", body: data });
  },
  listTenantUsers(id) {
    return apiRequest(`/platform/tenants/${id}/users`);
  },
  tenantAudit(id, params = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiRequest(`/platform/tenants/${id}/audit${query ? `?${query}` : ""}`);
  },
  setContext(tenantId) {
    return apiRequest("/platform/context", {
      method: "POST",
      body: { tenant_id: tenantId || null },
    });
  },
  stepUp(password) {
    return apiRequest("/platform/step-up", { method: "POST", body: { password } });
  },
  startSupportSession(tenantId, data) {
    return apiRequest(`/platform/tenants/${tenantId}/support-session`, {
      method: "POST",
      body: data,
    });
  },
  currentSupportSession() {
    return apiRequest("/platform/support-session");
  },
  endSupportSession(id) {
    return apiRequest(`/platform/support-sessions/${id}`, { method: "DELETE" });
  },
  accessLog(params = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    if (params.tenant_id) qs.set("tenant_id", params.tenant_id);
    const query = qs.toString();
    return apiRequest(`/platform/access-log${query ? `?${query}` : ""}`);
  },
};
