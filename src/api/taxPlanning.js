import { apiRequest } from "./base44Client";

// Planejamento da Gestão Tributária: calendário e fluxo de caixa dos vencimentos, já somados no servidor.
export const taxPlanningApi = {
  /** `params`: inicio, fim (AAAA-MM), entity_id, esfera, tributo ("null" = não informado), orgao, uf — só os preenchidos. */
  get(params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
    return apiRequest(`/tax/planning${query ? `?${query}` : ""}`);
  },
};
