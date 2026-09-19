/**
 * Catálogo canônico dos planos comerciais AllDebt.
 * Limites (contracts/users) são enforced em tenants/policy.js.
 * Features descrevem o empacotamento do produto (roadmap de gates).
 */
export const PLAN_CATALOG = {
  STARTER: {
    code: "STARTER",
    label: "Starter",
    tagline: "Operação enxuta e período de avaliação",
    contracts: 10,
    users: 3,
    support: "E-mail · horário comercial",
    modules: [
      "Calculadora de endividamento",
      "Contratos (cadastro e fluxo básico)",
      "Indexadores e feriados",
      "Manual do usuário",
      "Configurações essenciais",
    ],
    includes: [
      "Até 10 contratos ativos",
      "Até 3 usuários (não-master)",
      "Um grupo / filial operacional",
      "Exportações básicas",
    ],
    excludes: [
      "Contabilidade e consolidação multi-empresa",
      "Financeiro (contas a pagar / receber)",
      "Governança avançada e integrações ERP",
      "SLA contratual e suporte dedicado",
    ],
  },
  PRO: {
    code: "PRO",
    label: "Pro",
    tagline: "Operação completa para times financeiros",
    contracts: 50,
    users: 10,
    support: "E-mail prioritário · horário comercial ampliado",
    modules: [
      "Tudo do Starter",
      "Contas garantidas",
      "Governança",
      "Contabilidade",
      "Consolidação",
      "Financeiro (contas a pagar e a receber)",
      "Integrações ERP (Protheus) no onboarding",
    ],
    includes: [
      "Até 50 contratos ativos",
      "Até 10 usuários (não-master)",
      "Múltiplas entidades no escopo do tenant",
      "Parâmetros de aparência e operação por tenant",
      "Trilha de auditoria operacional do tenant",
    ],
    excludes: [
      "Limites ilimitados de contratos/usuários",
      "SLA dedicado e CSM nomeado",
      "Customizações de produto sob contrato",
    ],
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    label: "Enterprise",
    tagline: "Escala, governança e suporte dedicado",
    contracts: null,
    users: null,
    support: "Canal dedicado · SLA sob contrato",
    modules: [
      "Tudo do Pro",
      "Operação multi-filial em escala",
      "Acesso assistido de suporte (PLATFORM MASTER) sob demanda",
      "Políticas avançadas de privacidade / LGPD no tenant",
      "Prioridade em roadmap e customizações contratadas",
    ],
    includes: [
      "Contratos ilimitados",
      "Usuários ilimitados",
      "Onboarding assistido",
      "SLA e suporte dedicado (conforme contrato)",
      "Histórico e evidências para auditoria corporativa",
    ],
    excludes: [],
  },
};

export const PLAN_CODES = Object.keys(PLAN_CATALOG);

export function getPlan(code) {
  return PLAN_CATALOG[code] || PLAN_CATALOG.STARTER;
}

export function planLimits(code) {
  const plan = getPlan(code);
  return {
    contracts: plan.contracts == null ? Number.POSITIVE_INFINITY : plan.contracts,
    users: plan.users == null ? Number.POSITIVE_INFINITY : plan.users,
  };
}
