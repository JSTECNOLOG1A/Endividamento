import { pool } from "../../db/pool.js";
import { getTenantScope, groupIdOrThrow, isPlatformAdmin } from "./access.js";

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/** Direct group_id column, possibly nullable for shared catalogs. */
export const ENTITY_SCOPE = {
  Group: { type: "id" },
  CompanyEntity: { type: "column" },
  LoanContract: { type: "column" },
  Tenant: { type: "column" },
  TenantUser: { type: "column" },
  ChartOfAccount: { type: "column" },
  Nature: { type: "column" },
  BankAccount: { type: "column" },
  PayableTitle: { type: "column" },
  ReceivableTitle: { type: "column" },
  CalculationSnapshot: { type: "column" },
  AccountingClosing: { type: "column" },
  ContractSettlement: { type: "column" },
  AccountingEventMapping: { type: "column" },
  AccountingJournalEntry: { type: "column" },
  Bank: { type: "shared" },
  Currency: { type: "shared" },
  Holiday: { type: "shared" },
  CDIRate: { type: "shared" },
};

export const CREATE_BLOCKED = new Set(["Tenant", "TenantUser", "Group"]);
export const WRITE_BLOCKED = new Set(["Tenant", "TenantUser"]);

export function tenantClause(name, { alias = "", startIndex = 1 } = {}) {
  const spec = ENTITY_SCOPE[name];
  if (!spec) {
    throw httpError(500, `Escopo de tenant ausente para ${name}`, "TENANT_SCOPE");
  }
  const col = alias ? `${alias}.` : "";
  const unscoped = isPlatformAdmin() && !getTenantScope()?.groupId;
  if (unscoped) {
    return { sql: "TRUE", params: [], groupId: null, unscoped: true };
  }
  const groupId = groupIdOrThrow();
  if (spec.type === "id") {
    return { sql: `${col}id = $${startIndex}`, params: [groupId], groupId };
  }
  if (spec.type === "shared") {
    return {
      sql: `(${col}group_id IS NULL OR ${col}group_id = $${startIndex})`,
      params: [groupId],
      groupId,
    };
  }
  return { sql: `${col}group_id = $${startIndex}`, params: [groupId], groupId };
}

export function combineWhere(existingSql, extraSql) {
  if (existingSql && extraSql) {
    const stripped = existingSql.replace(/^\s*WHERE\s+/i, "");
    return `WHERE (${stripped}) AND (${extraSql})`;
  }
  if (existingSql) return existingSql;
  if (extraSql) return `WHERE ${extraSql}`;
  return "";
}

export function stampGroupId(row, { shared = false } = {}) {
  const groupId = groupIdOrThrow();
  if (shared) {
    if (row.group_id === undefined || row.group_id === null || row.group_id === "") {
      row.group_id = groupId;
    } else if (row.group_id !== groupId) {
      throw httpError(403, "Não é permitido gravar dados de outro cliente", "TENANT_FORBIDDEN");
    }
    return groupId;
  }
  row.group_id = groupId;
  return groupId;
}

export async function assertContractInTenant(contractId, client = pool) {
  const groupId = groupIdOrThrow();
  const result = await client.query(
    `SELECT id, group_id FROM loan_contracts WHERE id = $1 AND group_id = $2`,
    [contractId, groupId]
  );
  if (!result.rows[0]) throw httpError(404, "Contrato não encontrado");
  return result.rows[0];
}

export async function assertEntityInTenant(entityId, client = pool) {
  const groupId = groupIdOrThrow();
  const result = await client.query(
    `SELECT * FROM company_entities WHERE id = $1 AND group_id = $2`,
    [entityId, groupId]
  );
  if (!result.rows[0]) throw httpError(404, "Entidade não encontrada");
  return result.rows[0];
}

export async function selectByIds(table, ids, { order = "" } = {}) {
  const groupId = groupIdOrThrow();
  if (!ids?.length) return [];
  const result = await pool.query(
    `SELECT * FROM ${table}
     WHERE id = ANY($1::text[]) AND group_id = $2
     ${order}`,
    [ids, groupId]
  );
  return result.rows;
}

export async function selectEntitiesByIds(ids) {
  const groupId = groupIdOrThrow();
  if (!ids?.length) return [];
  const result = await pool.query(
    `SELECT * FROM company_entities WHERE id = ANY($1::text[]) AND group_id = $2`,
    [ids, groupId]
  );
  return result.rows;
}

export function titlesWhere(alias = "") {
  const groupId = groupIdOrThrow();
  const col = alias ? `${alias}.` : "";
  return { sql: `${col}group_id = $GROUP`, groupId };
}
