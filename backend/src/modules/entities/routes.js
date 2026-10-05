import { Router } from "express";
import * as store from "./store.js";
import { writeAudit } from "../../middleware/audit.js";
import { registroFrom } from "../audit/format.js";
import { requireCanWrite, requireModule } from "../../middleware/rbac.js";

export const entitiesRouter = Router();

// Entidades de módulos opcionais: o CRUD genérico não tem controle por entidade, então o acesso é barrado
// aqui (esconder o menu no front não protege o dado).
const MODULE_BY_ENTITY = {
  TaxAgreement: "tax",
  TaxInstallment: "tax",
};

entitiesRouter.use("/:name", (req, res, next) => {
  const moduleKey = MODULE_BY_ENTITY[req.params.name];
  if (!moduleKey) return next();
  return requireModule(moduleKey)(req, res, next);
});

// Como a inclusão em lote aparece na auditoria ("12 parcelas" em vez de "12 registros").
const BULK_NOUN = {
  TaxAgreement: "parcelamentos",
  TaxInstallment: "parcelas",
};

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

entitiesRouter.post("/:name/bulk", requireCanWrite, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body?.items || [];
    const created = await store.bulkCreate(req.params.name, items, actor(req));
    await writeAudit({
      req,
      action: "BULK_CREATE",
      resourceType: req.params.name,
      registro: `${created.length} ${BULK_NOUN[req.params.name] || "registros"}`,
      after: { count: created.length, ids: created.slice(0, 50).map((row) => row.id) },
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

entitiesRouter.post("/:name", requireCanWrite, async (req, res, next) => {
  try {
    const created = await store.create(req.params.name, req.body || {}, actor(req));
    await writeAudit({
      req,
      action: "CREATE",
      resourceType: req.params.name,
      resourceId: created.id,
      after: created,
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

entitiesRouter.patch("/:name/:id", requireCanWrite, async (req, res, next) => {
  try {
    const before = await store.getById(req.params.name, req.params.id);
    const updated = await store.update(req.params.name, req.params.id, req.body || {});
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: req.params.name,
      resourceId: req.params.id,
      before,
      after: updated,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

entitiesRouter.put("/:name/:id", requireCanWrite, async (req, res, next) => {
  try {
    const before = await store.getById(req.params.name, req.params.id);
    const updated = await store.update(req.params.name, req.params.id, req.body || {});
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: req.params.name,
      resourceId: req.params.id,
      before,
      after: updated,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

entitiesRouter.delete("/:name/:id", requireCanWrite, async (req, res, next) => {
  try {
    const removed = await store.remove(req.params.name, req.params.id);
    // Excluir um parcelamento leva junto as parcelas (cascata do banco): a auditoria diz quantas saíram.
    const { parcelas_excluidas: cascadedInstallments, ...before } = removed;
    const cascaded = Number.isInteger(cascadedInstallments);
    await writeAudit({
      req,
      action: "DELETE",
      resourceType: req.params.name,
      resourceId: req.params.id,
      before: cascaded ? before : removed,
      ...(cascaded
        ? {
          registro: `${registroFrom(req.params.name, before, req.params.id)} (com ${cascadedInstallments} ${cascadedInstallments === 1 ? "parcela" : "parcelas"})`,
          payload: { parcelas_excluidas: cascadedInstallments },
        }
        : {}),
    });
    res.json(removed);
  } catch (error) {
    next(error);
  }
});
