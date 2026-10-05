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
    throw httpError(
      400,
      "Inicie uma sessão de suporte para acessar dados operacionais do cliente.",
      "SUPPORT_SESSION_REQUIRED"
    );
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
    supportSessionId: scope.supportSessionId || null,
    approvalLevel: Number(scope.approvalLevel || 0),
    permissions: scope.permissions && typeof scope.permissions === "object" ? scope.permissions : {},
  }, fn);
}

export async function loadUserById(userId, client = pool) {
  if (!userId) return null;
  const result = await client.query(
    `SELECT id, email, full_name, role, status, blocked, platform_admin, approval_level
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function loadTenantById(id, client = pool) {
  if (!id) return null;
  const result = await client.query(
    `SELECT id, group_id, tenant_name, domain, billing_status, lifecycle_status, owner_email, plan, trial_ends_at,
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

const TENANT_FOR_EMAIL_COLUMNS = `t.id, t.group_id, t.tenant_name, t.domain, t.billing_status, t.lifecycle_status, t.plan, t.trial_ends_at,
            t.onboarding_completed_at, tu.role AS tenant_role, tu.permissions AS module_permissions`;

export async function loadTenantForEmail(email, client = pool) {
  if (!email) return null;
  const result = await client.query(
    `SELECT ${TENANT_FOR_EMAIL_COLUMNS}
     FROM tenant_users tu
     JOIN tenants t ON t.id = tu.tenant_id
     WHERE lower(tu.user_email) = lower($1)
     ORDER BY CASE tu.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, tu.created_date ASC
     LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
}

// O tenant ESPECÍFICO que o token/sessão já escolheu (login com seleção, ou token antigo de usuário
// single-tenant emitido com o tenant_id certo) — confirma de novo que o vínculo ainda existe (pode ter
// sido removido depois do token emitido) em vez de confiar cegamente na claim. `attachTenant` usa isso
// primeiro; só recalcula pelo e-mail (loadTenantForEmail) se não houver tenant_id na sessão ou ele não
// bater mais com nenhum vínculo — assim quem escolheu um tenant continua nele requisição após requisição,
// em vez de a cada chamada recalcular do zero e sempre cair no mesmo (o mais antigo/de maior papel).
export async function loadTenantForEmailAndId(email, tenantId, client = pool) {
  if (!email || !tenantId) return null;
  const result = await client.query(
    `SELECT ${TENANT_FOR_EMAIL_COLUMNS}
     FROM tenant_users tu
     JOIN tenants t ON t.id = tu.tenant_id
     WHERE lower(tu.user_email) = lower($1) AND tu.tenant_id = $2
     LIMIT 1`,
    [email, tenantId]
  );
  return result.rows[0] || null;
}

// Todos os tenants desse e-mail (um consultor externo pode atender mais de um cliente da plataforma) —
// usado no login para saber se precisa perguntar qual tenant a pessoa quer, em vez de escolher sozinho.
export async function loadAllTenantsForEmail(email, client = pool) {
  if (!email) return [];
  const result = await client.query(
    `SELECT ${TENANT_FOR_EMAIL_COLUMNS}
     FROM tenant_users tu
     JOIN tenants t ON t.id = tu.tenant_id
     WHERE lower(tu.user_email) = lower($1)
     ORDER BY tu.created_date ASC`,
    [email]
  );
  return result.rows;
}

export function isTenantBlocked(tenant) {
  if (!tenant) return false;
  const lifecycle = tenant.lifecycle_status || (tenant.billing_status === "suspended" ? "SUSPENDED" : "ACTIVE");
  return ["SUSPENDED", "DISABLED", "CANCELLED"].includes(lifecycle) || tenant.billing_status === "suspended";
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
