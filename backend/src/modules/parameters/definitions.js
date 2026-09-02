/**
 * Catálogo de definições de parâmetros.
 * Novos parâmetros: adicionar aqui — sem migration de schema.
 */

export const PARAMETER_CATEGORIES = {
  general: { label: "Geral", order: 1 },
  appearance: { label: "Aparência", order: 2 },
  contracts: { label: "Contratos", order: 3 },
  finance: { label: "Financeiro", order: 4 },
  accounting: { label: "Contabilidade", order: 5 },
  integrations: { label: "Integrações", order: 6 },
  security: { label: "Segurança", order: 7 },
  notifications: { label: "Notificações", order: 8 },
  audit: { label: "Auditoria", order: 9 },
  system: { label: "Sistema", order: 10 },
};

/** @typedef {'BOOLEAN'|'INTEGER'|'DECIMAL'|'STRING'|'ENUM'|'JSON'|'DATE'|'TIME'} ParameterType */

/**
 * @typedef {Object} ParameterDefinition
 * @property {string} key
 * @property {string} category
 * @property {ParameterType} type
 * @property {string} label
 * @property {string} description
 * @property {*} defaultValue
 * @property {string[]} [allowedValues]
 * @property {boolean} [isEditable]
 * @property {boolean} [isSecret]
 * @property {boolean} [implemented] — false = planejado, oculto na UI
 * @property {('GLOBAL'|'TENANT'|'USER')[]} [writableScopes]
 */

/** @type {ParameterDefinition[]} */
export const PARAMETER_DEFINITIONS = [
  {
    key: "appearance.default_layout",
    category: "appearance",
    type: "ENUM",
    label: "Layout padrão",
    description: "Define qual estrutura visual será utilizada pelo sistema.",
    defaultValue: "classic",
    allowedValues: ["classic", "modern"],
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT", "USER"],
  },
  {
    key: "appearance.theme",
    category: "appearance",
    type: "ENUM",
    label: "Tema",
    description: "Preferência de tema claro, escuro ou automático do sistema.",
    defaultValue: "light",
    allowedValues: ["light", "dark", "system"],
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT", "USER"],
  },
  {
    key: "appearance.interface_density",
    category: "appearance",
    type: "ENUM",
    label: "Densidade da interface",
    description: "Espaçamento entre elementos da interface.",
    defaultValue: "comfortable",
    allowedValues: ["comfortable", "compact", "ultra_compact"],
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT", "USER"],
  },
  {
    key: "appearance.menu_icons",
    category: "appearance",
    type: "BOOLEAN",
    label: "Ícones no menu",
    description: "Exibe ícones ao lado dos itens de navegação.",
    defaultValue: true,
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT", "USER"],
  },
  {
    key: "appearance.show_tenant",
    category: "appearance",
    type: "BOOLEAN",
    label: "Exibir nome do tenant",
    description: "Mostra o nome da empresa no cabeçalho.",
    defaultValue: true,
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT", "USER"],
  },
  {
    key: "appearance.button_radius",
    category: "appearance",
    type: "ENUM",
    label: "Raio dos botões",
    description: "Arredondamento dos botões da interface.",
    defaultValue: "medium",
    allowedValues: ["square", "small", "medium", "large"],
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT", "USER"],
  },

  {
    key: "finance.main_title_type",
    category: "finance",
    type: "STRING",
    label: "Tipo do título principal",
    description: "Código do tipo Protheus (SX5) para títulos de amortização/principal gerados a partir do contrato. Ex.: DEF.",
    defaultValue: "DEF",
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT"],
  },
  {
    key: "finance.interest_title_type",
    category: "finance",
    type: "STRING",
    label: "Tipo do título de juros",
    description: "Código do tipo Protheus para títulos de juros com vencimento no mês corrente ou já vencidos. Ex.: JUR.",
    defaultValue: "JUR",
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT"],
  },
  {
    key: "finance.provisional_title_type",
    category: "finance",
    type: "STRING",
    label: "Tipo do título provisório",
    description: "Código do tipo Protheus para títulos de juros/IOF com vencimento em mês futuro. Ex.: PR.",
    defaultValue: "PR",
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT"],
  },
  {
    key: "finance.main_title_nature",
    category: "finance",
    type: "STRING",
    label: "Natureza do título principal",
    description: "Código ED_CODIGO da natureza aplicada automaticamente aos títulos de amortização/principal. Deixe vazio para classificar manualmente.",
    defaultValue: "",
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT"],
  },
  {
    key: "finance.interest_title_nature",
    category: "finance",
    type: "STRING",
    label: "Natureza do título de juros",
    description: "Código ED_CODIGO da natureza aplicada automaticamente aos títulos de juros e IOF. Deixe vazio para classificar manualmente.",
    defaultValue: "",
    isEditable: true,
    implemented: true,
    writableScopes: ["TENANT"],
  },

  // Planejados — arquitetura preparada, sem UI/regra de negócio ainda.
  { key: "contracts.require_approval", category: "contracts", type: "BOOLEAN", label: "Exigir aprovação", description: "", defaultValue: true, implemented: false, writableScopes: ["TENANT"] },
  { key: "contracts.minimum_approvers", category: "contracts", type: "INTEGER", label: "Aprovadores mínimos", description: "", defaultValue: 1, implemented: false, writableScopes: ["TENANT"] },
  { key: "contracts.allow_reopen", category: "contracts", type: "BOOLEAN", label: "Permitir reabertura", description: "", defaultValue: true, implemented: false, writableScopes: ["TENANT"] },
  { key: "contracts.require_document", category: "contracts", type: "BOOLEAN", label: "Exigir documento", description: "", defaultValue: false, implemented: false, writableScopes: ["TENANT"] },
  { key: "contracts.auto_generate_payables", category: "contracts", type: "BOOLEAN", label: "Gerar títulos automaticamente", description: "", defaultValue: false, implemented: false, writableScopes: ["TENANT"] },
  { key: "finance.due_alert_days", category: "finance", type: "INTEGER", label: "Dias para alerta de vencimento", description: "", defaultValue: 5, implemented: false, writableScopes: ["TENANT"] },
  { key: "finance.auto_generate_payables", category: "finance", type: "BOOLEAN", label: "Gerar contas a pagar", description: "", defaultValue: false, implemented: false, writableScopes: ["TENANT"] },
  { key: "finance.allow_erp_reversal", category: "finance", type: "BOOLEAN", label: "Permitir estorno ERP", description: "", defaultValue: true, implemented: false, writableScopes: ["TENANT"] },
  { key: "finance.default_currency", category: "finance", type: "STRING", label: "Moeda padrão", description: "", defaultValue: "BRL", implemented: false, writableScopes: ["TENANT"] },
  { key: "accounting.auto_closing", category: "accounting", type: "BOOLEAN", label: "Fechamento automático", description: "", defaultValue: false, implemented: false, writableScopes: ["TENANT"] },
  { key: "accounting.require_validation", category: "accounting", type: "BOOLEAN", label: "Exigir validação", description: "", defaultValue: true, implemented: false, writableScopes: ["TENANT"] },
  { key: "integrations.auto_retry", category: "integrations", type: "BOOLEAN", label: "Retry automático", description: "", defaultValue: true, implemented: false, writableScopes: ["TENANT"] },
  { key: "integrations.retry_limit", category: "integrations", type: "INTEGER", label: "Limite de retries", description: "", defaultValue: 3, implemented: false, writableScopes: ["TENANT"] },
  { key: "system.language", category: "system", type: "ENUM", label: "Idioma", description: "", defaultValue: "pt-BR", allowedValues: ["pt-BR", "en-US"], implemented: false, writableScopes: ["TENANT", "USER"] },
  { key: "system.timezone", category: "system", type: "STRING", label: "Fuso horário", description: "", defaultValue: "America/Sao_Paulo", implemented: false, writableScopes: ["TENANT"] },
  { key: "system.date_format", category: "system", type: "STRING", label: "Formato de data", description: "", defaultValue: "DD/MM/YYYY", implemented: false, writableScopes: ["TENANT", "USER"] },
  { key: "system.decimal_places", category: "system", type: "INTEGER", label: "Casas decimais", description: "", defaultValue: 2, implemented: false, writableScopes: ["TENANT"] },
  { key: "system.session_timeout", category: "system", type: "INTEGER", label: "Timeout de sessão (min)", description: "", defaultValue: 480, implemented: false, writableScopes: ["TENANT"] },
];

const definitionMap = new Map(PARAMETER_DEFINITIONS.map((d) => [d.key, d]));

export function getDefinition(key) {
  return definitionMap.get(key) || null;
}

export function listDefinitions({ implementedOnly = true } = {}) {
  return PARAMETER_DEFINITIONS.filter((d) => !implementedOnly || d.implemented !== false);
}

export function listCategories() {
  return Object.entries(PARAMETER_CATEGORIES)
    .map(([id, meta]) => ({ id, ...meta }))
    .sort((a, b) => a.order - b.order);
}

export const LAYOUT_LABELS = {
  classic: "Clássico",
  modern: "Moderno",
};

export const LAYOUT_DESCRIPTIONS = {
  classic: "Mantém o layout atual exatamente como está hoje.",
  modern: "Utiliza a nova experiência com menu lateral e identidade visual moderna.",
};
