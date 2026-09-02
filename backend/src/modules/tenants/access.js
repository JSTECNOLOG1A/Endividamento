import { AsyncLocalStorage } from "node:async_hooks";
import { pool } from "../../db/pool.js";

export const tenantContext = new AsyncLocalStorage();

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export function getTenantScope() {
  return tenantContext.getStore() || null;
}

export function isPlatformAdmin() {
  return Boolean(getTenantScope()?.platformAdmin);
}

export function groupIdOrNull() {
  return getTenantScope()?.groupId || null;
}

export function groupIdOrThrow() {
  const groupId = groupIdOrNull();
  if (groupId) return groupId;
  if (isPlatformAdmin()) {
    throw httpError(400, "Selecione o cliente para esta operação.", "TENANT_CONTEXT_REQUIRED");
  }
  throw httpError(403, "Sessão sem tenant. Faça login novamente.", "TENANT_REQUIRED");
}

export function tenantIdOrNull() {
  return getTenantScope()?.tenantId || null;
}

export function runWithTenant(scope, fn) {
  return tenantContext.run({
    userId: scope.userId || null,
    groupId: scope.groupId || null,
    tenantId: scope.tenantId || null,
    email: scope.email || null,
    fullName: scope.fullName || null,
    role: scope.role || null,
    tenantRole: scope.tenantRole || null,
    platformAdmin: Boolean(scope.platformAdmin),
  }, fn);
}

export async function loadUserById(userId, client = pool) {
  if (!userId) return null;
  const result = await client.query(
    `SELECT id, email, full_name, role, status, blocked, platform_admin
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function loadTenantById(id, client = pool) {
  if (!id) return null;
  const result = await client.query(
    `SELECT id, group_id, tenant_name, domain, billing_status, owner_email, plan, trial_ends_at,
            onboarding_completed_at
     FROM tenants WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Filtro SQL por tenant.
 * Master sem cliente selecionado NÃO vê dados de cliente (P0-14),
 * salvo `allowUnscopedMaster` em rotas realmente globais da plataforma.
 */
export function scopedGroupSql(column, startIndex = 1, { allowUnscopedMaster = false } = {}) {
  const scope = getTenantScope();
  if (allowUnscopedMaster && scope?.platformAdmin && !scope.groupId) {
    return { sql: "TRUE", params: [] };
  }
  return { sql: `${column} = $${startIndex}`, params: [groupIdOrThrow()] };
}

export async function loadTenantForEmail(email, client = pool) {
  if (!email) return null;
  const result = await client.query(
    `SELECT t.id, t.group_id, t.tenant_name, t.domain, t.billing_status, t.plan, t.trial_ends_at,
            t.onboarding_completed_at, tu.role AS tenant_role
     FROM tenant_users tu
     JOIN tenants t ON t.id = tu.tenant_id
     WHERE lower(tu.user_email) = lower($1)
     ORDER BY CASE tu.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, tu.created_date ASC
     LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
}

export async function loadTenantByGroupId(groupId, client = pool) {
  if (!groupId) return null;
  const result = await client.query(
    `SELECT id, group_id, tenant_name, domain, billing_status
     FROM tenants WHERE group_id = $1
     ORDER BY created_date ASC
     LIMIT 1`,
    [groupId]
  );
  return result.rows[0] || null;
}

export function publicTenant(row) {
  if (!row) return null;
  return {
    tenant_id: row.id || row.tenant_id || null,
    group_id: row.group_id || null,
    tenant_name: row.tenant_name || null,
    tenant_domain: row.domain || row.tenant_domain || null,
    tenant_role: row.tenant_role || null,
    billing_status: row.billing_status || null,
    plan: row.plan || null,
    trial_ends_at: row.trial_ends_at || null,
    onboarding_completed_at: row.onboarding_completed_at || null,
  };
}
