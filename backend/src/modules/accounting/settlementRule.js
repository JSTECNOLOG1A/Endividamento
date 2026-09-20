// Regra de baixa efetiva do fechamento contábil.
//
// O lançamento de pagamento (principal/juros) só existe se a parcela foi realmente paga: baixa manual em
// Contas a Pagar ou retorno do ERP. Juros apropriados, reclassificação, capitalização e variação cambial de
// provisão são da competência e continuam automáticos.
//
// A regra vale de uma data em diante (parcelas com vencimento >= data). Antes dela, vale a regra antiga
// (a parcela do cronograma conta como paga), para não mudar o que já foi fechado:
//   1) parâmetro `accounting.settlement_required_from` preenchido → essa data;
//   2) vazio, e a empresa já tinha fechamento aprovado antes deste lançamento (RULE_ROLLOUT) → o mês seguinte
//      ao último fechamento aprovado nessa época (o histórico fica como está);
//   3) vazio, sem histórico → desde sempre: só a baixa efetiva vale.
import { pool } from "../../db/pool.js";
import { resolveParameter } from "../parameters/service.js";

// Fechamentos criados antes deste instante e aprovados são o "histórico" que não muda.
export const RULE_ROLLOUT = "2026-09-20T13:20:00Z";
export const RULE_FROM_ALWAYS = "1900-01-01";

const isoDate = (v) => {
  if (!v) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};

function firstDayOfNextMonth(iso) {
  const [y, m] = iso.split("-").map(Number);
  const dt = new Date(y, m, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-01`;
}

/** @returns {{from: string, source: "parametro"|"historico"|"padrao"}} */
export async function resolveSettlementRule({ groupId, entityId }) {
  const raw = String((await resolveParameter("accounting.settlement_required_from", { groupId })) || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { from: raw, source: "parametro" };

  if (entityId) {
    const history = await pool.query(
      `SELECT max(competencia) AS last FROM accounting_closings
        WHERE entity_id = $1 AND group_id = $2 AND status = 'aprovado' AND created_date < $3::timestamptz`,
      [entityId, groupId, RULE_ROLLOUT]
    );
    const last = isoDate(history.rows[0]?.last);
    if (last) return { from: firstDayOfNextMonth(last), source: "historico" };
  }
  return { from: RULE_FROM_ALWAYS, source: "padrao" };
}

/**
 * Contratos aprovados que já têm parcela sob a regra (vencimento >= from e <= fim da competência) mas nenhum
 * título no Contas a Pagar: sem título não há baixa possível, e o passivo ficaria em aberto para sempre.
 */
export async function findContractsWithoutTitles({ entityId, groupId, from, endIso }) {
  const contracts = (await pool.query(
    `SELECT id, contract_number, schedule_data, deployment_mode FROM loan_contracts
      WHERE entity_id = $1 AND group_id = $2 AND status = 'aprovado'`,
    [entityId, groupId]
  )).rows;
  if (!contracts.length) return [];

  const withTitles = new Set((await pool.query(
    `SELECT DISTINCT contract_id FROM payable_titles WHERE group_id = $1 AND contract_id = ANY($2::text[]) AND status <> 'ignorado_implantacao'`,
    [groupId, contracts.map((c) => c.id)]
  )).rows.map((r) => r.contract_id));

  const out = [];
  for (const c of contracts) {
    if (withTitles.has(c.id)) continue;
    let schedule = [];
    try {
      const parsed = typeof c.schedule_data === "string" ? JSON.parse(c.schedule_data) : c.schedule_data;
      schedule = Array.isArray(parsed?.schedule) ? parsed.schedule : [];
    } catch { schedule = []; }
    const due = schedule.filter((r) => r.dataVencimento >= from && r.dataVencimento <= endIso && ((r.amortizacao || 0) > 0 || (r.jurosPagos || 0) > 0));
    if (due.length) out.push({ contractId: c.id, contractNumber: c.contract_number, parcelasVencidas: due.length });
  }
  return out;
}
