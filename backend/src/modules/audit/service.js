import { pool } from "../../db/pool.js";
import { actionLabel, diffRecords, sideSummary, extractErpError } from "./format.js";
import { scopedGroupSql } from "../tenants/access.js";

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function boundDate(value, endOfDay = false) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return endOfDay ? `${text}T23:59:59.999-03:00` : `${text}T00:00:00.000-03:00`;
  }
  return text;
}

function clipRegistro(text, size = 220) {
  const value = String(text || "").trim();
  if (!value) return "—";
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

export function toPublic(row) {
  const before = parseJson(row.before_json);
  const after = parseJson(row.after_json);
  const payload = parseJson(row.payload);
  const changes = diffRecords(before, after);
  const erpError = extractErpError(after);
  let registro = row.registro || row.resource_id || "—";
  // Garante que a mensagem do ERP apareça no campo Registro (lista do log),
  // inclusive em eventos antigos que só tinham o erro em after.titulos[].message.
  if (erpError) {
    const compact = erpError.slice(0, 80);
    if (!String(registro).includes(compact)) {
      const failed = Number(after?.failed) || 0;
      const prefix = failed > 0
        ? `${failed} ${failed === 1 ? "título com falha" : "títulos com falha"}`
        : "Falha na integração";
      registro = clipRegistro(`${prefix} · ${erpError}`, 280);
    }
  }
  const sides = sideSummary(row.action, before, after, changes, registro);
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    requestId: row.request_id,
    user: row.actor_email || "sistema",
    userName: row.actor_name || null,
    processingType: row.processing_type || "manual",
    rotina: row.rotina || row.resource_type,
    registro,
    erpError: erpError || null,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    before,
    after,
    payload,
    changes,
    de: sides.de,
    para: sides.para,
    ipAddress: row.ip_address,
  };
}

export async function list(filters = {}) {
  const scope = scopedGroupSql("group_id");
  const where = [scope.sql];
  const params = [...scope.params];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };

  const from = boundDate(filters.from, false);
  const to = boundDate(filters.to, true);
  if (from) add("occurred_at >= ?", from);
  if (to) add("occurred_at <= ?", to);
  if (filters.actor) add("actor_email = ?", filters.actor);
  if (filters.action) add("action = ?", filters.action);
  if (filters.rotina) add("rotina = ?", filters.rotina);
  if (filters.processingType) add("processing_type = ?", filters.processingType);
  if (filters.q) {
    params.push(`%${String(filters.q).trim()}%`);
    const slot = `$${params.length}`;
    where.push(`(
      coalesce(registro, '') ILIKE ${slot}
      OR coalesce(actor_email, '') ILIKE ${slot}
      OR coalesce(actor_name, '') ILIKE ${slot}
      OR coalesce(rotina, '') ILIKE ${slot}
      OR coalesce(action, '') ILIKE ${slot}
      OR coalesce(resource_id, '') ILIKE ${slot}
    )`);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM audit_events ${clause}`, params);
  const result = await pool.query(
    `SELECT * FROM audit_events ${clause} ORDER BY occurred_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return {
    items: result.rows.map(toPublic),
    total: count.rows[0].total,
    limit,
    offset,
  };
}

export async function getById(id) {
  const scope = scopedGroupSql("group_id", 2);
  const result = await pool.query(
    `SELECT * FROM audit_events WHERE id = $1 AND ${scope.sql}`,
    [id, ...scope.params]
  );
  return result.rows[0] ? toPublic(result.rows[0]) : null;
}

export async function meta() {
  const scope = scopedGroupSql("group_id");
  const [actors, actions, rotinas, types] = await Promise.all([
    pool.query(
      `SELECT DISTINCT actor_email FROM audit_events WHERE actor_email IS NOT NULL AND ${scope.sql} ORDER BY 1 LIMIT 200`,
      scope.params
    ),
    pool.query(`SELECT DISTINCT action FROM audit_events WHERE ${scope.sql} ORDER BY 1`, scope.params),
    pool.query(`SELECT DISTINCT rotina FROM audit_events WHERE rotina IS NOT NULL AND ${scope.sql} ORDER BY 1`, scope.params),
    pool.query(
      `SELECT DISTINCT processing_type FROM audit_events WHERE processing_type IS NOT NULL AND ${scope.sql} ORDER BY 1`,
      scope.params
    ),
  ]);
  return {
    actors: actors.rows.map((row) => row.actor_email),
    actions: actions.rows.map((row) => row.action),
    rotinas: rotinas.rows.map((row) => row.rotina),
    processingTypes: types.rows.map((row) => row.processing_type),
  };
}
