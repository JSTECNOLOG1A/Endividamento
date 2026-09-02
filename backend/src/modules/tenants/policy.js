import { pool } from "../../db/pool.js";
import { getTenantScope, groupIdOrThrow, isPlatformAdmin, tenantIdOrNull } from "./access.js";

export const PLAN_LIMITS = {
  STARTER: { contracts: 10, users: 3 },
  PRO: { contracts: 50, users: 10 },
  ENTERPRISE: { contracts: Number.POSITIVE_INFINITY, users: Number.POSITIVE_INFINITY },
};

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function sameEmail(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

export function actorEmail() {
  return getTenantScope()?.email || null;
}

export function isSystemActor() {
  const email = actorEmail();
  return !email || email === "sistema";
}

export function tenantRole() {
  if (isPlatformAdmin()) return "PLATFORM";
  return getTenantScope()?.tenantRole || getTenantScope()?.role || null;
}

export function userRole() {
  if (isPlatformAdmin()) return "admin";
  return getTenantScope()?.role || null;
}

export function isOwner() {
  if (isPlatformAdmin()) return true;
  return tenantRole() === "OWNER";
}

export function isViewer() {
  if (isPlatformAdmin() || isSystemActor()) return false;
  return userRole() === "viewer" || tenantRole() === "VIEWER";
}

export function isTenantAdmin() {
  if (isPlatformAdmin() || isOwner()) return true;
  return userRole() === "admin";
}

export async function loadScopedTenant() {
  const tenantId = tenantIdOrNull();
  if (!tenantId) {
    if (isPlatformAdmin()) {
      throw httpError(400, "Selecione o cliente para esta operação.", "TENANT_CONTEXT_REQUIRED");
    }
    throw httpError(403, "Sessão sem tenant. Faça login novamente.", "TENANT_REQUIRED");
  }
  const result = await pool.query(
    `SELECT id, group_id, plan, billing_status, trial_ends_at, contract_limit, contracts_used
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (!result.rows[0]) throw httpError(404, "Cliente não encontrado", "TENANT_NOT_FOUND");
  return result.rows[0];
}

export function trialExpired(tenant) {
  if (!tenant) return false;
  if (tenant.billing_status === "active" || tenant.billing_status === "enterprise") return false;
  if (tenant.billing_status !== "trial") return false;
  if (!tenant.trial_ends_at) return false;
  const end = String(tenant.trial_ends_at).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return end < today;
}

export async function assertCanWrite() {
  if (isSystemActor()) return;
  if (isViewer()) {
    throw httpError(403, "Seu perfil é apenas de visualização.", "READ_ONLY");
  }
  if (isPlatformAdmin()) return;
  const tenant = await loadScopedTenant();
  if (tenant.billing_status === "suspended") {
    throw httpError(403, "Acesso suspenso. Entre em contato com o suporte.", "TENANT_SUSPENDED");
  }
  if (trialExpired(tenant)) {
    throw httpError(403, "O período de avaliação expirou. Faça upgrade do plano para continuar alterando dados.", "TRIAL_EXPIRED");
  }
}

export async function assertOwner(message = "Apenas o proprietário da empresa pode executar esta ação.") {
  await assertCanWrite();
  if (isSystemActor() || isOwner()) return;
  throw httpError(403, message, "OWNER_REQUIRED");
}

export async function assertOwnerCanManageBilling() {
  if (isViewer()) {
    throw httpError(403, "Seu perfil é apenas de visualização.", "READ_ONLY");
  }
  if (isSystemActor() || isOwner()) return;
  throw httpError(403, "Apenas o proprietário ou o master pode alterar o plano.", "OWNER_REQUIRED");
}

export async function assertTenantAdmin(message = "Apenas administradores podem executar esta ação.") {
  await assertCanWrite();
  if (isSystemActor() || isTenantAdmin()) return;
  throw httpError(403, message, "ADMIN_REQUIRED");
}

/** Manutenção destrutiva: só master, e somente no tenant explicitamente selecionado. */
export async function assertPlatformAdminWithTenant(
  message = "Apenas o master pode executar esta manutenção, com um cliente selecionado."
) {
  if (!isPlatformAdmin()) {
    throw httpError(403, message, "PLATFORM_FORBIDDEN");
  }
  groupIdOrThrow();
}

/** Parâmetros do tenant: OWNER, ADMIN (tenant_users), users.role=admin ou master. */
export async function assertParameterAdmin(
  message = "Apenas administradores podem alterar parâmetros do sistema."
) {
  await assertCanWrite();
  if (isSystemActor() || isPlatformAdmin() || isOwner()) return;
  if (userRole() === "admin") return;
  if (tenantRole() === "ADMIN") return;
  throw httpError(403, message, "ADMIN_REQUIRED");
}

function planCaps(tenant) {
  const fromPlan = PLAN_LIMITS[tenant.plan] || PLAN_LIMITS.STARTER;
  const contractLimit = Number(tenant.contract_limit);
  return {
    contracts: Number.isFinite(contractLimit) && contractLimit > 0
      ? Math.min(fromPlan.contracts, contractLimit)
      : fromPlan.contracts,
    users: fromPlan.users,
  };
}

export async function assertCanCreateContract() {
  await assertCanWrite();
  const tenant = await loadScopedTenant();
  const caps = planCaps(tenant);
  if (!Number.isFinite(caps.contracts)) return;
  const groupId = groupIdOrThrow();
  const count = await pool.query(
    `SELECT COUNT(*)::int AS n FROM loan_contracts
     WHERE group_id = $1 AND COALESCE(status, '') <> 'cancelado'`,
    [groupId]
  );
  if (count.rows[0].n >= caps.contracts) {
    throw httpError(
      409,
      `Limite de ${caps.contracts} contratos atingido no plano ${tenant.plan}.`,
      "PLAN_CONTRACT_LIMIT"
    );
  }
}

export async function bumpContractsUsed(delta) {
  const tenantId = tenantIdOrNull();
  if (!tenantId || !delta) return;
  await pool.query(
    `UPDATE tenants
     SET contracts_used = GREATEST(0, COALESCE(contracts_used, 0) + $2), updated_date = now()
     WHERE id = $1`,
    [tenantId, delta]
  );
}

export async function assertCanCreateUser() {
  await assertTenantAdmin();
  const tenant = await loadScopedTenant();
  const caps = planCaps(tenant);
  if (!Number.isFinite(caps.users)) return;
  const groupId = groupIdOrThrow();
  const count = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM tenant_users tu
     JOIN users u ON lower(u.email) = lower(tu.user_email)
     WHERE tu.group_id = $1 AND u.platform_admin IS NOT TRUE`,
    [groupId]
  );
  if (count.rows[0].n >= caps.users) {
    throw httpError(
      409,
      `Limite de ${caps.users} usuários atingido no plano ${tenant.plan}.`,
      "PLAN_USER_LIMIT"
    );
  }
}

export function assertCanApproveContract(contract) {
  if (isSystemActor()) return;
  if (isViewer() || !isTenantAdmin()) {
    throw httpError(403, "Apenas administradores podem aprovar contratos.", "ADMIN_REQUIRED");
  }
  const email = actorEmail();
  if (email && sameEmail(contract?.created_by, email)) {
    throw httpError(403, "Quem cadastrou o contrato não pode aprová-lo. Peça a outro administrador.", "SELF_APPROVAL");
  }
}

async function countTenantAdmins() {
  const groupId = groupIdOrThrow();
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users u
     JOIN tenant_users tu ON lower(tu.user_email) = lower(u.email)
     WHERE tu.group_id = $1
       AND u.role = 'admin'
       AND u.status = 'active'
       AND u.blocked IS NOT TRUE
       AND u.platform_admin IS NOT TRUE`,
    [groupId]
  );
  return result.rows[0]?.n || 0;
}

/**
 * OWNER or platform: reopens immediately.
 * ADMIN: first request is stored; a different admin confirms.
 */
export async function resolveContractReopen(contract) {
  if (isSystemActor() || isOwner()) {
    return { action: "reopen" };
  }
  if (!isTenantAdmin()) {
    throw httpError(403, "A reabertura exige o proprietário ou dois administradores.", "REOPEN_FORBIDDEN");
  }
  const email = actorEmail();
  const requestedBy = contract.reopen_requested_by;
  if (requestedBy && email && !sameEmail(requestedBy, email)) {
    return { action: "reopen" };
  }
  if (requestedBy && sameEmail(requestedBy, email)) {
    throw httpError(409, "A reabertura já foi pedida por você. Outro administrador precisa confirmar.", "REOPEN_CONFIRMATION_REQUIRED");
  }
  const admins = await countTenantAdmins();
  if (admins < 2) {
    throw httpError(403, "A reabertura exige o proprietário ou a confirmação de dois administradores.", "REOPEN_FORBIDDEN");
  }
  return { action: "request", requestedBy: email };
}
