import { apiRequest } from "./base44Client";

// Preferências pessoais do usuário logado no cliente atual (liga/desliga que só afeta quem escolheu).
export const PREFERENCE_KEYS = {
  dashboardTax: "dashboard_tributos",
  taxAlerts: "alertas_tributarios",
};

export const preferencesApi = {
  /** `{ preferencias: { [chave]: { disponivel, ligado, padrao } } }`. */
  get() {
    return apiRequest("/me/preferences");
  },
  /** `changes`: `{ [chave]: true|false }`. Devolve o mesmo formato do get. */
  update(changes) {
    return apiRequest("/me/preferences", { method: "PATCH", body: changes });
  },
};
