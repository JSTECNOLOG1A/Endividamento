import { pool } from "../../db/pool.js";

const TITLE_TABLES = {
  PayableTitle: "payable_titles",
  ReceivableTitle: "receivable_titles",
};

function asIdList(value) {
  if (!Array.isArray(value)) {
    if (value == null || value === "") return [];
    return [String(value)];
  }
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function pickIdsFromList(list) {
  if (!Array.isArray(list)) return [];
  const ids = [];
  for (const item of list) {
    if (typeof item === "string" || typeof item === "number") ids.push(String(item));
    else if (item?.id) ids.push(String(item.id));
  }
  return ids;
}

export function collectIds(result, payload) {
  return [...new Set([
    ...pickIdsFromList(result?.titulos),
    ...pickIdsFromList(result?.results),
    ...pickIdsFromList(result?.items),
    ...pickIdsFromList(result?.ids),
    ...pickIdsFromList(result?.detalhes?.results),
    ...pickIdsFromList(result?.detalhes?.titulos),
    ...asIdList(payload?.ids),
  ])];
}

export function titleLabel(row) {
  if (!row) return "—";
  const parts = [row.prefixo, row.titulo_numero, row.parcela]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (parts.length) return parts.join(" ");
  if (row.codigo) {
    return row.descricao ? `${row.codigo} — ${row.descricao}` : String(row.codigo);
  }
  if (row.nome) return String(row.nome);
  if (row.label) return String(row.label);
  return row.id || "—";
}

export function toRecordRef(row, extra = {}) {
  if (!row) return null;
  const ok = extra.ok ?? row.ok;
  return {
    id: row.id || extra.id || null,
    label: titleLabel({ ...extra, ...row }),
    prefixo: row.prefixo || extra.prefixo || null,
    numero: row.titulo_numero || extra.titulo_numero || extra.numero || null,
    parcela: row.parcela || extra.parcela || null,
    tipo: row.tipo || extra.tipo || null,
    ok: ok == null ? null : Boolean(ok),
    message: extra.message || row.message || null,
  };
}

function refsFromResult(result) {
  const lists = [result?.titulos, result?.results, result?.items, result?.detalhes?.results, result?.detalhes?.titulos];
  const refs = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      if (item.prefixo || item.titulo_numero || item.numero || item.codigo || item.nome || item.label) {
        refs.push(toRecordRef(item));
      }
    }
  }
  return refs.filter(Boolean);
}

export function recordsLabel(records, fallback, result = {}) {
  if (records?.length) {
    const shown = records.slice(0, 6).map((row) => row.label).join(", ");
    const extra = records.length > 6 ? ` (+${records.length - 6})` : "";
    const count = `${records.length} ${records.length === 1 ? "registro" : "registros"}`;
    return `${count}: ${shown}${extra}`;
  }
  const count = result.created ?? result.integrated ?? result.reversed ?? result.consulted ?? result.updated;
  if (count != null) {
    return `${count} ${Number(count) === 1 ? "registro" : "registros"} · ${fallback}`;
  }
  return fallback;
}

function countsFrom(result = {}) {
  const keys = ["created", "updated", "integrated", "reversed", "consulted", "converted", "failed", "skipped", "total", "contracts", "scanned", "selected"];
  const out = {};
  for (const key of keys) {
    if (result[key] != null) out[key] = result[key];
  }
  if (result.detalhes && typeof result.detalhes === "object") {
    for (const key of keys) {
      if (out[key] == null && result.detalhes[key] != null) out[key] = result.detalhes[key];
    }
  }
  return out;
}

export async function snapshotForAudit({ resourceType, result, payload, fallbackLabel }) {
  let records = refsFromResult(result);
  const ids = collectIds(result, payload);
  const table = TITLE_TABLES[resourceType];
  if (table && ids.length && (records.length < ids.length || records.every((row) => !row.prefixo && !row.numero))) {
    const fetched = await pool.query(
      `SELECT id, prefixo, titulo_numero, parcela, tipo FROM ${table} WHERE id = ANY($1::text[])`,
      [ids]
    );
    const byId = new Map(fetched.rows.map((row) => [row.id, row]));
    const extras = [
      ...(Array.isArray(result?.results) ? result.results : []),
      ...(Array.isArray(result?.detalhes?.results) ? result.detalhes.results : []),
    ];
    const extraById = new Map(extras.filter((item) => item?.id).map((item) => [item.id, item]));
    records = ids.map((id) => toRecordRef(byId.get(id) || { id }, extraById.get(id) || {}));
  }
  const counts = countsFrom(result);
  const registro = recordsLabel(records, fallbackLabel, { ...result, ...counts });
  return {
    registro,
    after: {
      resumo: registro,
      ...counts,
      message: result?.message || null,
      ok: result?.ok,
      titulos: records.slice(0, 100),
    },
  };
}
