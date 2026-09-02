import { Router } from "express";
import { requireRole } from "../../middleware/auth.js";
import { writeAudit } from "../../middleware/audit.js";
import * as service from "./service.js";

export const usersRouter = Router();

usersRouter.use(requireRole("admin"));

function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const details = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.join(".") || "body";
    if (!details[field]) details[field] = issue.message;
  }
  const err = new Error(Object.values(details)[0] || "Payload inválido");
  err.status = 400;
  err.code = "VALIDATION";
  err.details = details;
  throw err;
}

usersRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await service.list());
  } catch (error) {
    next(error);
  }
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const body = parseOrThrow(service.createSchema, req.body || {});
    const created = await service.create(body, req.user?.email || "system");
    await writeAudit({
      req,
      action: "CREATE",
      resourceType: "User",
      resourceId: created.id,
      rotina: "Usuários",
      registro: created.email,
      after: created,
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

usersRouter.post("/:id/invite", async (req, res, next) => {
  try {
    const invited = await service.resendInvite(req.params.id, req.user?.email || "system");
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: "User",
      resourceId: invited.id,
      rotina: "Usuários",
      registro: invited.email,
      after: { email: invited.email, invite_pending: true },
    });
    res.json(invited);
  } catch (error) {
    next(error);
  }
});

usersRouter.put("/:id", async (req, res, next) => {
  try {
    const body = parseOrThrow(service.updateSchema, req.body || {});
    const before = await service.getById(req.params.id);
    const updated = await service.update(req.params.id, body, req.user?.sub);
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: "User",
      resourceId: updated.id,
      rotina: "Usuários",
      registro: updated.email,
      before,
      after: updated,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});
