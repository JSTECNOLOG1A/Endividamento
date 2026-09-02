import { Router } from "express";
import { writeAudit } from "../../middleware/audit.js";
import { requireCanWrite } from "../../middleware/rbac.js";
import * as service from "./service.js";
import { taskMeta } from "./tasks.js";

export const schedulesRouter = Router();

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

schedulesRouter.get("/tasks", (_req, res) => {
  res.json(service.listTasks());
});

schedulesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await service.list());
  } catch (error) {
    next(error);
  }
});

schedulesRouter.post("/run-task", requireCanWrite, async (req, res, next) => {
  try {
    const body = parseOrThrow(service.runTaskSchema, req.body);
    const result = await service.executeTask(body.tarefa, "manual");
    const meta = taskMeta(body.tarefa);
    await writeAudit({
      req,
      action: "RUN",
      resourceType: "ScheduledJob",
      rotina: meta?.rotina || "Agendamento",
      registro: result.resumo || meta?.label || body.tarefa,
      after: result,
      payload: { tarefa: body.tarefa, origem: "manual" },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

schedulesRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await service.getById(req.params.id));
  } catch (error) {
    next(error);
  }
});

schedulesRouter.post("/", requireCanWrite, async (req, res, next) => {
  try {
    const body = parseOrThrow(service.createSchema, req.body);
    const created = await service.create(body, actor(req));
    await writeAudit({
      req,
      action: "CREATE",
      resourceType: "ScheduledJob",
      resourceId: created.id,
      after: created,
      payload: { tarefa: created.tarefa },
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

schedulesRouter.put("/:id", requireCanWrite, async (req, res, next) => {
  try {
    const body = parseOrThrow(service.updateSchema, req.body);
    const current = await service.getById(req.params.id);
    const { runs: _runs, ...before } = current;
    const updated = await service.updateById(req.params.id, body);
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: "ScheduledJob",
      resourceId: updated.id,
      before,
      after: updated,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

schedulesRouter.patch("/:id/status", requireCanWrite, async (req, res, next) => {
  try {
    const body = parseOrThrow(service.statusSchema, req.body);
    const current = await service.getById(req.params.id);
    const { runs: _statusRuns, ...before } = current;
    const updated = await service.updateStatusById(req.params.id, body.ativo);
    await writeAudit({
      req,
      action: "STATUS",
      resourceType: "ScheduledJob",
      resourceId: updated.id,
      before,
      after: updated,
      payload: { ativo: body.ativo },
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

schedulesRouter.post("/:id/run", requireCanWrite, async (req, res, next) => {
  try {
    const current = await service.getById(req.params.id);
    const result = await service.runJob(req.params.id, "manual");
    await writeAudit({
      req,
      action: "RUN",
      resourceType: "ScheduledJob",
      resourceId: req.params.id,
      rotina: current.rotina || "Agendamento",
      registro: result.resumo || current.nome || current.tarefaLabel || current.tarefa,
      after: result,
      payload: { origem: "manual" },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

schedulesRouter.delete("/:id", requireCanWrite, async (req, res, next) => {
  try {
    const removed = await service.removeById(req.params.id);
    await writeAudit({
      req,
      action: "DELETE",
      resourceType: "ScheduledJob",
      resourceId: removed.id,
      before: removed,
    });
    res.json(removed);
  } catch (error) {
    next(error);
  }
});
