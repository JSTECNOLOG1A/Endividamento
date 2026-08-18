import { Router } from "express";
import { requireRole } from "../../middleware/auth.js";
import * as service from "./service.js";

export const auditRouter = Router();

auditRouter.get("/meta", requireRole("admin"), async (_req, res, next) => {
  try {
    res.json(await service.meta());
  } catch (error) {
    next(error);
  }
});

auditRouter.get("/", requireRole("admin"), async (req, res, next) => {
  try {
    res.json(await service.list({
      from: req.query.from,
      to: req.query.to,
      actor: req.query.actor,
      action: req.query.action,
      rotina: req.query.rotina,
      processingType: req.query.processingType,
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
    }));
  } catch (error) {
    next(error);
  }
});

auditRouter.get("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const row = await service.getById(req.params.id);
    if (!row) {
      const err = new Error("Registro de log não encontrado");
      err.status = 404;
      throw err;
    }
    res.json(row);
  } catch (error) {
    next(error);
  }
});
