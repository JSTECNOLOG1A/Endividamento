import { apiRequest } from "./base44Client";

export const PARAMETER_CATEGORIES = {
  general: "Geral",
  appearance: "Aparência",
  contracts: "Contratos",
  finance: "Financeiro",
  accounting: "Contabilidade",
  integrations: "Integrações",
  security: "Segurança",
  notifications: "Notificações",
  audit: "Auditoria",
  system: "Sistema",
};

export const LAYOUT_OPTIONS = [
  { value: "classic", label: "Clássico", description: "Mantém o layout atual exatamente como está hoje." },
  { value: "modern", label: "Moderno", description: "Utiliza a nova experiência com menu lateral e identidade visual moderna." },
];

export const parametersApi = {
  list({ category = "all", search = "" } = {}) {
    const params = new URLSearchParams();
    if (category && category !== "all") params.set("category", category);
    if (search) params.set("search", search);
    const qs = params.toString();
    return apiRequest(`/parameters${qs ? `?${qs}` : ""}`);
  },
  categories() {
    return apiRequest("/parameters/categories");
  },
  get(key) {
    return apiRequest(`/parameters/${encodeURIComponent(key)}`);
  },
  update(key, value, scope = "TENANT") {
    return apiRequest(`/parameters/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: { value, scope },
    });
  },
  reset(key, scope = "TENANT") {
    return apiRequest("/parameters/reset", {
      method: "POST",
      body: { key, scope },
    });
  },
};
