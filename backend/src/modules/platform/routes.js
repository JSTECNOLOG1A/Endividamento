import { Router } from "express";
import { z } from "zod";
import { requirePlatformAdmin } from "../../middleware/tenant.js";
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from "./permissions.js";
import * as service from "./service.js";

export const platformRouter = Router();

platformRouter.use(requirePlatformAdmin);

function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const err = new Error(parsed.error.issues[0]?.message || "Payload inválido");
    err.status = 400;
    err.code = "VALIDATION";
    throw err;
  }
  return parsed.data;
}

platformRouter.get(
  "/overview",
  requirePlatformPermission(PLATFORM_PERMISSIONS.OVERVIEW_READ),
  async (_req, res, next) => {
    try {
      res.json(await service.getOverview());
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.get(
  "/tenants",
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_READ),
  async (req, res, next) => {
    try {
      res.json(await service.listTenants({
        status: req.query.status,
        plan: req.query.plan,
        q: req.query.q,
      }));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.get(
  "/tenants/:id",
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_READ),
  async (req, res, next) => {
    try {
      res.json(await service.getTenant(req.params.id));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.get(
  "/tenants/:id/users",
  requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_READ),
  async (req, res, next) => {
    try {
      res.json(await service.listTenantUsers(req.params.id));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.get(
  "/tenants/:id/audit",
  requirePlatformPermission(PLATFORM_PERMISSIONS.AUDIT_READ),
  async (req, res, next) => {
    try {
      res.json(await service.listAccessLog({
        tenantId: req.params.id,
        limit: req.query.limit,
        offset: req.query.offset,
      }));
    } catch (error) {
      next(error);
    }
  }
);

const createSchema = z.object({
  legal_name: z.string().min(2),
  trade_name: z.string().optional().nullable(),
  document: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  admin_email: z.string().email(),
  owner_email: z.string().email().optional(),
  phone: z.string().optional().nullable(),
  responsible_name: z.string().optional().nullable(),
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).optional(),
  billing_period: z.enum(["monthly", "yearly"]).optional(),
  user_limit: z.number().int().positive().optional().nullable(),
  trial: z.boolean().optional(),
  trial_days: z.number().int().optional(),
  lifecycle_status: z.enum(["PENDING", "TRIAL", "ACTIVE"]).optional(),
  domain: z.string().optional().nullable(),
});

platformRouter.post(
  "/tenants",
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_CREATE),
  async (req, res, next) => {
    try {
      const body = parseOrThrow(createSchema, req.body || {});
      res.status(201).json(await service.createTenant(req, body));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.patch(
  "/tenants/:id",
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_UPDATE),
  async (req, res, next) => {
    try {
      res.json(await service.updateTenant(req, req.params.id, req.body || {}));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.patch(
  "/tenants/:id/plan",
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  async (req, res, next) => {
    try {
      await service.assertPrivilegedRecent(req.user.sub);
      res.json(await service.updateTenantPlan(req, req.params.id, req.body || {}));
    } catch (error) {
      next(error);
    }
  }
);

const suspendSchema = z.object({
  reason: z.enum([
    "INADIMPLENCIA", "SOLICITACAO_CLIENTE", "SEGURANCA",
    "VIOLACAO_CONTRATUAL", "MANUTENCAO_ADMINISTRATIVA", "OUTRO",
  ]),
  detail: z.string().optional().nullable(),
});

platformRouter.post(
  "/tenants/:id/suspend",
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_SUSPEND),
  async (req, res, next) => {
    try {
      await service.assertPrivilegedRecent(req.user.sub);
      const body = parseOrThrow(suspendSchema, req.body || {});
      res.json(await service.suspendTenant(req, req.params.id, body));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.post(
  "/tenants/:id/reactivate",
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_REACTIVATE),
  async (req, res, next) => {
    try {
      await service.assertPrivilegedRecent(req.user.sub);
      res.json(await service.reactivateTenant(req, req.params.id, req.body || {}));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.post(
  "/tenants/:id/disable",
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_DISABLE),
  async (req, res, next) => {
    try {
      await service.assertPrivilegedRecent(req.user.sub);
      res.json(await service.disableTenant(req, req.params.id, req.body || {}));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.post(
  "/tenants/:id/cancel",
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_CANCEL),
  async (req, res, next) => {
    try {
      await service.assertPrivilegedRecent(req.user.sub);
      res.json(await service.cancelTenant(req, req.params.id, req.body || {}));
    } catch (error) {
      next(error);
    }
  }
);

const supportSchema = z.object({
  reason: z.string().min(8),
  ticket_reference: z.string().optional().nullable(),
  duration_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
});

platformRouter.post(
  "/tenants/:id/support-session",
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_START),
  async (req, res, next) => {
    try {
      const body = parseOrThrow(supportSchema, req.body || {});
      res.status(201).json(await service.startSupportSession(req, req.params.id, body));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.get(
  "/support-session",
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_START),
  async (req, res, next) => {
    try {
      res.json(await service.getCurrentSupportSession(req.user.sub));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.delete(
  "/support-sessions/:id",
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_END),
  async (req, res, next) => {
    try {
      res.json(await service.endSupportSession(req, req.params.id));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.post("/context", async (req, res, next) => {
  try {
    const tenantId = req.body?.tenant_id ? String(req.body.tenant_id).trim() : null;
    res.json(await service.setContext(req, tenantId || null));
  } catch (error) {
    next(error);
  }
});

platformRouter.post("/step-up", async (req, res, next) => {
  try {
    res.json(await service.confirmPrivilegedAuth(req, req.body?.password));
  } catch (error) {
    next(error);
  }
});

platformRouter.get(
  "/access-log",
  requirePlatformPermission(PLATFORM_PERMISSIONS.AUDIT_READ),
  async (req, res, next) => {
    try {
      res.json(await service.listAccessLog({
        limit: req.query.limit,
        offset: req.query.offset,
        tenantId: req.query.tenant_id,
      }));
    } catch (error) {
      next(error);
    }
  }
);

platformRouter.get("/audit", requirePlatformPermission(PLATFORM_PERMISSIONS.AUDIT_READ), async (req, res, next) => {
  try {
    res.json(await service.listAccessLog({
      limit: req.query.limit,
      offset: req.query.offset,
      tenantId: req.query.tenant_id,
    }));
  } catch (error) {
    next(error);
  }
});
