// Fornecedor (credor) dos títulos de tributo no Protheus: o rascunho da tela e a conversão de/para o valor do
// parâmetro `finance.tax_suppliers` ({ federal, estadual, por_uf: { UF: { fornecedor, loja } } }).
// O servidor valida e padroniza (maiúsculas, zeros à esquerda); aqui só se monta o que a pessoa digitou.

export const SUPPLIER_CODE_MAX = 6;
export const SUPPLIER_STORE_SIZE = 2;

function entryDraft(entry) {
  return { fornecedor: entry?.fornecedor ?? "", loja: entry?.loja ?? "" };
}

let rowSeq = 0;
function nextRowId() {
  rowSeq += 1;
  return `uf-${rowSeq}`;
}

/** Rascunho editável a partir do valor salvo. */
export function draftFromValue(value) {
  return {
    federal: entryDraft(value?.federal),
    estadual: entryDraft(value?.estadual),
    porUf: Object.entries(value?.por_uf || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([uf, entry]) => ({ id: nextRowId(), uf, ...entryDraft(entry) })),
  };
}

export function newStateRow() {
  return { id: nextRowId(), uf: "", fornecedor: "", loja: "" };
}

function entryValue(entry) {
  const fornecedor = String(entry?.fornecedor ?? "").trim();
  const loja = String(entry?.loja ?? "").trim();
  if (!fornecedor && !loja) return null;
  return { fornecedor, loja };
}

/**
 * Valor a gravar a partir do rascunho. Linhas de UF sem UF escolhida ficam de fora — quem chama confere antes
 * (`stateRowsWithoutUf`).
 */
export function valueFromDraft(draft) {
  const porUf = {};
  for (const row of draft.porUf) {
    if (!row.uf) continue;
    // Linha de UF totalmente vazia vai assim mesmo: o servidor a descarta, como a tela espera.
    porUf[row.uf] = { fornecedor: String(row.fornecedor ?? "").trim(), loja: String(row.loja ?? "").trim() };
  }
  return { federal: entryValue(draft.federal), estadual: entryValue(draft.estadual), por_uf: porUf };
}

/** Linhas de exceção com fornecedor ou loja preenchidos e sem a UF escolhida. */
export function stateRowsWithoutUf(draft) {
  return draft.porUf.filter((row) => !row.uf && (String(row.fornecedor).trim() || String(row.loja).trim()));
}

function comparable(value) {
  const entry = (item) => (item ? `${String(item.fornecedor).toUpperCase()}/${String(item.loja).toUpperCase()}` : "");
  const states = Object.entries(value?.por_uf || {})
    .filter(([, item]) => String(item?.fornecedor ?? "").trim() || String(item?.loja ?? "").trim())
    .map(([uf, item]) => `${uf}=${entry(item)}`)
    .sort();
  return JSON.stringify([entry(value?.federal), entry(value?.estadual), states]);
}

/** O rascunho difere do que está salvo? */
export function isDraftDirty(draft, savedValue) {
  return comparable(valueFromDraft(draft)) !== comparable(savedValue) || stateRowsWithoutUf(draft).length > 0;
}

/** Há algum fornecedor configurado no valor salvo? */
export function hasAnySupplier(value) {
  return Boolean(value?.federal || value?.estadual || Object.keys(value?.por_uf || {}).length);
}

/** "federal" → "Tributos federais"; "por_uf.SP" → "Tributos estaduais de SP". */
export function supplierScopeLabel(campo) {
  if (campo === "federal") return "Tributos federais";
  if (campo === "estadual") return "Tributos estaduais (padrão)";
  const match = /^por_uf\.([A-Z]{2})/.exec(String(campo || ""));
  return match ? `Tributos estaduais de ${match[1]}` : "Fornecedor";
}

const CHECK_LABELS = {
  encontrado: "Encontrado no Protheus",
  nao_encontrado: "Não encontrado no Protheus",
  nao_conferido: "Não foi possível conferir no Protheus",
};

/** Rótulo da conferência; qualquer situação que não seja "encontrado" nunca vira "conferido". */
export function supplierCheckLabel(situacao) {
  return CHECK_LABELS[situacao] || CHECK_LABELS.nao_conferido;
}

/** Avisos que não repetem a mensagem já mostrada ao lado de um fornecedor. */
export function extraWarnings(conferencia) {
  const shown = new Set((conferencia?.fornecedores || []).map((item) => item.mensagem).filter(Boolean));
  return (conferencia?.avisos || []).filter((text) => !shown.has(text));
}

/** Quem pode gravar parâmetros (mesma regra do servidor). */
export function canEditParameters(user) {
  if (!user || user.role === "viewer" || user.tenant_role === "VIEWER") return false;
  return user.role === "admin" || user.tenant_role === "OWNER" || user.tenant_role === "ADMIN" || Boolean(user.platform_admin);
}
