import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { writeAudit } from "../../middleware/audit.js";
import { groupIdOrThrow, tenantIdOrNull } from "../tenants/access.js";
import { assertCanWrite, loadScopedTenant } from "../tenants/policy.js";
import * as store from "../entities/store.js";

export const onboardingRouter = Router();

const completeSchema = z.object({
  entity_id: z.string().min(1).optional(),
  entity_name: z.string().trim().min(2).max(255).optional(),
  codigo_empresa: z.string().trim().min(1).max(8),
  codigo_filial: z.string().trim().min(1).max(8),
});

function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const err = new Error(parsed.error.issues[0]?.message || "Payload inválido");
  err.status = 400;
  err.code = "VALIDATION";
  throw err;
}

async function firstEntity() {
  const entities = await store.list("CompanyEntity", "created_date", 1);
  return entities[0] || null;
}

onboardingRouter.get("/", async (_req, res, next) => {
  try {
    const tenant = await loadScopedTenant();
    const full = await pool.query(
      `SELECT id, tenant_name, plan, billing_status, trial_ends_at, onboarding_completed_at
       FROM tenants WHERE id = $1`,
      [tenant.id]
    );
    const entity = await firstEntity();
    const integrations = await pool.query(
      `SELECT COUNT(*)::int AS n FROM integrations WHERE group_id = $1`,
      [groupIdOrThrow()]
    );
    res.json({
      tenant_id: full.rows[0].id,
      tenant_name: full.rows[0].tenant_name,
      plan: full.rows[0].plan,
      billing_status: full.rows[0].billing_status,
      trial_ends_at: full.rows[0].trial_ends_at,
      onboarding_completed_at: full.rows[0].onboarding_completed_at,
      entity: entity
        ? {
            id: entity.id,
            entity_name: entity.entity_name,
            codigo_empresa: entity.codigo_empresa,
            codigo_filial: entity.codigo_filial,
          }
        : null,
      integrations_count: integrations.rows[0].n,
    });
  } catch (error) {
    next(error);
  }
});

onboardingRouter.post("/", async (req, res, next) => {
  try {
    await assertCanWrite();
    const body = parseOrThrow(completeSchema, req.body || {});
    const tenantId = tenantIdOrNull();
    const entity = body.entity_id
      ? await store.getById("CompanyEntity", body.entity_id)
      : await firstEntity();
    if (!entity) {
      const err = new Error("Nenhuma empresa/filial encontrada para configurar");
      err.status = 404;
      err.code = "ENTITY_NOT_FOUND";
      throw err;
    }
    const updated = await store.update("CompanyEntity", entity.id, {
      entity_name: body.entity_name || entity.entity_name,
      codigo_empresa: body.codigo_empresa,
      codigo_filial: body.codigo_filial,
    });
    const result = await pool.query(
      `UPDATE tenants
       SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()), updated_date = now()
       WHERE id = $1
       RETURNING onboarding_completed_at`,
      [tenantId]
    );
    const payload = {
      onboarding_completed_at: result.rows[0].onboarding_completed_at,
      entity: {
        id: updated.id,
        entity_name: updated.entity_name,
        codigo_empresa: updated.codigo_empresa,
        codigo_filial: updated.codigo_filial,
      },
    };
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: "Tenant",
      resourceId: tenantId,
      rotina: "Onboarding",
      registro: updated.entity_name,
      after: payload,
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});
