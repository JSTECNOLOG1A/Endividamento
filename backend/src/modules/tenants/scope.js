import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { getTenantScope, groupIdOrThrow, isPlatformAdmin } from "./access.js";

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/** Tabelas tenant-owned permitidas em SQL raw (allowlist contra injeção). */
export const TENANT_TABLES = {
  loan_contracts: { notFound: "Contrato não encontrado" },
  payable_titles: { notFound: "Título não encontrado" },
  receivable_titles: { notFound: "Título não encontrado" },
  account_movements: { notFound: "Lançamento não encontrado" },
  company_entities: { notFound: "Entidade não encontrada" },
  notification_log: { notFound: "Notificação não encontrada" },
  calculation_snapshots: { notFound: "Snapshot não encontrado" },
  accounting_closings: { notFound: "Fechamento não encontrado" },
  contract_settlements: { notFound: "Baixa não encontrada" },
  accounting_event_mappings: { notFound: "Mapeamento não encontrado" },
  accounting_journal_entries: { notFound: "Lançamento contábil não encontrado" },
  natures: { notFound: "Natureza não encontrada" },
  bank_accounts: { notFound: "Conta bancária não encontrada" },
  chart_of_accounts: { notFound: "Conta contábil não encontrada" },
  tenants: { notFound: "Cliente não encontrado" },
  tenant_users: { notFound: "Vínculo não encontrado" },
};

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
  AccountMovement: { type: "column" },
  NotificationLog: { type: "column" },
  Bank: { type: "shared" },
  Currency: { type: "shared" },
  Holiday: { type: "shared" },
  CDIRate: { type: "shared" },
};

export const CREATE_BLOCKED = new Set(["Tenant", "TenantUser", "Group"]);
export const WRITE_BLOCKED = new Set(["Tenant", "TenantUser"]);

export function requireTenantContext() {
  return groupIdOrThrow();
}

export function logIsolationMiss({ table, id } = {}) {
  const scope = getTenantScope();
  logger.warn({
    code: "TENANT_ISOLATION",
    table: table || null,
    resourceId: id || null,
    actor: scope?.email || null,
    groupId: scope?.groupId || null,
  }, "recurso ausente no tenant autenticado");
}

function assertSafeTable(table) {
  if (!TENANT_TABLES[table]) {
    throw httpError(500, `Tabela não permitida no escopo de tenant: ${table}`, "TENANT_TABLE");
  }
}

export function tenantClause(name, { alias = "", startIndex = 1 } = {}) {
  const spec = ENTITY_SCOPE[name];
  if (!spec) {
    throw httpError(500, `Escopo de tenant ausente para ${name}`, "TENANT_SCOPE");
  }
  const col = alias ? `${alias}.` : "";
  const masterUnscoped = isPlatformAdmin() && !getTenantScope()?.groupId;
  if (masterUnscoped && spec.type === "shared") {
    return { sql: "TRUE", params: [], groupId: null, unscoped: true };
  }
  const groupId = requireTenantContext();
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
  const groupId = requireTenantContext();
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

export async function selectResourceForTenant(table, id, client = pool) {
  assertSafeTable(table);
  const groupId = requireTenantContext();
  const result = await client.query(
    `SELECT * FROM ${table} WHERE id = $1 AND group_id = $2`,
    [id, groupId]
  );
  if (!result.rows[0]) {
    logIsolationMiss({ table, id });
    throw httpError(404, TENANT_TABLES[table].notFound, "NOT_FOUND");
  }
  return result.rows[0];
}

export async function assertResourceInTenant(table, id, client = pool) {
  return selectResourceForTenant(table, id, client);
}

export async function assertContractInTenant(contractId, client = pool) {
  return selectResourceForTenant("loan_contracts", contractId, client);
}

export async function assertEntityInTenant(entityId, client = pool) {
  return selectResourceForTenant("company_entities", entityId, client);
}

export async function assertIdsBelongToTenant(table, ids, client = pool) {
  assertSafeTable(table);
  const groupId = requireTenantContext();
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!unique.length) return [];
  const result = await client.query(
    `SELECT * FROM ${table} WHERE id = ANY($1::text[]) AND group_id = $2`,
    [unique, groupId]
  );
  if (result.rows.length !== unique.length) {
    logIsolationMiss({ table, id: unique.join(",") });
    throw httpError(404, TENANT_TABLES[table].notFound, "NOT_FOUND");
  }
  return result.rows;
}

export async function selectByIds(table, ids, { order = "", client = pool } = {}) {
  assertSafeTable(table);
  const groupId = requireTenantContext();
  if (!ids?.length) return [];
  const result = await client.query(
    `SELECT * FROM ${table}
     WHERE id = ANY($1::text[]) AND group_id = $2
     ${order}`,
    [ids, groupId]
  );
  return result.rows;
}

export async function selectEntitiesByIds(ids) {
  return selectByIds("company_entities", ids);
}

export function titlesWhere(alias = "") {
  const groupId = requireTenantContext();
  const col = alias ? `${alias}.` : "";
  return { sql: `${col}group_id = $GROUP`, groupId };
}
