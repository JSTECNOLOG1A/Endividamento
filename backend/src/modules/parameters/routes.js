import { Router } from "express";
import { writeAudit } from "../../middleware/audit.js";
import { assertParameterAdmin } from "../tenants/policy.js";
import * as service from "./service.js";

export const parametersRouter = Router();

parametersRouter.get("/categories", async (_req, res, next) => {
  try {
    res.json({ data: service.getCategories() });
  } catch (error) {
    next(error);
  }
});

parametersRouter.get("/", async (req, res, next) => {
  try {
    const { category = "all", search = "" } = req.query;
    res.json({
      data: await service.listParametersForTenant({
        category: String(category),
        search: String(search).trim(),
      }),
    });
  } catch (error) {
    next(error);
  }
});

parametersRouter.post("/reset", async (req, res, next) => {
  try {
    await assertParameterAdmin();
    const { key, scope = "TENANT" } = req.body || {};
    if (!key || typeof key !== "string") {
      res.status(400).json({ error: "key é obrigatório", code: "VALIDATION" });
      return;
    }
    if (req.body?.group_id) {
      res.status(400).json({ error: "group_id não é aceito", code: "VALIDATION" });
      return;
    }
    const result = await service.resetParameter(key, { scope });
    await writeAudit({
      req,
      action: "PARAMETER_UPDATED",
      resourceType: "SystemParameter",
      resourceId: key,
      rotina: "Parâmetros",
      before: result.definition?.isSecret ? null : { value: result.oldValue, scope: result.scope },
      after: result.definition?.isSecret ? null : { value: result.newValue, scope: result.scope, reset: true },
      payload: { key, scope: result.scope },
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

parametersRouter.get("/:key", async (req, res, next) => {
  try {
    if (req.params.key === "categories") return next();
    res.json({ data: await service.getParameterDetail(req.params.key) });
  } catch (error) {
    next(error);
  }
});

parametersRouter.patch("/:key", async (req, res, next) => {
  try {
    await assertParameterAdmin();
    const { value, scope = "TENANT" } = req.body || {};
    if (req.body?.group_id) {
      res.status(400).json({ error: "group_id não é aceito", code: "VALIDATION" });
      return;
    }
    if (value === undefined) {
      res.status(400).json({ error: "value é obrigatório", code: "VALIDATION" });
      return;
    }
    const result = await service.setParameter(req.params.key, value, { scope });
    await writeAudit({
      req,
      action: "PARAMETER_UPDATED",
      resourceType: "SystemParameter",
      resourceId: req.params.key,
      rotina: "Parâmetros",
      before: result.definition?.isSecret ? null : { value: result.oldValue, scope: result.scope },
      after: result.definition?.isSecret ? null : { value: result.newValue, scope: result.scope },
      payload: { key: req.params.key, scope: result.scope },
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});
