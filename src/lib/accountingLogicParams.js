// Parâmetros que classificam os títulos do Contas a Pagar (natureza e conta
// contábil), editados como texto no cartão "Classificação dos títulos".
export const TITLE_CLASSIFICATION_PARAM_KEYS = [
  "finance.main_title_nature",
  "finance.interest_title_nature",
  "accounting.main_title_account",
  "accounting.interest_title_account",
  "accounting.settlement_required_from",
];

/** Fornecedor (credor) dos títulos de tributo no Protheus — cartão próprio na Lógica Contábil. */
export const TAX_SUPPLIERS_PARAM_KEY = "finance.tax_suppliers";

// Tudo o que é lógica contábil fica em Configurações → Lógica Contábil, não na
// tela genérica de Parâmetros.
export const ACCOUNTING_LOGIC_PARAM_KEYS = [...TITLE_CLASSIFICATION_PARAM_KEYS, TAX_SUPPLIERS_PARAM_KEY];
