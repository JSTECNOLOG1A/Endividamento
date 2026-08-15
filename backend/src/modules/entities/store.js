import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { allowedColumns, getEntity, SYSTEM_FIELDS } from "./catalog.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toDbValue(entity, key, value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (entity.booleans.includes(key)) return Boolean(value);
  if (entity.numbers.includes(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}

function fromDbValue(entity, key, value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) {
    if (["operation_date", "first_payment_date", "final_maturity_date", "rate_date", "holiday_date", "trial_ends_at"].includes(key)) {
      return value.toISOString().slice(0, 10);
    }
    return value.toISOString();
  }
  if (entity.booleans.includes(key)) return Boolean(value);
  if (entity.numbers.includes(key) && value !== null) return Number(value);
  if (key === "currency_code" || key === "currency") return value ? String(value).trim() : value;
  return value;
}

function splitPayload(entity, data = {}) {
  const known = allowedColumns(entity);
  const row = {};
  const extra = {};
  for (const [key, value] of Object.entries(data)) {
    if (SYSTEM_FIELDS.includes(key) && key !== "created_by") continue;
    if (known.has(key)) row[key] = toDbValue(entity, key, value);
    else extra[key] = value;
  }
  if (Object.keys(extra).length > 0) row.extra_json = extra;
  return row;
}

function rowToObject(entity, row) {
  if (!row) return null;
  const obj = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "extra_json") {
      if (value && typeof value === "object") Object.assign(obj, value);
      continue;
    }
    obj[key] = fromDbValue(entity, key, value);
  }
  return obj;
}

function parseSort(entity, sort) {
  const allowed = allowedColumns(entity);
  if (!sort) return { column: "created_date", dir: "DESC" };
  const desc = sort.startsWith("-");
  const column = desc ? sort.slice(1) : sort;
  if (!allowed.has(column)) return { column: "created_date", dir: "DESC" };
  return { column, dir: desc ? "DESC" : "ASC" };
}

function buildFilter(entity, query = {}) {
  const allowed = allowedColumns(entity);
  const where = [];
  const params = [];
  let i = 1;
  for (const [key, value] of Object.entries(query || {})) {
    if (!allowed.has(key)) continue;
    if (value && typeof value === "object" && Array.isArray(value.$in)) {
      if (value.$in.length === 0) {
        where.push("1 = 0");
        continue;
      }
      const slots = value.$in.map(() => `$${i++}`);
      where.push(`${key} IN (${slots.join(", ")})`);
      params.push(...value.$in);
    } else {
      where.push(`${key} = $${i++}`);
      params.push(toDbValue(entity, key, value));
    }
  }
  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export async function list(name, sort, limit = 100) {
  const entity = getEntity(name);
  const { column, dir } = parseSort(entity, sort);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 20000);
  const result = await pool.query(
    `SELECT * FROM ${entity.table} ORDER BY ${column} ${dir} LIMIT $1`,
    [safeLimit]
  );
  return result.rows.map((row) => rowToObject(entity, row));
}

export async function filter(name, query, sort, limit = 100) {
  const entity = getEntity(name);
  const { column, dir } = parseSort(entity, sort);
  const { sql, params } = buildFilter(entity, query);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 20000);
  const result = await pool.query(
    `SELECT * FROM ${entity.table} ${sql} ORDER BY ${column} ${dir} LIMIT $${params.length + 1}`,
    [...params, safeLimit]
  );
  return result.rows.map((row) => rowToObject(entity, row));
}

export async function getById(name, id) {
  const entity = getEntity(name);
  const result = await pool.query(`SELECT * FROM ${entity.table} WHERE id = $1`, [id]);
  if (!result.rows[0]) throw httpError(404, `${name} não encontrado`);
  return rowToObject(entity, result.rows[0]);
}

export async function create(name, data, createdBy) {
  const entity = getEntity(name);
  const row = splitPayload(entity, data);
  row.id = randomUUID();
  row.created_by = data?.created_by || createdBy;
  const keys = Object.keys(row);
  const values = keys.map((key) => row[key]);
  const slots = keys.map((_, idx) => `$${idx + 1}`);
  await pool.query(
    `INSERT INTO ${entity.table} (${keys.join(", ")}) VALUES (${slots.join(", ")})`,
    values
  );
  return getById(name, row.id);
}

export async function bulkCreate(name, items = [], createdBy) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = [];
    for (const item of items) {
      created.push(await create(name, item, createdBy));
    }
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function update(name, id, data) {
  const entity = getEntity(name);
  if (entity.immutable) throw httpError(409, `${name} é imutável`);
  await getById(name, id);
  const row = splitPayload(entity, data);
  row.updated_date = new Date().toISOString();
  const keys = Object.keys(row);
  if (keys.length === 1 && keys[0] === "updated_date") return getById(name, id);
  const assignments = keys.map((key, idx) => `${key} = $${idx + 1}`).join(", ");
  await pool.query(
    `UPDATE ${entity.table} SET ${assignments} WHERE id = $${keys.length + 1}`,
    [...keys.map((key) => row[key]), id]
  );
  return getById(name, id);
}

export async function remove(name, id) {
  const entity = getEntity(name);
  if (entity.immutable) throw httpError(409, `${name} é imutável`);
  const existing = await getById(name, id);
  await pool.query(`DELETE FROM ${entity.table} WHERE id = $1`, [id]);
  return existing;
}
