import { pool } from "../../db/pool.js";

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export async function listTenants() {
  const result = await pool.query(
    `SELECT
        t.id, t.group_id, t.tenant_name, t.domain, t.plan, t.billing_status,
        t.owner_email, t.trial_ends_at, t.contract_limit, t.contracts_used,
        t.onboarding_completed_at,
        g.group_name, g.cnpj_group,
        (SELECT COUNT(*)::int FROM tenant_users tu WHERE tu.tenant_id = t.id) AS users_count
     FROM tenants t
     JOIN groups g ON g.id = t.group_id
     ORDER BY t.tenant_name ASC, t.created_date ASC`
  );
  return result.rows.map((row) => ({
    id: row.id,
    group_id: row.group_id,
    tenant_name: row.tenant_name,
    domain: row.domain || null,
    plan: row.plan,
    billing_status: row.billing_status,
    owner_email: row.owner_email,
    trial_ends_at: row.trial_ends_at,
    contract_limit: row.contract_limit,
    contracts_used: row.contracts_used,
    group_name: row.group_name,
    cnpj: row.cnpj_group || null,
    users_count: row.users_count,
    onboarding_completed_at: row.onboarding_completed_at || null,
  }));
}

const PLANS = ["STARTER", "PRO", "ENTERPRISE"];
const BILLING = ["trial", "active", "suspended"];

export async function updateTenantPlan(id, { plan, billing_status }) {
  if (!PLANS.includes(plan)) throw httpError(400, "Plano inválido", "VALIDATION");
  const status = billing_status || "active";
  if (!BILLING.includes(status)) throw httpError(400, "Status de cobrança inválido", "VALIDATION");
  const result = await pool.query(
    `UPDATE tenants
     SET plan = $2, billing_status = $3, updated_date = now()
     WHERE id = $1
     RETURNING id, tenant_name, plan, billing_status, trial_ends_at, contract_limit, contracts_used`,
    [id, plan, status]
  );
  if (!result.rows[0]) throw httpError(404, "Cliente não encontrado", "TENANT_NOT_FOUND");
  return result.rows[0];
}

export async function writeAccessLog({
  req,
  action,
  tenant = null,
  purpose = "suporte_operacional",
} = {}) {
  await pool.query(
    `INSERT INTO platform_access_log (
       request_id, actor_id, actor_email, actor_name, action,
       tenant_id, group_id, tenant_name, method, path, ip_address, user_agent, purpose
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
    ]
  );
}

export async function setContext(req, tenantId) {
  if (!tenantId) {
    await writeAccessLog({ req, action: "CONTEXT_ALL", tenant: null });
    return { tenant_id: null, tenant_name: "Todos os clientes", purpose: "suporte_operacional" };
  }
  const result = await pool.query(
    `SELECT id, group_id, tenant_name, domain, billing_status
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = result.rows[0];
  if (!tenant) throw httpError(404, "Cliente não encontrado", "TENANT_NOT_FOUND");
  await writeAccessLog({ req, action: "CONTEXT_SWITCH", tenant });
  return {
    tenant_id: tenant.id,
    group_id: tenant.group_id,
    tenant_name: tenant.tenant_name,
    tenant_domain: tenant.domain,
    billing_status: tenant.billing_status,
    purpose: "suporte_operacional",
  };
}

export async function listAccessLog({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const count = await pool.query("SELECT COUNT(*)::int AS total FROM platform_access_log");
  const result = await pool.query(
    `SELECT id, created_date, actor_email, actor_name, action, tenant_id, tenant_name,
            method, path, ip_address, purpose
     FROM platform_access_log
     ORDER BY created_date DESC
     LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset]
  );
  return {
    items: result.rows,
    total: count.rows[0].total,
    limit: safeLimit,
    offset: safeOffset,
  };
}
