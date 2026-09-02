import { Router } from "express";
import { requirePlatformAdmin } from "../../middleware/tenant.js";
import * as service from "./service.js";

export const platformRouter = Router();

platformRouter.use(requirePlatformAdmin);

platformRouter.get("/tenants", async (_req, res, next) => {
  try {
    res.json(await service.listTenants());
  } catch (error) {
    next(error);
  }
});

platformRouter.post("/context", async (req, res, next) => {
  try {
    const tenantId = req.body?.tenant_id ? String(req.body.tenant_id).trim() : null;
    res.json(await service.setContext(req, tenantId || null));
  } catch (error) {
    next(error);
  }
});

platformRouter.patch("/tenants/:id/plan", async (req, res, next) => {
  try {
    const saved = await service.updateTenantPlan(req.params.id, req.body || {});
    await service.writeAccessLog({
      req,
      action: "PLAN_UPDATE",
      tenant: saved,
      purpose: "suporte_operacional",
    });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

platformRouter.get("/access-log", async (req, res, next) => {
  try {
    res.json(await service.listAccessLog({
      limit: req.query.limit,
      offset: req.query.offset,
    }));
  } catch (error) {
    next(error);
  }
});
