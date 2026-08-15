import { randomUUID } from "node:crypto";
import { db, nowIso } from "./db.js";

const SYSTEM_FIELDS = new Set(["id", "created_date", "updated_date", "created_by", "extra_json"]);

export const ENTITIES = {
  Group: {
    table: "groups",
    columns: ["group_name", "cnpj_group", "description", "status"],
    booleans: [],
    numbers: [],
  },
  CompanyEntity: {
    table: "company_entities",
    columns: ["group_id", "entity_name", "document_number", "document_type", "entity_type", "codigo_empresa", "codigo_filial", "status"],
    booleans: [],
    numbers: [],
  },
  Bank: {
    table: "banks",
    columns: ["bank_code", "bank_name", "bank_type", "status"],
    booleans: [],
    numbers: [],
  },
  LoanContract: {
    table: "loan_contracts",
    columns: [
      "group_id", "entity_id", "bank_id", "contract_number", "operation_category", "operation_type",
      "operation_value", "amount_foreign", "exchange_rate_closing", "signal_value", "iof_value",
      "iof_financed", "other_fees", "other_fees_financed", "mip_value", "mip_embedded", "dfi_value",
      "dfi_embedded", "other_insurance_value", "other_insurance_embedded", "fixed_rate", "indexer",
      "indexer_spread", "currency_id", "exchange_lag", "exchange_rates", "operation_date",
      "first_payment_date", "total_term_months", "final_maturity_date", "principal_grace_months",
      "interest_grace_months", "grace_action", "grace_interest_behavior", "amortization_trigger",
      "principal_installments", "interest_installments", "principal_frequency", "interest_frequency",
      "calculation_system", "amortization_percentages", "percentage_base", "schedule_data",
      "contract_pdf_url", "status", "status_history", "approved_by", "approved_date",
      "rejection_comments", "exported_to_payables", "current_snapshot_id", "approved_snapshot_id",
      "last_recalculated_at",
    ],
    booleans: [
      "iof_financed", "other_fees_financed", "mip_embedded", "dfi_embedded",
      "other_insurance_embedded", "exported_to_payables",
    ],
    numbers: [
      "operation_value", "amount_foreign", "exchange_rate_closing", "signal_value", "iof_value",
      "other_fees", "mip_value", "dfi_value", "other_insurance_value", "fixed_rate", "indexer_spread",
      "exchange_lag", "total_term_months", "principal_grace_months", "interest_grace_months",
      "principal_installments", "interest_installments",
    ],
  },
  CalculationSnapshot: {
    table: "calculation_snapshots",
    columns: [
      "contract_id", "contract_number", "engine_version", "engine_build_id",
      "calculation_hash_strict", "calculation_hash_instance", "schedule_snapshot",
      "disclosure_snapshot", "risk_flags_snapshot", "audit_log_snapshot", "currency",
      "principal", "total_interest", "total_paid", "trigger_event", "calculation_parameters",
      "metadata", "immutable_flag",
    ],
    booleans: ["immutable_flag"],
    numbers: ["principal", "total_interest", "total_paid"],
  },
  CDIRate: {
    table: "cdi_rates",
    columns: ["rate_date", "annual_rate", "daily_factor", "rate_type"],
    booleans: [],
    numbers: ["annual_rate", "daily_factor"],
  },
  Holiday: {
    table: "holidays",
    columns: ["holiday_date", "holiday_name", "day_of_week"],
    booleans: [],
    numbers: [],
  },
  Currency: {
    table: "currencies",
    columns: ["currency_code", "currency_name", "exchange_rate", "rate_date", "status"],
    booleans: [],
    numbers: ["exchange_rate"],
  },
  Tenant: {
    table: "tenants",
    columns: [
      "group_id", "tenant_name", "plan", "billing_status", "trial_ends_at",
      "contract_limit", "contracts_used", "owner_email", "metadata",
    ],
    booleans: [],
    numbers: ["contract_limit", "contracts_used"],
  },
  TenantUser: {
    table: "tenant_users",
    columns: [
      "tenant_id", "group_id", "user_email", "role", "permissions", "invited_by", "joined_at",
    ],
    booleans: [],
    numbers: [],
  },
};

function getEntity(name) {
  const entity = ENTITIES[name];
  if (!entity) {
    const err = new Error(`Entidade desconhecida: ${name}`);
    err.status = 404;
    throw err;
  }
  return entity;
}

function allowedColumns(entity) {
  return new Set([
    "id",
    "created_date",
    "updated_date",
    "created_by",
    "extra_json",
    ...entity.columns,
  ]);
}

function toDbValue(entity, key, value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (entity.booleans.includes(key)) return value ? 1 : 0;
  if (entity.numbers.includes(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function fromDbValue(entity, key, value) {
  if (value === null || value === undefined) return value;
  if (entity.booleans.includes(key)) return Boolean(value);
  return value;
}

function splitPayload(entity, data = {}) {
  const known = allowedColumns(entity);
  const row = {};
  const extra = {};
  for (const [key, value] of Object.entries(data)) {
    if (SYSTEM_FIELDS.has(key) && key !== "created_by") continue;
    if (known.has(key)) row[key] = toDbValue(entity, key, value);
    else extra[key] = value;
  }
  if (Object.keys(extra).length > 0) {
    row.extra_json = JSON.stringify(extra);
  }
  return row;
}

function rowToObject(entity, row) {
  if (!row) return null;
  const obj = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "extra_json") {
      if (value) {
        try {
          Object.assign(obj, JSON.parse(value));
        } catch {
          obj.extra_json = value;
        }
      }
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

  for (const [key, value] of Object.entries(query || {})) {
    if (!allowed.has(key)) continue;
    if (value && typeof value === "object" && Array.isArray(value.$in)) {
      if (value.$in.length === 0) {
        where.push("1 = 0");
        continue;
      }
      where.push(`${key} IN (${value.$in.map(() => "?").join(", ")})`);
      params.push(...value.$in);
    } else {
      where.push(`${key} = ?`);
      params.push(toDbValue(entity, key, value));
    }
  }

  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export function list(name, sort, limit = 100) {
  const entity = getEntity(name);
  const { column, dir } = parseSort(entity, sort);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 20000);
  const rows = db.prepare(
    `SELECT * FROM ${entity.table} ORDER BY ${column} ${dir} LIMIT ?`
  ).all(safeLimit);
  return rows.map((row) => rowToObject(entity, row));
}

export function filter(name, query, sort, limit = 100) {
  const entity = getEntity(name);
  const { column, dir } = parseSort(entity, sort);
  const { sql, params } = buildFilter(entity, query);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 20000);
  const rows = db.prepare(
    `SELECT * FROM ${entity.table} ${sql} ORDER BY ${column} ${dir} LIMIT ?`
  ).all(...params, safeLimit);
  return rows.map((row) => rowToObject(entity, row));
}

export function getById(name, id) {
  const entity = getEntity(name);
  const row = db.prepare(`SELECT * FROM ${entity.table} WHERE id = ?`).get(id);
  if (!row) {
    const err = new Error(`${name} não encontrado`);
    err.status = 404;
    throw err;
  }
  return rowToObject(entity, row);
}

export function create(name, data, createdBy = "admin@local") {
  const entity = getEntity(name);
  const now = nowIso();
  const row = splitPayload(entity, data);
  row.id = randomUUID();
  row.created_date = now;
  row.updated_date = now;
  row.created_by = data?.created_by || createdBy;

  const keys = Object.keys(row);
  const stmt = db.prepare(
    `INSERT INTO ${entity.table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`
  );
  stmt.run(...keys.map((key) => row[key]));
  return getById(name, row.id);
}

export function bulkCreate(name, items = [], createdBy = "admin@local") {
  const tx = db.transaction((records) => records.map((item) => create(name, item, createdBy)));
  return tx(items);
}

export function update(name, id, data) {
  const entity = getEntity(name);
  getById(name, id);
  const row = splitPayload(entity, data);
  row.updated_date = nowIso();
  const keys = Object.keys(row);
  if (keys.length === 1 && keys[0] === "updated_date") return getById(name, id);
  const assignments = keys.map((key) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE ${entity.table} SET ${assignments} WHERE id = ?`).run(
    ...keys.map((key) => row[key]),
    id
  );
  return getById(name, id);
}

export function remove(name, id) {
  const entity = getEntity(name);
  const existing = getById(name, id);
  db.prepare(`DELETE FROM ${entity.table} WHERE id = ?`).run(id);
  return existing;
}

export const LOCAL_USER = {
  id: "user_local_admin",
  email: "admin@local",
  full_name: "Administrador Local",
  role: "admin",
};
