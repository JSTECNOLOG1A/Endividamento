const API = "/api";

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options = { ...options, body: JSON.stringify(options.body) };
  }

  const response = await fetch(`${API}${path}`, { ...options, headers });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = payload;
    throw error;
  }

  return payload;
}

function entityApi(name) {
  return {
    list(sort = "", limit = 100) {
      const params = new URLSearchParams();
      if (sort) params.set("sort", sort);
      if (limit) params.set("limit", String(limit));
      const query = params.toString();
      return request(`/entities/${name}${query ? `?${query}` : ""}`);
    },
    filter(query = {}, sort = "", limit = 100) {
      return request(`/entities/${name}/filter`, {
        method: "POST",
        body: { query, sort, limit },
      });
    },
    get(id) {
      return request(`/entities/${name}/${id}`);
    },
    read(id) {
      return request(`/entities/${name}/${id}`);
    },
    create(data) {
      return request(`/entities/${name}`, { method: "POST", body: data });
    },
    update(id, data) {
      return request(`/entities/${name}/${id}`, { method: "PATCH", body: data });
    },
    delete(id) {
      return request(`/entities/${name}/${id}`, { method: "DELETE" });
    },
    bulkCreate(items) {
      return request(`/entities/${name}/bulk`, { method: "POST", body: items });
    },
  };
}

export const base44 = {
  entities: {
    Group: entityApi("Group"),
    CompanyEntity: entityApi("CompanyEntity"),
    Bank: entityApi("Bank"),
    LoanContract: entityApi("LoanContract"),
    CalculationSnapshot: entityApi("CalculationSnapshot"),
    CDIRate: entityApi("CDIRate"),
    Holiday: entityApi("Holiday"),
    Currency: entityApi("Currency"),
    Tenant: entityApi("Tenant"),
    TenantUser: entityApi("TenantUser"),
  },
  auth: {
    me() {
      return request("/auth/me");
    },
    async logout() {
      try {
        await request("/auth/logout", { method: "POST" });
      } catch {
        // logout local não deve quebrar a UI
      }
    },
    redirectToLogin() {
      window.location.href = "/";
    },
  },
  functions: {
    async invoke(name, payload) {
      const data = await request(`/functions/${name}`, {
        method: "POST",
        body: payload || {},
      });
      return { data };
    },
  },
  integrations: {
    Core: {
      async UploadFile({ file }) {
        const form = new FormData();
        form.append("file", file);
        return request("/uploads", { method: "POST", body: form });
      },
    },
  },
  appLogs: {
    async logUserInApp() {
      return { ok: true };
    },
  },
};
