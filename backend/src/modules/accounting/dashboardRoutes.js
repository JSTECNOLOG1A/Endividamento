// Dashboard executivo — só leitura, sem exigir permissão de escrita (decisão do usuário: livre pra
// qualquer usuário do tenant, sem restrição de nível). Por isso não passa pelo dispatcher genérico de
// /api/functions, que exige assertCanWrite (bloqueia "viewer") pra tudo que não está nas listas especiais.
import { Router } from "express";
import { getDashboardSummary } from "./dashboardSummary.js";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", async (req, res, next) => {
  try {
    const result = await getDashboardSummary({ entityId: req.query.entity_id || "all", dataBase: req.query.data_base });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
