import { apiRequest } from "./base44Client";

export const integrationsApi = {
  list(params = {}) {
    const search = new URLSearchParams();
    if (params.search) search.set("search", params.search);
    if (params.status && params.status !== "todos") search.set("status", params.status);
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    const query = search.toString();
    return apiRequest(`/integrations${query ? `?${query}` : ""}`);
  },
  get(code) {
    return apiRequest(`/integrations/${code}`);
  },
  create(data) {
    return apiRequest("/integrations", { method: "POST", body: data });
  },
  update(code, data) {
    return apiRequest(`/integrations/${code}`, { method: "PUT", body: data });
  },
  remove(code) {
    return apiRequest(`/integrations/${code}`, { method: "DELETE" });
  },
  updateStatus(code, status) {
    return apiRequest(`/integrations/${code}/status`, { method: "PATCH", body: { status } });
  },
  async testConnection(payload) {
    const result = await apiRequest("/integrations/test-connection", {
      method: "POST",
      body: payload,
    });
    return result?.data ?? result;
  },
};

export const AUTH_TYPE_OPTIONS = [
  { value: "none", label: "Sem autenticação" },
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic (usuário e senha)" },
];

export const HTTP_METHOD_OPTIONS = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
];

export const AUTH_TYPE_LABELS = {
  none: "Sem autenticação",
  api_key: "API Key",
  bearer: "Bearer Token",
  basic: "Basic",
};

export const CADASTRO_LINK_OPTIONS = [
  { value: "", label: "Nenhum" },
  { value: "naturezas", label: "Naturezas" },
  { value: "empresas", label: "Empresas" },
  { value: "bancos", label: "Bancos" },
  { value: "contas", label: "Contas bancárias" },
  { value: "plano_contas", label: "Plano de contas" },
  { value: "taxas", label: "Taxas" },
  { value: "contratos", label: "Contratos" },
  { value: "tipos_titulo", label: "Tipos de título" },
  { value: "fornecedores", label: "Fornecedores" },
  { value: "titulos_pagar", label: "Títulos a pagar" },
  { value: "titulos_pagar_extornar", label: "Estorno de títulos a pagar" },
  { value: "titulos_pagar_consultar", label: "Consulta de títulos a pagar" },
  { value: "titulos_receber", label: "Títulos a receber" },
  { value: "titulos_receber_extornar", label: "Estorno de títulos a receber" },
  { value: "titulos_receber_consultar", label: "Consulta de títulos a receber" },
  { value: "clientes", label: "Clientes" },
];

export const CADASTRO_KEY_LABELS = Object.fromEntries(
  CADASTRO_LINK_OPTIONS.filter((item) => item.value).map((item) => [item.value, item.label])
);

export function isProtheusErp(erpNome) {
  const name = (erpNome ?? "").trim().toLowerCase();
  return name.includes("protheus") || name.includes("totvs");
}

export function emptyEndpoint() {
  return {
    key: crypto.randomUUID(),
    nome: "",
    metodo: "GET",
    path: "",
    cadastroKey: "",
  };
}

export function emptyIntegrationForm() {
  return {
    nome: "",
    descricao: "",
    erpNome: "",
    baseUrl: "",
    authType: "api_key",
    authHeader: "X-API-Key",
    username: "",
    credential: "",
    timeoutSeconds: "30",
    grupoEmpresas: "",
    empresa: "",
    filial: "",
    endpoints: [],
  };
}

export function formFromIntegration(item) {
  return {
    nome: item.nome || "",
    descricao: item.descricao || "",
    erpNome: item.erpNome || "",
    baseUrl: item.baseUrl || "",
    authType: item.authType || "none",
    authHeader: item.authHeader || "X-API-Key",
    username: item.username || "",
    credential: "",
    timeoutSeconds: String(item.timeoutSeconds || 30),
    grupoEmpresas: item.grupoEmpresas || "",
    empresa: item.empresa || "",
    filial: item.filial || "",
    endpoints: (item.endpoints || []).map((endpoint) => ({
      key: endpoint.id || crypto.randomUUID(),
      nome: endpoint.nome || "",
      metodo: endpoint.metodo || "GET",
      path: endpoint.path || "",
      cadastroKey: endpoint.cadastroKey || "",
    })),
  };
}

function emptyToUndefined(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

export function prepareIntegrationPayload(data) {
  return {
    nome: data.nome?.trim(),
    descricao: emptyToUndefined(data.descricao),
    erpNome: emptyToUndefined(data.erpNome),
    baseUrl: data.baseUrl?.trim(),
    authType: data.authType,
    authHeader: emptyToUndefined(data.authHeader),
    username: emptyToUndefined(data.username),
    credential: emptyToUndefined(data.credential),
    timeoutSeconds: data.timeoutSeconds ? Number(data.timeoutSeconds) : undefined,
    grupoEmpresas: data.grupoEmpresas?.trim() || "",
    empresa: data.empresa?.trim() || "",
    filial: data.filial?.trim() || "",
    endpoints: (data.endpoints ?? [])
      .filter((endpoint) => endpoint.nome.trim() !== "" || endpoint.path.trim() !== "")
      .map((endpoint) => ({
        nome: endpoint.nome.trim(),
        metodo: endpoint.metodo,
        path: endpoint.path.trim(),
        cadastroKey: endpoint.cadastroKey?.trim() ? endpoint.cadastroKey.trim() : null,
      })),
  };
}
