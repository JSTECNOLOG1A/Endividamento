import { getPlatformTenantId, getSupportSessionId } from "./platformScope";

const API = "/api";
const TOKEN_KEY = "endividamento_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const supportId = getSupportSessionId();
  if (supportId) {
    headers["X-Support-Session-Id"] = supportId;
    const tenantId = getPlatformTenantId();
    if (tenantId) headers["X-Tenant-Id"] = tenantId;
  }
  return { headers, hadToken: Boolean(token) };
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function handleUnauthorized(response, hadToken) {
  if (response.status !== 401) return;
  setToken(null);
  if (hadToken) {
    window.dispatchEvent(new Event("auth:session-expired"));
  }
}

function httpError(response, payload) {
  const error = new Error(payload?.error || `HTTP ${response.status}`);
  error.status = response.status;
  error.code = payload?.code;
  error.data = payload;
  return error;
}

async function request(path, options = {}) {
  const { headers, hadToken } = buildHeaders(options.headers);
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options = { ...options, body: JSON.stringify(options.body) };
  }

  const response = await fetch(`${API}${path}`, { ...options, headers });
  const payload = await readPayload(response);
  handleUnauthorized(response, hadToken);
  if (!response.ok) throw httpError(response, payload);
  return payload;
}

// Arquivo protegido (PDF etc.) baixado com o mesmo header de autenticação das
// demais chamadas — nunca com o token na URL, que ficaria gravado em log.
async function requestBlob(path) {
  const { headers, hadToken } = buildHeaders();
  const response = await fetch(`${API}${path}`, { headers });
  if (!response.ok) {
    const payload = await readPayload(response);
    handleUnauthorized(response, hadToken);
    throw httpError(response, payload);
  }
  return response.blob();
}

export { request as apiRequest, requestBlob as apiRequestBlob };

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
    Nature: entityApi("Nature"),
    BankAccount: entityApi("BankAccount"),
    ChartOfAccount: entityApi("ChartOfAccount"),
    PayableTitle: entityApi("PayableTitle"),
    ReceivableTitle: entityApi("ReceivableTitle"),
    LoanContract: entityApi("LoanContract"),
    AccountMovement: entityApi("AccountMovement"),
    CalculationSnapshot: entityApi("CalculationSnapshot"),
    CDIRate: entityApi("CDIRate"),
    Holiday: entityApi("Holiday"),
    Currency: entityApi("Currency"),
    AccountingClosing: entityApi("AccountingClosing"),
    ContractSettlement: entityApi("ContractSettlement"),
    AccountingEventMapping: entityApi("AccountingEventMapping"),
    BalanceDeploymentConfig: entityApi("BalanceDeploymentConfig"),
    AccountingJournalEntry: entityApi("AccountingJournalEntry"),
    NotificationLog: entityApi("NotificationLog"),
    Tenant: entityApi("Tenant"),
    TenantUser: entityApi("TenantUser"),
  },
  auth: {
    async login(email, password) {
      const result = await request("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      // Login em mais de um tenant (ex.: consultor externo de mais de um cliente): o backend ainda não
      // emitiu token nenhum, só pediu pra escolher. Quem chama decide como mostrar isso (ver AuthContext).
      if (result.tenant_selection_required) {
        return { tenantSelectionRequired: true, pendingToken: result.pending_token, tenants: result.tenants };
      }
      setToken(result.token);
      return result.user;
    },
    async selectTenant(pendingToken, tenantId) {
      const result = await request("/auth/select-tenant", {
        method: "POST",
        body: { pending_token: pendingToken, tenant_id: tenantId },
      });
      setToken(result.token);
      return result.user;
    },
    me() {
      return request("/auth/me");
    },
    async logout() {
      try {
        await request("/auth/logout", { method: "POST" });
      } catch {
        // ignore
      }
      setToken(null);
    },
    redirectToLogin() {
      setToken(null);
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
  dashboard: {
    // Livre pra qualquer usuário do tenant (sem exigir permissão de escrita) — por isso é uma rota própria,
    // fora do dispatcher /functions (ver backend/src/modules/accounting/dashboardRoutes.js).
    getSummary(entityId, dataBase) {
      const params = new URLSearchParams({ entity_id: entityId || "all", data_base: dataBase });
      return request(`/dashboard/summary?${params}`);
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
