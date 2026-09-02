import { Router } from "express";
import { pool } from "../../db/pool.js";
import { loadScopedTenant, PLAN_LIMITS } from "../tenants/policy.js";

export const billingRouter = Router();

function publicBilling(row) {
  const caps = PLAN_LIMITS[row.plan] || PLAN_LIMITS.STARTER;
  return {
    tenant_id: row.id,
    tenant_name: row.tenant_name,
    plan: row.plan,
    billing_status: row.billing_status,
    trial_ends_at: row.trial_ends_at,
    contract_limit: Number.isFinite(caps.contracts) ? caps.contracts : null,
    user_limit: Number.isFinite(caps.users) ? caps.users : null,
    contracts_used: row.contracts_used,
    onboarding_completed_at: row.onboarding_completed_at || null,
  };
}

billingRouter.get("/plan", async (_req, res, next) => {
  try {
    const tenant = await loadScopedTenant();
    const full = await pool.query(
      `SELECT id, tenant_name, plan, billing_status, trial_ends_at, contracts_used, onboarding_completed_at
       FROM tenants WHERE id = $1`,
      [tenant.id]
    );
    res.json(publicBilling(full.rows[0]));
  } catch (error) {
    next(error);
  }
});

billingRouter.patch("/plan", async (req, res) => {
  res.status(403).json({
    error: "Alteração de plano somente pelo suporte da plataforma.",
    code: "BILLING_LOCKED",
  });
});
