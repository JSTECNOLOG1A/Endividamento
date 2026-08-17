export function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

export function unwrapValue(value) {
  if (Array.isArray(value)) {
    return value.length === 1 ? unwrapValue(value[0]) : value;
  }
  const record = asRecord(value);
  if (!record) return value;
  if ("value" in record) return unwrapValue(record.value);
  if ("Valor" in record) return unwrapValue(record.Valor);
  return value;
}

function normalizeLookupKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function lookup(record, keys) {
  const entries = Object.entries(record);
  for (const key of keys) {
    const match = entries.find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase());
    if (match && match[1] != null && match[1] !== "") return unwrapValue(match[1]);
  }
  return undefined;
}

export function lookupLoose(record, keys) {
  const direct = lookup(record, keys);
  if (direct != null && direct !== "") return direct;
  const entries = Object.entries(record);
  for (const key of keys) {
    const needle = normalizeLookupKey(key);
    if (!needle) continue;
    const match = entries.find(([entryKey]) => {
      const normalized = normalizeLookupKey(entryKey);
      return normalized === needle || normalized.endsWith(needle);
    });
    if (match && match[1] != null && match[1] !== "") return unwrapValue(match[1]);
  }
  return undefined;
}

export function isErpBlockedValue(value) {
  if (value === true) return true;
  const text = asTrimmedString(value);
  if (!text) return false;
  const normalized = text.toUpperCase();
  return ["1", "S", "SIM", "TRUE", "YES", "Y", "BLOQUEADO", "INATIVO"].includes(normalized);
}

export function isErpDeletedRecord(record) {
  const deleted = lookupLoose(record, ["d_e_l_e_t_", "deleted", "deletado"]);
  const text = asTrimmedString(deleted);
  if (!text) return false;
  return text !== ".";
}

export function isErpBlockedRecord(record) {
  return isErpBlockedValue(lookupLoose(record, [
    "msblql",
    "a2_msblql",
    "a6_msblql",
    "ed_msblql",
    "x5_msblql",
    "a6_block",
    "a6_bloqueado",
    "ct1_msblql",
    "ct1_bloq",
    "m0_bloqueio",
    "bloqueado",
    "blocked",
    "inativo",
  ]));
}

export function asTrimmedString(value) {
  const unwrapped = unwrapValue(value);
  if (unwrapped == null) return null;
  if (typeof unwrapped === "object") return null;
  const text = String(unwrapped).trim();
  return text === "" ? null : text;
}

export function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ["items", "data", "value", "results", "content", "tables", "companies", "branches", "naturezas", "contas", "bancos", "sa6", "sa2", "sx5", "ct1", "plano", "planoContas", "fornecedores", "tipos"]) {
    const nested = lookup(root, [key]);
    if (Array.isArray(nested)) return nested;
    const nestedRecord = asRecord(nested);
    if (nestedRecord) {
      const deeper = extractArray(nestedRecord);
      if (deeper.length) return deeper;
    }
  }
  return [];
}

export function flattenItem(item) {
  const record = asRecord(item);
  if (!record) return null;
  const nested = lookup(record, ["fields", "field", "attributes"]);
  const nestedRecord = asRecord(nested);
  if (nestedRecord) return { ...nestedRecord, ...record };
  if (Array.isArray(nested)) {
    const fromFields = {};
    for (const field of nested) {
      const rec = asRecord(field);
      if (!rec) continue;
      const name = asTrimmedString(lookup(rec, ["id", "name", "campo", "key", "field"]));
      if (!name) continue;
      fromFields[name] = rec.value ?? rec.Valor ?? rec.valor ?? rec.content;
    }
    return { ...fromFields, ...record };
  }
  return record;
}
