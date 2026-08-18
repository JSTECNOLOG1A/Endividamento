import { apiRequest } from "./base44Client";

export const auditApi = {
  list(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value == null || value === "" || value === "todos" || value === "todas") return;
      search.set(key, String(value));
    });
    const query = search.toString();
    return apiRequest(`/audit-events${query ? `?${query}` : ""}`);
  },
  meta() {
    return apiRequest("/audit-events/meta");
  },
  get(id) {
    return apiRequest(`/audit-events/${id}`);
  },
};
