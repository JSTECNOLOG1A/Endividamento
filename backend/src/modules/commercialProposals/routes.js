import { Router } from "express";
import { requirePlatformAdmin } from "../../middleware/tenant.js";
import * as service from "./service.js";

export const commercialProposalsRouter = Router();

commercialProposalsRouter.use(requirePlatformAdmin);

commercialProposalsRouter.get("/", async (req, res, next) => {
  try {
    res.json(await service.list({
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
    }));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await service.getById(req.params.id));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.put("/:id", async (req, res, next) => {
  try {
    res.json(await service.update(req.params.id, req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});
