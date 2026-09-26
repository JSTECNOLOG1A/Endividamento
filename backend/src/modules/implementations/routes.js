import { Router } from "express";
import { requirePlatformAdmin } from "../../middleware/tenant.js";
import * as service from "./service.js";
import { IMPLEMENTATION_TEMPLATE } from "./template.js";

export const implementationsRouter = Router();

implementationsRouter.use(requirePlatformAdmin);

implementationsRouter.get("/template", async (_req, res, next) => {
  try {
    res.json(IMPLEMENTATION_TEMPLATE);
  } catch (error) {
    next(error);
  }
});

implementationsRouter.get("/available-tenants", async (_req, res, next) => {
  try {
    res.json(await service.listAvailableTenants());
  } catch (error) {
    next(error);
  }
});

implementationsRouter.get("/", async (req, res, next) => {
  try {
    res.json(await service.list({ q: req.query.q, status: req.query.status }));
  } catch (error) {
    next(error);
  }
});

implementationsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await service.getDetail(req.params.id));
  } catch (error) {
    next(error);
  }
});

implementationsRouter.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});

implementationsRouter.patch("/:id", async (req, res, next) => {
  try {
    res.json(await service.update(req.params.id, req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});

implementationsRouter.patch("/:id/activities/:activityId", async (req, res, next) => {
  try {
    res.json(await service.updateActivity(req.params.id, req.params.activityId, req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});
