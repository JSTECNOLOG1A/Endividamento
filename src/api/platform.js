import { apiRequest } from "./base44Client";

export const platformApi = {
  listTenants() {
    return apiRequest("/platform/tenants");
  },
  setContext(tenantId) {
    return apiRequest("/platform/context", {
      method: "POST",
      body: { tenant_id: tenantId || null },
    });
  },
  updateTenantPlan(id, data) {
    return apiRequest(`/platform/tenants/${id}/plan`, { method: "PATCH", body: data });
  },
};
