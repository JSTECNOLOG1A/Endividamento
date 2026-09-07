/**
 * Passos do product tour — apenas páginas/módulos reais do AllDebt.
 * Alvos via data-tour estáveis (sem nth-child / classes geradas).
 */
export const TOUR_VERSION = "1.0";

export const TOUR_STEPS = [
  {
    id: "simulator",
    route: "/Simulator",
    target: "simulator-workspace",
    title: "Calculadora",
    description:
      "Aqui você simula operações de crédito, define parâmetros e gera a memória de cálculo da operação.",
  },
  {
    id: "nav",
    route: null,
    target: "nav-main",
    title: "Menu principal",
    description:
      "Use o menu para navegar entre Calculadora, Contratos, Governança, Contabilidade, Financeiro e demais módulos.",
  },
  {
    id: "contracts",
    route: "/Contracts",
    target: "contracts-workspace",
    title: "Contratos",
    description:
      "Registre e acompanhe contratos e financiamentos: rascunhos, aprovações, devoluções e status da carteira.",
  },
  {
    id: "payables",
    route: "/AccountsPayable",
    target: "payables-workspace",
    title: "Fluxo financeiro",
    description:
      "Acompanhe contas a pagar geradas pelas operações — vencimentos, títulos e integração com o ERP quando aplicável.",
  },
  {
    id: "consolidation",
    route: "/Consolidation",
    target: "consolidation-workspace",
    title: "Indicadores e consolidação",
    description:
      "Analise a visão consolidada do endividamento, evolução e indicadores da carteira.",
  },
  {
    id: "settings",
    route: "/SettingsAccount",
    target: "settings-workspace",
    title: "Configurações e conta",
    description:
      "Administre perfil, integrações, parâmetros, usuários e preferências da sua empresa.",
  },
];
