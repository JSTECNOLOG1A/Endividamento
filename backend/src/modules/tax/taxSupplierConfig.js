import { BRAZILIAN_STATES } from "./brazilianStates.js";

// Fornecedor (credor) dos títulos de tributo no Protheus, configurado uma vez por cliente em
// Configurações > Lógica Contábil. Segue o padrão do Protheus: um fornecedor para os tributos federais (Receita
// e PGFN; no Protheus, parâmetro MV_UNIAO, normalmente "UNIAO") e um para os estaduais (MV_RECEST), com exceção
// por UF quando o estado tiver um fornecedor próprio.
//
// Guardado no parâmetro de cliente `finance.tax_suppliers`:
//   { federal: { fornecedor, loja } | null,
//     estadual: { fornecedor, loja } | null,
//     por_uf: { "SP": { fornecedor, loja }, ... } }
// Fornecedor: até 6 letras/números (E2_FORNECE); loja: 2 letras/números (E2_LOJA). Gravados em maiúsculas; código
// só de números com menos de 6 dígitos ganha zeros à esquerda, como o título a pagar envia ao Protheus.

export const TAX_SUPPLIERS_PARAMETER = "finance.tax_suppliers";

export const EMPTY_TAX_SUPPLIERS = Object.freeze({ federal: null, estadual: null, por_uf: Object.freeze({}) });

/** Valor do Protheus mostrado como sugestão na tela — nunca gravado sem o cliente confirmar. */
export const SUGGESTED_TAX_SUPPLIERS = Object.freeze({
  federal: Object.freeze({ fornecedor: "UNIAO", loja: "00" }),
});

const SETTINGS_PLACE = "Configurações > Lógica Contábil";
const SUPPLIER_MAX = 6;
const STORE_SIZE = 2;
const CODE_PATTERN = /^[A-Z0-9]+$/;
const TOP_LEVEL_KEYS = new Set(["federal", "estadual", "por_uf"]);

function configError(message, field, status = 400, code = "INVALID_PARAMETER_VALUE") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = { field };
  return err;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function whose(scope) {
  if (scope === "federal") return "dos tributos federais";
  if (scope === "estadual") return "dos tributos estaduais";
  return `dos tributos estaduais de ${scope}`;
}

function normalizeSupplierCode(value, scope, field) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw configError(`Informe o código do fornecedor ${whose(scope)} com até ${SUPPLIER_MAX} letras ou números.`, field);
  }
  const code = String(value).trim().toUpperCase();
  if (!CODE_PATTERN.test(code) || code.length > SUPPLIER_MAX) {
    throw configError(
      `O código do fornecedor ${whose(scope)} deve ter até ${SUPPLIER_MAX} letras ou números, sem espaços nem símbolos (ex.: UNIAO).`,
      field
    );
  }
  return /^\d+$/.test(code) ? code.padStart(SUPPLIER_MAX, "0") : code;
}

function normalizeStore(value, scope, field) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw configError(`Informe a loja do fornecedor ${whose(scope)} com ${STORE_SIZE} letras ou números (ex.: 00).`, field);
  }
  const store = String(value).trim().toUpperCase();
  if (!CODE_PATTERN.test(store) || store.length !== STORE_SIZE) {
    throw configError(`A loja do fornecedor ${whose(scope)} tem ${STORE_SIZE} letras ou números (ex.: 00 ou 01).`, field);
  }
  return store;
}

function normalizeEntry(entry, scope, path) {
  if (entry === null || entry === undefined) return null;
  if (!isPlainObject(entry)) {
    throw configError(`Informe o fornecedor ${whose(scope)} com código e loja.`, path);
  }
  const unknown = Object.keys(entry).filter((key) => key !== "fornecedor" && key !== "loja");
  if (unknown.length) throw configError(`Campo desconhecido no fornecedor ${whose(scope)}: ${unknown.join(", ")}.`, path);
  const hasSupplier = !isBlank(entry.fornecedor);
  const hasStore = !isBlank(entry.loja);
  if (!hasSupplier && !hasStore) return null;
  if (!hasSupplier) throw configError(`Informe o código do fornecedor ${whose(scope)} junto com a loja.`, `${path}.fornecedor`);
  if (!hasStore) {
    throw configError(`Informe a loja do fornecedor ${whose(scope)} (${STORE_SIZE} letras ou números, ex.: 00).`, `${path}.loja`);
  }
  return {
    fornecedor: normalizeSupplierCode(entry.fornecedor, scope, `${path}.fornecedor`),
    loja: normalizeStore(entry.loja, scope, `${path}.loja`),
  };
}

/**
 * Confere e padroniza a configuração enviada pela tela. Lança erro 400 com mensagem para o usuário.
 * @returns {{ federal: object|null, estadual: object|null, por_uf: Record<string, object> }}
 */
export function normalizeTaxSuppliers(value) {
  if (!isPlainObject(value)) {
    throw configError("Os fornecedores dos tributos foram enviados em formato inválido.", null);
  }
  const unknown = Object.keys(value).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknown.length) throw configError(`Campo desconhecido na configuração dos fornecedores de tributos: ${unknown.join(", ")}.`, null);

  const byState = {};
  if (value.por_uf !== undefined && value.por_uf !== null) {
    if (!isPlainObject(value.por_uf)) {
      throw configError("As exceções por UF foram enviadas em formato inválido.", "por_uf");
    }
    for (const [rawUf, entry] of Object.entries(value.por_uf)) {
      const uf = String(rawUf).trim().toUpperCase();
      if (!BRAZILIAN_STATES.has(uf)) {
        throw configError(`UF inválida nas exceções dos tributos estaduais: ${rawUf}. Use a sigla do estado, por exemplo SP.`, "por_uf");
      }
      if (Object.prototype.hasOwnProperty.call(byState, uf)) {
        throw configError(`A UF ${uf} aparece duas vezes nas exceções dos tributos estaduais.`, `por_uf.${uf}`);
      }
      const normalized = normalizeEntry(entry, uf, `por_uf.${uf}`);
      if (normalized) byState[uf] = normalized;
    }
  }
  return {
    federal: normalizeEntry(value.federal, "federal", "federal"),
    estadual: normalizeEntry(value.estadual, "estadual", "estadual"),
    por_uf: Object.fromEntries(Object.keys(byState).sort().map((uf) => [uf, byState[uf]])),
  };
}

function missingSupplier(message, details) {
  const err = new Error(message);
  err.status = 422;
  err.code = "TAX_SUPPLIER_NOT_CONFIGURED";
  err.details = details;
  return err;
}

/**
 * Fornecedor do título de tributo de um parcelamento, a partir da configuração do cliente.
 * Federal → fornecedor federal. Estadual → exceção da UF do parcelamento ou, sem ela, o padrão estadual.
 * @param {object|null|undefined} config valor de `finance.tax_suppliers`
 * @param {{ esfera: string, uf?: string|null }} agreement
 * @returns {{ fornecedor: string, loja: string, origem: "federal"|"estadual_uf"|"estadual_padrao" }}
 */
export function pickTaxSupplier(config, agreement) {
  let suppliers;
  try {
    suppliers = normalizeTaxSuppliers(config ?? EMPTY_TAX_SUPPLIERS);
  } catch {
    throw missingSupplier(
      `A configuração dos fornecedores de tributos está inválida. Revise em ${SETTINGS_PLACE}.`,
      { motivo: "configuracao_invalida" }
    );
  }
  const esfera = String(agreement?.esfera || "").toLowerCase();
  if (esfera === "federal") {
    if (suppliers.federal) return { ...suppliers.federal, origem: "federal" };
    throw missingSupplier(`Informe o fornecedor dos tributos federais em ${SETTINGS_PLACE}.`, { esfera });
  }
  if (esfera === "estadual") {
    const uf = String(agreement?.uf || "").trim().toUpperCase();
    if (uf && suppliers.por_uf[uf]) return { ...suppliers.por_uf[uf], origem: "estadual_uf" };
    if (suppliers.estadual) return { ...suppliers.estadual, origem: "estadual_padrao" };
    throw missingSupplier(
      uf
        ? `Informe o fornecedor dos tributos estaduais (o padrão ou o de ${uf}) em ${SETTINGS_PLACE}.`
        : `Informe o fornecedor dos tributos estaduais em ${SETTINGS_PLACE}.`,
      { esfera, uf: uf || null }
    );
  }
  throw missingSupplier(
    "Parcelamento municipal ainda não tem fornecedor de tributos configurável. Use parcelamentos federais ou estaduais.",
    { esfera: esfera || null }
  );
}
