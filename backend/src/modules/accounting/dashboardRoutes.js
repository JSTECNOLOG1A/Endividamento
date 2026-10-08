// Dashboard executivo — só leitura, sem exigir permissão de escrita (decisão do usuário: livre pra
// qualquer usuário do tenant, sem restrição de nível). Por isso não passa pelo dispatcher genérico de
// /api/functions, que exige assertCanWrite (bloqueia "viewer") pra tudo que não está nas listas especiais.
import { Router } from "express";
import { logger } from "../../logger.js";
import { getDashboardSummary } from "./dashboardSummary.js";
import { PREFERENCE_KEYS, isPreferenceOn } from "../preferences/service.js";
import { getDashboardTaxDue } from "../tax/planning.js";

export const dashboardRouter = Router();

const TAX_SERIES_FAILURE = "Não foi possível carregar os vencimentos dos tributos agora. Os valores dos tributos não estão sendo mostrados; tente de novo em instantes.";

/**
 * Empresas da série dos tributos: as MESMAS da dívida bancária (as liberadas) quando houver ao menos uma; todas as
 * ativas do filtro só quando nenhuma está liberada (resumo bancário bloqueado pela implantação de saldos).
 */
export function taxEntityScope(summary) {
  if (summary.blocked) {
    return { escopo: "todas_aguardando_implantacao", entityIds: summary.entities.map((entity) => entity.id) };
  }
  return { escopo: "mesmas_da_divida_bancaria", entityIds: summary.usableEntities.map((entity) => entity.id) };
}

async function dashboardTaxSeries(summary) {
  const { escopo, entityIds } = taxEntityScope(summary);
  try {
    if (!(await isPreferenceOn(PREFERENCE_KEYS.dashboardTax))) return null;
    return { ...(await getDashboardTaxDue({ entityIds, dataBase: summary.dataBase })), escopo_empresas: escopo };
  } catch (error) {
    logger.error({ err: error }, "falha ao montar os vencimentos dos tributos do Dashboard");
    return { ok: false, mensagem: TAX_SERIES_FAILURE, escopo_empresas: escopo };
  }
}

dashboardRouter.get("/summary", async (req, res, next) => {
  try {
    const result = await getDashboardSummary({ entityId: req.query.entity_id || "all", dataBase: req.query.data_base });
    // Dívida tributária junto da bancária, como série própria (`vencimentosTributarios`), só para quem tem a Gestão
    // Tributária e deixou a opção ligada. Para os demais a resposta é exatamente a de antes. Falha na série (inclusive
    // ao ler a preferência) nunca derruba o resumo bancário.
    const taxDue = await dashboardTaxSeries(result);
    if (taxDue) result.vencimentosTributarios = taxDue;
    res.json(result);
  } catch (error) {
    next(error);
  }
});
