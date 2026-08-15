import { Router } from "express";
import * as store from "./store.js";
import { writeAudit } from "../../middleware/audit.js";

export const entitiesRouter = Router();

function actor(req) {
  return req.user?.email || "system";
}

entitiesRouter.get("/:name", async (req, res, next) => {
  try {
    res.json(await store.list(req.params.name, req.query.sort, req.query.limit));
  } catch (error) {
    next(error);
  }
});

entitiesRouter.post("/:name/filter", async (req, res, next) => {
  try {
    const { query, sort, limit } = req.body || {};
    res.json(await store.filter(req.params.name, query, sort, limit));
  } catch (error) {
    next(error);
  }
});

entitiesRouter.post("/:name/bulk", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body?.items || [];
    const created = await store.bulkCreate(req.params.name, items, actor(req));
    await writeAudit({
      req,
      action: "BULK_CREATE",
      resourceType: req.params.name,
      payload: { count: created.length },
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

entitiesRouter.get("/:name/:id", async (req, res, next) => {
  try {
    res.json(await store.getById(req.params.name, req.params.id));
  } catch (error) {
    next(error);
  }
});

entitiesRouter.post("/:name", async (req, res, next) => {
  try {
    const created = await store.create(req.params.name, req.body || {}, actor(req));
    await writeAudit({
      req,
      action: "CREATE",
      resourceType: req.params.name,
      resourceId: created.id,
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

entitiesRouter.patch("/:name/:id", async (req, res, next) => {
  try {
    const updated = await store.update(req.params.name, req.params.id, req.body || {});
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: req.params.name,
      resourceId: req.params.id,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

entitiesRouter.put("/:name/:id", async (req, res, next) => {
  try {
    const updated = await store.update(req.params.name, req.params.id, req.body || {});
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: req.params.name,
      resourceId: req.params.id,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

entitiesRouter.delete("/:name/:id", async (req, res, next) => {
  try {
    const removed = await store.remove(req.params.name, req.params.id);
    await writeAudit({
      req,
      action: "DELETE",
      resourceType: req.params.name,
      resourceId: req.params.id,
    });
    res.json(removed);
  } catch (error) {
    next(error);
  }
});
