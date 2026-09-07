import { apiRequest } from "./base44Client";

/**
 * Espelho do catálogo de planos (frontend).
 * Fonte canônica no backend: backend/src/modules/billing/plans.js
 * Documentação: docs/billing/PLANOS-ALLDEBT.md
 */
export const PLAN_OPTIONS = [
  {
    value: "STARTER",
    label: "Starter",
    tagline: "Operação enxuta e período de avaliação",
    contracts: 10,
    users: 3,
    support: "E-mail · horário comercial",
    highlights: [
      "Calculadora, Contratos, Indexadores",
      "Até 10 contratos e 3 usuários",
      "Ideal para trial e times pequenos",
    ],
  },
  {
    value: "PRO",
    label: "Pro",
    tagline: "Operação completa para times financeiros",
    contracts: 50,
    users: 10,
    support: "E-mail prioritário · horário comercial ampliado",
    highlights: [
      "Contabilidade, Consolidação, Financeiro e Governança",
      "Até 50 contratos e 10 usuários",
      "Integrações ERP no onboarding",
    ],
  },
  {
    value: "ENTERPRISE",
    label: "Enterprise",
    tagline: "Escala, governança e suporte dedicado",
    contracts: null,
    users: null,
    support: "Canal dedicado · SLA sob contrato",
    highlights: [
      "Contratos e usuários ilimitados",
      "Onboarding assistido e SLA",
      "Prioridade em customizações contratadas",
    ],
  },
];

export function planLabel(plan) {
  return PLAN_OPTIONS.find((item) => item.value === plan)?.label || plan || "—";
}

export function planMeta(plan) {
  return PLAN_OPTIONS.find((item) => item.value === plan) || null;
}

export function billingStatusLabel(status) {
  const map = {
    trial: "Avaliação",
    active: "Ativo",
    suspended: "Suspenso",
  };
  return map[status] || status || "—";
}

export const billingApi = {
  getPlan() {
    return apiRequest("/billing/plan");
  },
  updatePlan(data) {
    return apiRequest("/billing/plan", { method: "PATCH", body: data });
  },
};

export const onboardingApi = {
  get() {
    return apiRequest("/onboarding");
  },
  complete(data) {
    return apiRequest("/onboarding", { method: "POST", body: data });
  },
};
