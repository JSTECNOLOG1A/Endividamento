import { apiRequest } from "./base44Client";

export const PLAN_OPTIONS = [
  { value: "STARTER", label: "Starter", contracts: 10, users: 3 },
  { value: "PRO", label: "Pro", contracts: 50, users: 10 },
  { value: "ENTERPRISE", label: "Enterprise", contracts: null, users: null },
];

export function planLabel(plan) {
  return PLAN_OPTIONS.find((item) => item.value === plan)?.label || plan || "—";
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
