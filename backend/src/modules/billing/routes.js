import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { writeAudit } from "../../middleware/audit.js";
import { assertOwnerCanManageBilling, loadScopedTenant, PLAN_LIMITS } from "../tenants/policy.js";
import { tenantIdOrNull } from "../tenants/access.js";

export const billingRouter = Router();

const PLAN_KEYS = Object.keys(PLAN_LIMITS);

const planSchema = z.object({
  plan: z.enum(PLAN_KEYS),
  billing_status: z.enum(["trial", "active", "suspended"]).optional(),
});

function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const err = new Error(parsed.error.issues[0]?.message || "Payload inválido");
  err.status = 400;
  err.code = "VALIDATION";
  throw err;
}

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

billingRouter.patch("/plan", async (req, res, next) => {
  try {
    await assertOwnerCanManageBilling();
    const body = parseOrThrow(planSchema, req.body || {});
    const tenantId = tenantIdOrNull();
    const billingStatus = body.billing_status || "active";
    const result = await pool.query(
      `UPDATE tenants
       SET plan = $2, billing_status = $3, updated_date = now()
       WHERE id = $1
       RETURNING id, tenant_name, plan, billing_status, trial_ends_at, contracts_used, onboarding_completed_at`,
      [tenantId, body.plan, billingStatus]
    );
    const saved = publicBilling(result.rows[0]);
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: "Tenant",
      resourceId: saved.tenant_id,
      rotina: "Plano",
      registro: `${saved.plan} / ${saved.billing_status}`,
      after: saved,
    });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});
