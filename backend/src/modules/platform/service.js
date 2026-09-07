import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../db/pool.js";
import { writeAudit } from "../../middleware/audit.js";
import { config } from "../../config.js";

function httpError(status, message, code, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details) err.details = details;
  return err;
}

export const LIFECYCLE = [
  "PENDING", "TRIAL", "ACTIVE", "SUSPENDED", "DISABLED", "CANCELLED", "DELINQUENT",
];
export const PLANS = ["STARTER", "PRO", "ENTERPRISE"];
export const SUSPENSION_REASONS = [
  "INADIMPLENCIA", "SOLICITACAO_CLIENTE", "SEGURANCA",
  "VIOLACAO_CONTRATUAL", "MANUTENCAO_ADMINISTRATIVA", "OUTRO",
];
export const SUPPORT_DURATIONS = [15, 30, 60];

const BILLING_FROM_LIFECYCLE = {
  PENDING: "pending",
  TRIAL: "trial",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DISABLED: "disabled",
  CANCELLED: "cancelled",
  DELINQUENT: "delinquent",
};

function newIds(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export async function writeAccessLog({
  req,
  action,
  tenant = null,
  purpose = "administracao_plataforma",
  supportSessionId = null,
  metadata = null,
} = {}) {
  await pool.query(
    `INSERT INTO platform_access_log (
       request_id, actor_id, actor_email, actor_name, action,
       tenant_id, group_id, tenant_name, method, path, ip_address, user_agent,
       purpose, support_session_id, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      req?.requestId || null,
      req?.user?.sub || null,
      req?.user?.email || "",
      req?.user?.full_name || null,
      action,
      tenant?.id || tenant?.tenant_id || null,
      tenant?.group_id || null,
      tenant?.tenant_name || null,
      req?.method || null,
      req?.originalUrl || req?.path || null,
      req?.ip || null,
      req?.headers?.["user-agent"] || null,
      purpose,
      supportSessionId || req?.supportSession?.id || null,
      metadata,
    ]
  );
}

function mapTenantRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    group_id: row.group_id,
    tenant_name: row.tenant_name,
    legal_name: row.legal_name || row.tenant_name,
    trade_name: row.trade_name || null,
    document: row.document || row.cnpj_group || null,
    domain: row.domain || null,
    plan: row.plan,
    billing_status: row.billing_status,
    lifecycle_status: row.lifecycle_status || "ACTIVE",
    billing_period: row.billing_period || "monthly",
    owner_email: row.owner_email,
    admin_email: row.admin_email || row.owner_email,
    phone: row.phone || null,
    responsible_name: row.responsible_name || null,
    trial_ends_at: row.trial_ends_at,
    contract_limit: row.contract_limit,
    contracts_used: row.contracts_used,
    user_limit: row.user_limit,
    users_count: row.users_count ?? null,
    group_name: row.group_name || null,
    cnpj: row.document || row.cnpj_group || null,
    onboarding_completed_at: row.onboarding_completed_at || null,
    created_date: row.created_date || null,
    last_activity_at: row.last_activity_at || null,
    suspended_at: row.suspended_at || null,
    suspension_reason: row.suspension_reason || null,
    suspension_detail: row.suspension_detail || null,
    reactivated_at: row.reactivated_at || null,
    cancelled_at: row.cancelled_at || null,
    disabled_at: row.disabled_at || null,
  };
}

const TENANT_SELECT = `
  t.id, t.group_id, t.tenant_name, t.legal_name, t.trade_name, t.document,
  t.domain, t.plan, t.billing_status, t.lifecycle_status, t.billing_period,
  t.owner_email, t.admin_email, t.phone, t.responsible_name,
  t.trial_ends_at, t.contract_limit, t.contracts_used, t.user_limit,
  t.onboarding_completed_at, t.created_date, t.last_activity_at,
  t.suspended_at, t.suspension_reason, t.suspension_detail,
  t.reactivated_at, t.cancelled_at, t.disabled_at,
  g.group_name, g.cnpj_group,
  (SELECT COUNT(*)::int FROM tenant_users tu WHERE tu.tenant_id = t.id) AS users_count
`;

export async function listTenants({ status, plan, q } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    params.push(String(status).toUpperCase());
    clauses.push(`t.lifecycle_status = $${params.length}`);
  }
  if (plan) {
    params.push(String(plan).toUpperCase());
    clauses.push(`t.plan = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    clauses.push(`(
      lower(t.tenant_name) LIKE $${params.length}
      OR lower(COALESCE(t.legal_name,'')) LIKE $${params.length}
      OR lower(COALESCE(t.document,'')) LIKE $${params.length}
      OR lower(COALESCE(t.domain,'')) LIKE $${params.length}
      OR lower(COALESCE(t.owner_email,'')) LIKE $${params.length}
    )`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT ${TENANT_SELECT}
     FROM tenants t
     JOIN groups g ON g.id = t.group_id
     ${where}
     ORDER BY t.tenant_name ASC, t.created_date ASC`,
    params
  );
  return result.rows.map(mapTenantRow);
}

export async function getTenant(id) {
  const result = await pool.query(
    `SELECT ${TENANT_SELECT}
     FROM tenants t
     JOIN groups g ON g.id = t.group_id
     WHERE t.id = $1`,
    [id]
  );
  if (!result.rows[0]) throw httpError(404, "Cliente não encontrado", "TENANT_NOT_FOUND");
  return mapTenantRow(result.rows[0]);
}

export async function getOverview() {
  const stats = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE lifecycle_status = 'ACTIVE')::int AS active,
       COUNT(*) FILTER (WHERE lifecycle_status = 'TRIAL')::int AS trial,
       COUNT(*) FILTER (WHERE lifecycle_status = 'SUSPENDED')::int AS suspended,
       COUNT(*) FILTER (WHERE lifecycle_status = 'DELINQUENT')::int AS delinquent,
       COUNT(*) FILTER (WHERE lifecycle_status = 'CANCELLED')::int AS cancelled,
       COUNT(*) FILTER (WHERE lifecycle_status = 'DISABLED')::int AS disabled,
       COUNT(*) FILTER (WHERE created_date >= now() - interval '30 days')::int AS new_30d
     FROM tenants`
  );
  const users = await pool.query(
    `SELECT COUNT(*)::int AS active_users
     FROM users
     WHERE status = 'active' AND blocked IS NOT TRUE AND platform_admin IS NOT TRUE`
  );
  const byPlan = await pool.query(
    `SELECT plan, COUNT(*)::int AS n FROM tenants GROUP BY plan ORDER BY plan`
  );
  const recent = await pool.query(
    `SELECT id, created_date, actor_email, action, tenant_name, purpose
     FROM platform_access_log
     ORDER BY created_date DESC
     LIMIT 15`
  );
  const contractsAgg = await pool.query(
    `SELECT t.id, t.tenant_name, t.contracts_used
     FROM tenants t
     ORDER BY t.contracts_used DESC NULLS LAST
     LIMIT 10`
  );
  const s = stats.rows[0];
  return {
    totals: {
      tenants: s.total,
      active: s.active,
      trial: s.trial,
      suspended: s.suspended,
      delinquent: s.delinquent,
      cancelled: s.cancelled,
      disabled: s.disabled,
      new_30d: s.new_30d,
      active_users: users.rows[0].active_users,
    },
    // MRR/ARR/Churn: placeholders até gateway de billing
    commercial: {
      mrr: null,
      arr: null,
      churn: null,
      note: "Métricas financeiras de assinatura aguardam integração de gateway.",
    },
    by_plan: byPlan.rows.map((r) => ({ plan: r.plan, count: r.n })),
    usage_top: contractsAgg.rows.map((r) => ({
      tenant_id: r.id,
      tenant_name: r.tenant_name,
      contracts_used: r.contracts_used || 0,
    })),
    recent_events: recent.rows,
  };
}

export async function createTenant(req, body) {
  const legalName = String(body.legal_name || body.tenant_name || "").trim();
  const tradeName = String(body.trade_name || "").trim() || null;
  const document = digitsOnly(body.document || body.cnpj);
  const adminEmail = String(body.admin_email || body.owner_email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim() || null;
  const responsible = String(body.responsible_name || "").trim() || null;
  const plan = String(body.plan || "STARTER").toUpperCase();
  const billingPeriod = body.billing_period === "yearly" ? "yearly" : "monthly";
  const userLimit = body.user_limit != null ? Number(body.user_limit) : null;
  const startTrial = body.trial === true || body.lifecycle_status === "TRIAL";
  const trialDays = Math.min(Math.max(Number(body.trial_days) || 14, 1), 90);
  const domainRaw = String(body.domain || "").trim().toLowerCase() || null;

  if (!legalName) throw httpError(400, "Informe a razão social", "VALIDATION");
  if (!adminEmail || !adminEmail.includes("@")) throw httpError(400, "E-mail administrativo inválido", "VALIDATION");
  if (!PLANS.includes(plan)) throw httpError(400, "Plano inválido", "VALIDATION");
  if (document && document.length !== 14) throw httpError(400, "CNPJ inválido", "VALIDATION");

  const groupId = newIds("grp");
  const tenantId = newIds("tnt");
  const lifecycle = startTrial ? "TRIAL" : (LIFECYCLE.includes(body.lifecycle_status) ? body.lifecycle_status : "ACTIVE");
  const billing = BILLING_FROM_LIFECYCLE[lifecycle] || "active";
  const trialEnds = startTrial ? new Date(Date.now() + trialDays * 86400000) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO groups (id, group_name, cnpj_group, status, created_by)
       VALUES ($1,$2,$3,'ativo',$4)`,
      [groupId, tradeName || legalName, document || null, req.user.email]
    );
    await client.query(
      `INSERT INTO tenants (
         id, group_id, tenant_name, legal_name, trade_name, document, domain,
         plan, billing_status, lifecycle_status, billing_period,
         owner_email, admin_email, phone, responsible_name,
         trial_ends_at, user_limit, contract_limit, contracts_used,
         onboarding_completed_at, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,
         $12,$12,$13,$14,
         $15,$16,$17,0,
         now(),$18
       )`,
      [
        tenantId, groupId, tradeName || legalName, legalName, tradeName, document || null, domainRaw,
        plan, billing, lifecycle, billingPeriod,
        adminEmail, phone, responsible,
        trialEnds, userLimit, plan === "STARTER" ? 10 : plan === "PRO" ? 50 : null,
        req.user.email,
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") throw httpError(409, "Domínio ou identificador já existente", "CONFLICT");
    throw error;
  } finally {
    client.release();
  }

  const tenant = await getTenant(tenantId);
  await writeAccessLog({
    req,
    action: "TENANT_CREATED",
    tenant,
    purpose: "administracao_plataforma",
    metadata: { plan, lifecycle_status: lifecycle },
  });
  await writeAudit({
    req,
    action: "TENANT_CREATED",
    resourceType: "Tenant",
    resourceId: tenantId,
    rotina: "Plataforma",
    registro: tenant.tenant_name,
    after: { id: tenantId, plan, lifecycle_status: lifecycle },
  });
  return tenant;
}

export async function updateTenant(req, id, body) {
  const current = await getTenant(id);
  const fields = [];
  const params = [id];
  const map = {
    tenant_name: "tenant_name",
    legal_name: "legal_name",
    trade_name: "trade_name",
    document: "document",
    domain: "domain",
    admin_email: "admin_email",
    phone: "phone",
    responsible_name: "responsible_name",
    billing_period: "billing_period",
    user_limit: "user_limit",
  };
  const after = {};
  for (const [key, column] of Object.entries(map)) {
    if (body[key] === undefined) continue;
    let value = body[key];
    if (key === "document") value = digitsOnly(value) || null;
    if (key === "admin_email") value = String(value || "").trim().toLowerCase() || null;
    if (key === "domain") value = String(value || "").trim().toLowerCase() || null;
    if (key === "billing_period" && value && !["monthly", "yearly"].includes(value)) {
      throw httpError(400, "Periodicidade inválida", "VALIDATION");
    }
    params.push(value);
    fields.push(`${column} = $${params.length}`);
    after[key] = value;
  }
  if (!fields.length) return current;
  params.push(req.user.email);
  await pool.query(
    `UPDATE tenants SET ${fields.join(", ")}, updated_date = now(), created_by = COALESCE(created_by, $${params.length})
     WHERE id = $1`,
    params
  );
  const tenant = await getTenant(id);
  await writeAccessLog({ req, action: "TENANT_UPDATED", tenant, metadata: after });
  await writeAudit({
    req,
    action: "TENANT_UPDATED",
    resourceType: "Tenant",
    resourceId: id,
    rotina: "Plataforma",
    registro: tenant.tenant_name,
    before: current,
    after: tenant,
  });
  return tenant;
}

export async function updateTenantPlan(req, id, { plan, billing_status }) {
  if (!PLANS.includes(plan)) throw httpError(400, "Plano inválido", "VALIDATION");
  const before = await getTenant(id);
  let lifecycle = before.lifecycle_status;
  let billing = billing_status || before.billing_status;
  if (billing_status === "trial") lifecycle = "TRIAL";
  if (billing_status === "active") lifecycle = "ACTIVE";
  if (billing_status === "suspended") lifecycle = "SUSPENDED";
  const result = await pool.query(
    `UPDATE tenants
     SET plan = $2, billing_status = $3, lifecycle_status = $4, updated_date = now()
     WHERE id = $1
     RETURNING id, tenant_name, plan, billing_status, lifecycle_status, group_id`,
    [id, plan, billing, lifecycle]
  );
  if (!result.rows[0]) throw httpError(404, "Cliente não encontrado", "TENANT_NOT_FOUND");
  const saved = result.rows[0];
  await writeAccessLog({
    req,
    action: "TENANT_PLAN_CHANGED",
    tenant: saved,
    metadata: { from: before.plan, to: plan },
  });
  await writeAudit({
    req,
    action: "TENANT_PLAN_CHANGED",
    resourceType: "Tenant",
    resourceId: id,
    rotina: "Plataforma",
    registro: saved.tenant_name,
    before: { plan: before.plan },
    after: { plan },
  });
  return getTenant(id);
}

export async function suspendTenant(req, id, { reason, detail }) {
  if (!SUSPENSION_REASONS.includes(reason)) {
    throw httpError(400, "Motivo de suspensão inválido", "VALIDATION");
  }
  if (reason === "OUTRO" && !String(detail || "").trim()) {
    throw httpError(400, "Descreva o motivo da suspensão", "VALIDATION");
  }
  const before = await getTenant(id);
  if (before.lifecycle_status === "CANCELLED") {
    throw httpError(400, "Tenant cancelado não pode ser suspenso", "INVALID_STATE");
  }
  await pool.query(
    `UPDATE tenants SET
       lifecycle_status = 'SUSPENDED',
       billing_status = 'suspended',
       suspended_at = now(),
       suspended_by = $2,
       suspension_reason = $3,
       suspension_detail = $4,
       updated_date = now()
     WHERE id = $1`,
    [id, req.user.sub, reason, detail || null]
  );
  const tenant = await getTenant(id);
  await writeAccessLog({
    req,
    action: "TENANT_SUSPENDED",
    tenant,
    metadata: { reason, detail: detail || null },
  });
  await writeAudit({
    req,
    action: "TENANT_SUSPENDED",
    resourceType: "Tenant",
    resourceId: id,
    rotina: "Plataforma",
    registro: tenant.tenant_name,
    after: { reason, detail: detail || null },
  });
  return tenant;
}

export async function reactivateTenant(req, id, { reason } = {}) {
  const before = await getTenant(id);
  if (!["SUSPENDED", "DISABLED", "DELINQUENT"].includes(before.lifecycle_status)) {
    throw httpError(400, "Somente tenants suspensos/desabilitados podem ser reativados", "INVALID_STATE");
  }
  await pool.query(
    `UPDATE tenants SET
       lifecycle_status = 'ACTIVE',
       billing_status = 'active',
       reactivated_at = now(),
       reactivated_by = $2,
       reactivation_reason = $3,
       suspended_at = NULL,
       suspended_by = NULL,
       suspension_reason = NULL,
       suspension_detail = NULL,
       disabled_at = NULL,
       disabled_by = NULL,
       updated_date = now()
     WHERE id = $1`,
    [id, req.user.sub, reason || null]
  );
  const tenant = await getTenant(id);
  await writeAccessLog({ req, action: "TENANT_REACTIVATED", tenant, metadata: { reason: reason || null } });
  await writeAudit({
    req,
    action: "TENANT_REACTIVATED",
    resourceType: "Tenant",
    resourceId: id,
    rotina: "Plataforma",
    registro: tenant.tenant_name,
    after: { reason: reason || null },
  });
  return tenant;
}

export async function disableTenant(req, id, { reason } = {}) {
  await pool.query(
    `UPDATE tenants SET
       lifecycle_status = 'DISABLED',
       billing_status = 'disabled',
       disabled_at = now(),
       disabled_by = $2,
       suspension_detail = COALESCE($3, suspension_detail),
       updated_date = now()
     WHERE id = $1`,
    [id, req.user.sub, reason || null]
  );
  const tenant = await getTenant(id);
  await writeAccessLog({ req, action: "TENANT_DISABLED", tenant });
  await writeAudit({
    req,
    action: "TENANT_DISABLED",
    resourceType: "Tenant",
    resourceId: id,
    rotina: "Plataforma",
    registro: tenant.tenant_name,
  });
  return tenant;
}

export async function cancelTenant(req, id, { reason } = {}) {
  if (!String(reason || "").trim()) {
    throw httpError(400, "Informe o motivo do cancelamento", "VALIDATION");
  }
  await pool.query(
    `UPDATE tenants SET
       lifecycle_status = 'CANCELLED',
       billing_status = 'cancelled',
       cancelled_at = now(),
       cancelled_by = $2,
       cancellation_reason = $3,
       updated_date = now()
     WHERE id = $1`,
    [id, req.user.sub, reason]
  );
  const tenant = await getTenant(id);
  await writeAccessLog({ req, action: "TENANT_CANCELLED", tenant, metadata: { reason } });
  await writeAudit({
    req,
    action: "TENANT_CANCELLED",
    resourceType: "Tenant",
    resourceId: id,
    rotina: "Plataforma",
    registro: tenant.tenant_name,
    after: { reason },
  });
  return tenant;
}

export async function listTenantUsers(tenantId) {
  await getTenant(tenantId);
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.status, u.blocked, u.last_login_at,
            tu.role AS tenant_role
     FROM tenant_users tu
     JOIN users u ON lower(u.email) = lower(tu.user_email)
     WHERE tu.tenant_id = $1
     ORDER BY u.full_name NULLS LAST, u.email`,
    [tenantId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    email: r.email,
    role: r.tenant_role,
    status: r.blocked ? "blocked" : r.status,
    last_login_at: r.last_login_at,
  }));
}

export async function setContext(req, tenantId) {
  if (!tenantId) {
    await writeAccessLog({ req, action: "CONTEXT_ALL", tenant: null, purpose: "administracao_plataforma" });
    return { tenant_id: null, tenant_name: "Todos os clientes", purpose: "administracao_plataforma" };
  }
  const tenant = await getTenant(tenantId);
  await writeAccessLog({ req, action: "CONTEXT_SWITCH", tenant, purpose: "administracao_plataforma" });
  return {
    tenant_id: tenant.id,
    group_id: tenant.group_id,
    tenant_name: tenant.tenant_name,
    tenant_domain: tenant.domain,
    billing_status: tenant.billing_status,
    lifecycle_status: tenant.lifecycle_status,
    purpose: "administracao_plataforma",
    note: "Troca de contexto administrativo (control plane). Data plane exige sessão de suporte.",
  };
}

export async function listAccessLog({ limit = 50, offset = 0, tenantId } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const params = [];
  let where = "";
  if (tenantId) {
    params.push(tenantId);
    where = `WHERE tenant_id = $${params.length}`;
  }
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM platform_access_log ${where}`,
    params
  );
  params.push(safeLimit, safeOffset);
  const result = await pool.query(
    `SELECT id, created_date, actor_email, actor_name, action, tenant_id, tenant_name,
            method, path, ip_address, purpose, support_session_id, metadata
     FROM platform_access_log
     ${where}
     ORDER BY created_date DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    items: result.rows,
    total: count.rows[0].total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/** Step-up: confirma senha do PLATFORM_MASTER para ações críticas. */
export async function confirmPrivilegedAuth(req, password) {
  if (!password) throw httpError(400, "Informe a senha", "VALIDATION");
  const result = await pool.query(
    `SELECT id, password_hash FROM users WHERE id = $1 AND platform_admin IS TRUE`,
    [req.user.sub]
  );
  const user = result.rows[0];
  if (!user) throw httpError(403, "PLATFORM_MASTER inválido", "PLATFORM_FORBIDDEN");
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await writeAccessLog({ req, action: "PLATFORM_MASTER_STEPUP_FAILED", purpose: "seguranca" });
    throw httpError(401, "Senha inválida", "STEPUP_FAILED");
  }
  await pool.query(
    `UPDATE users SET privileged_auth_at = now() WHERE id = $1`,
    [req.user.sub]
  );
  await writeAccessLog({ req, action: "PLATFORM_MASTER_STEPUP_OK", purpose: "seguranca" });
  return { privileged_until: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
}

export async function assertPrivilegedRecent(userId, maxAgeMinutes = 15) {
  const result = await pool.query(
    `SELECT privileged_auth_at FROM users WHERE id = $1`,
    [userId]
  );
  const at = result.rows[0]?.privileged_auth_at;
  if (!at) throw httpError(403, "Confirme sua senha para continuar", "STEPUP_REQUIRED");
  const ageMs = Date.now() - new Date(at).getTime();
  if (ageMs > maxAgeMinutes * 60 * 1000) {
    throw httpError(403, "Confirme sua senha novamente", "STEPUP_REQUIRED");
  }
}

/* ---------- Support sessions (data plane) ---------- */

export async function expireDueSupportSessions() {
  await pool.query(
    `UPDATE support_sessions
     SET status = 'expired', ended_at = COALESCE(ended_at, now()), ended_reason = 'expired'
     WHERE status = 'active' AND expires_at <= now()`
  );
}

export async function startSupportSession(req, tenantId, {
  reason,
  ticket_reference,
  duration_minutes,
}) {
  await assertPrivilegedRecent(req.user.sub);
  const duration = Number(duration_minutes);
  if (!SUPPORT_DURATIONS.includes(duration)) {
    throw httpError(400, "Duração inválida (15, 30 ou 60 minutos)", "VALIDATION");
  }
  if (!String(reason || "").trim() || String(reason).trim().length < 8) {
    throw httpError(400, "Informe um motivo com ao menos 8 caracteres", "VALIDATION");
  }
  const tenant = await getTenant(tenantId);
  if (["CANCELLED", "DISABLED"].includes(tenant.lifecycle_status)) {
    throw httpError(400, "Não é possível iniciar suporte neste status", "INVALID_STATE");
  }

  await expireDueSupportSessions();
  await pool.query(
    `UPDATE support_sessions
     SET status = 'ended', ended_at = now(), ended_reason = 'replaced'
     WHERE master_user_id = $1 AND status = 'active'`,
    [req.user.sub]
  );

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + duration * 60 * 1000);
  await pool.query(
    `INSERT INTO support_sessions (
       id, master_user_id, tenant_id, group_id, reason, ticket_reference,
       duration_minutes, expires_at, ip_address, user_agent, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')`,
    [
      id,
      req.user.sub,
      tenant.id,
      tenant.group_id,
      String(reason).trim(),
      ticket_reference || null,
      duration,
      expiresAt,
      req.ip || null,
      req.headers?.["user-agent"] || null,
    ]
  );

  await writeAccessLog({
    req,
    action: "SUPPORT_ACCESS_STARTED",
    tenant,
    purpose: "suporte_operacional",
    supportSessionId: id,
    metadata: { reason: String(reason).trim(), duration_minutes: duration, ticket_reference },
  });
  await writeAudit({
    req,
    action: "SUPPORT_ACCESS_STARTED",
    resourceType: "SupportSession",
    resourceId: id,
    rotina: "Suporte",
    registro: tenant.tenant_name,
    after: { tenant_id: tenant.id, duration_minutes: duration },
  });

  return {
    id,
    tenant_id: tenant.id,
    tenant_name: tenant.tenant_name,
    group_id: tenant.group_id,
    reason: String(reason).trim(),
    ticket_reference: ticket_reference || null,
    duration_minutes: duration,
    started_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    status: "active",
  };
}

export async function endSupportSession(req, sessionId, endedReason = "manual") {
  await expireDueSupportSessions();
  const result = await pool.query(
    `UPDATE support_sessions
     SET status = 'ended', ended_at = now(), ended_reason = $3
     WHERE id = $1 AND master_user_id = $2 AND status = 'active'
     RETURNING *`,
    [sessionId, req.user.sub, endedReason]
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, "Sessão de suporte não encontrada", "NOT_FOUND");
  const tenant = await getTenant(row.tenant_id);
  await writeAccessLog({
    req,
    action: "SUPPORT_ACCESS_ENDED",
    tenant,
    purpose: "suporte_operacional",
    supportSessionId: row.id,
  });
  await writeAudit({
    req,
    action: "SUPPORT_ACCESS_ENDED",
    resourceType: "SupportSession",
    resourceId: row.id,
    rotina: "Suporte",
    registro: tenant.tenant_name,
  });
  return { id: row.id, status: "ended", ended_at: row.ended_at };
}

export async function getActiveSupportSession(masterUserId, sessionId) {
  await expireDueSupportSessions();
  const result = await pool.query(
    `SELECT s.*, t.tenant_name, t.lifecycle_status
     FROM support_sessions s
     JOIN tenants t ON t.id = s.tenant_id
     WHERE s.id = $1 AND s.master_user_id = $2 AND s.status = 'active' AND s.expires_at > now()`,
    [sessionId, masterUserId]
  );
  return result.rows[0] || null;
}

export async function getCurrentSupportSession(masterUserId) {
  await expireDueSupportSessions();
  const result = await pool.query(
    `SELECT s.*, t.tenant_name
     FROM support_sessions s
     JOIN tenants t ON t.id = s.tenant_id
     WHERE s.master_user_id = $1 AND s.status = 'active' AND s.expires_at > now()
     ORDER BY s.started_at DESC
     LIMIT 1`,
    [masterUserId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    group_id: row.group_id,
    reason: row.reason,
    ticket_reference: row.ticket_reference,
    duration_minutes: row.duration_minutes,
    started_at: row.started_at,
    expires_at: row.expires_at,
    status: row.status,
  };
}

/** Compat: updateTenantPlan antigo sem req */
export async function updateTenantPlanLegacy(id, body) {
  return updateTenantPlan({ user: { sub: null, email: "system" }, ip: null, headers: {} }, id, body);
}

export { httpError, config };
