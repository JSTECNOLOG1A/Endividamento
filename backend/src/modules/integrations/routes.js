import { Router } from "express";
import rateLimit from "express-rate-limit";
import { writeAudit } from "../../middleware/audit.js";
import * as service from "./service.js";

export const integrationsRouter = Router();

const testLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function actor(req) {
  return req.user?.email || "system";
}

function parseOrThrow(schema, data, location = "body") {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const details = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.join(".") || location;
    if (!details[field]) details[field] = issue.message;
  }
  const err = new Error("Payload inválido");
  err.status = 400;
  err.code = "VALIDATION";
  err.details = details;
  throw err;
}

integrationsRouter.get("/", async (req, res, next) => {
  try {
    const filters = parseOrThrow(service.filtersSchema, req.query, "query");
    res.json(await service.list(filters));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post("/test-connection", testLimiter, async (req, res, next) => {
  try {
    const body = parseOrThrow(service.testConnectionSchema, req.body);
    res.json({ data: await service.testConnection(body) });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get("/:code", async (req, res, next) => {
  try {
    res.json(await service.getByCode(req.params.code));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post("/", async (req, res, next) => {
  try {
    const body = parseOrThrow(service.createSchema, req.body);
    const created = await service.create(body, actor(req));
    await writeAudit({
      req,
      action: "CREATE",
      resourceType: "Integration",
      resourceId: created.id,
      after: created,
      payload: { code: created.code, nome: created.nome },
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.put("/:code", async (req, res, next) => {
  try {
    const body = parseOrThrow(service.updateSchema, req.body);
    const before = await service.getByCode(req.params.code);
    const updated = await service.updateByCode(req.params.code, body);
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: "Integration",
      resourceId: updated.id,
      before,
      after: updated,
      payload: { code: updated.code },
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.patch("/:code/status", async (req, res, next) => {
  try {
    const body = parseOrThrow(service.statusSchema, req.body);
    const before = await service.getByCode(req.params.code);
    const updated = await service.updateStatusByCode(req.params.code, body.status);
    await writeAudit({
      req,
      action: "STATUS",
      resourceType: "Integration",
      resourceId: updated.id,
      before,
      after: updated,
      payload: { status: body.status },
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.delete("/:code", async (req, res, next) => {
  try {
    const removed = await service.removeByCode(req.params.code);
    await writeAudit({
      req,
      action: "DELETE",
      resourceType: "Integration",
      resourceId: removed.id,
      before: removed,
      payload: { code: removed.code },
    });
    res.json(removed);
  } catch (error) {
    next(error);
  }
});
