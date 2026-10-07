// Tipo, prefixo e natureza do título a pagar de tributo no Protheus, configurados uma vez por cliente em
// Configurações > Lógica Contábil. Vazio = não configurado: o título fica pendente e não é enviado.

export const TAX_TITLE_TYPE_PARAMETER = "finance.tax_title_type";
export const TAX_TITLE_PREFIX_PARAMETER = "finance.tax_title_prefix";
export const TAX_TITLE_NATURE_PARAMETER = "finance.tax_title_nature";

const CODE_PATTERN = /^[A-Z0-9]+$/;

function configError(message, field) {
  const err = new Error(message);
  err.status = 400;
  err.code = "INVALID_PARAMETER_VALUE";
  err.details = { field };
  return err;
}

function normalizeCode(value, { max, label, example, field }) {
  if (typeof value !== "string") throw configError(`Informe o ${label} como texto.`, field);
  const code = value.trim().toUpperCase();
  if (!code) return "";
  if (!CODE_PATTERN.test(code) || code.length > max) {
    throw configError(`O ${label} tem até ${max} letras ou números, sem espaços nem símbolos (ex.: ${example}).`, field);
  }
  return code;
}

/** E2_TIPO (3): tipo do título de tributo cadastrado no Protheus (SX5, tabela 05). */
export function normalizeTaxTitleType(value) {
  return normalizeCode(value, { max: 3, label: "tipo do título de tributo", example: "TX", field: TAX_TITLE_TYPE_PARAMETER });
}

/** E2_PREFIXO (3): identifica os títulos de tributo no SE2 e os separa dos de empréstimo. */
export function normalizeTaxTitlePrefix(value) {
  return normalizeCode(value, { max: 3, label: "prefixo do título de tributo", example: "TRB", field: TAX_TITLE_PREFIX_PARAMETER });
}

/** E2_NATUREZ (10): código ED_CODIGO da natureza; precisa existir no cadastro de naturezas. */
export function normalizeTaxTitleNature(value) {
  if (typeof value !== "string") throw configError("Informe a natureza do título de tributo como texto.", TAX_TITLE_NATURE_PARAMETER);
  const code = value.trim();
  if (code.length > 10 || /\s/.test(code)) {
    throw configError("A natureza do título de tributo é o código da natureza no Protheus, com até 10 caracteres e sem espaços.", TAX_TITLE_NATURE_PARAMETER);
  }
  return code;
}
