// Títulos de contratos em dólar ou indexados nascem com o valor projetado do cronograma. Para o ERP receber um valor
// próximo do real, a integração só acontece perto do vencimento (antecedência configurável) e, antes de integrar, o
// valor do título ainda não integrado é atualizado no lugar: PTAX mais recente (dólar) ou cronograma recalculado com as
// taxas publicadas (indexados). Título já integrado nunca é alterado (a diferença é tratada no pagamento).
import { pool } from "../../db/pool.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { resolveParameter } from "../parameters/service.js";
import { loadLiveSchedules, isIndexedContract } from "../accounting/liveSchedule.js";
import { todayInSaoPaulo } from "../accounting/saoPaulo.js";
import { amortBrlAmount, totJurosAmount, parcelaCode, refreshPayableTitlesFxValue, parseContractSchedule } from "./generate.js";

export const DEFAULT_LEAD_DAYS = 10;

/** Dias de antecedência da integração para contratos em dólar ou indexados. */
export async function integrationLeadDays(groupId) {
  const raw = await resolveParameter("finance.integration_lead_days_variable", { groupId });
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_LEAD_DAYS;
}

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Atualiza o valor dos títulos abertos e não integrados dos contratos indexados pelo cronograma recalculado. */
export async function refreshIndexedTitleValues(ids) {
  const groupId = groupIdOrThrow();
  if (!ids?.length) return { updated: 0 };
  const titles = (await pool.query(
    `SELECT t.id, t.contract_id, t.parcela, t.prefixo, t.valor
       FROM payable_titles t
      WHERE t.id = ANY($1::text[]) AND t.group_id = $2 AND t.status = 'aberto'
        AND COALESCE(t.integrado_erp, false) = false AND COALESCE(t.retido_implantacao, false) = false`,
    [ids, groupId]
  )).rows;
  if (!titles.length) return { updated: 0 };

  const contractIds = [...new Set(titles.map((t) => t.contract_id))];
  const contracts = (await pool.query(`SELECT * FROM loan_contracts WHERE id = ANY($1::text[]) AND group_id = $2`, [contractIds, groupId])).rows
    .filter(isIndexedContract);
  if (!contracts.length) return { updated: 0 };
  const { schedules } = await loadLiveSchedules(contracts, groupId, todayInSaoPaulo());

  let updated = 0;
  for (const title of titles) {
    const schedule = schedules[title.contract_id];
    if (!schedule) continue;
    const row = schedule.find((r) => parcelaCode(r?.parcela) === title.parcela);
    if (!row) continue;
    const value = title.prefixo === "JUR" ? totJurosAmount(row) : (title.prefixo === "EMP" || title.prefixo === "FIN") ? amortBrlAmount(row) : null;
    if (value == null || !(value > 0) || Math.abs(value - money(title.valor)) < 0.01) continue;
    await pool.query(`UPDATE payable_titles SET valor = $2, saldo = $2, updated_date = now() WHERE id = $1 AND group_id = $3`, [title.id, value, groupId]);
    updated += 1;
  }
  return { updated };
}

/** Atualiza o valor (dólar e indexados) dos títulos ainda não integrados, antes de integrar. */
export async function refreshVariableTitleValues(ids) {
  if (!ids?.length) return { usd: 0, indexed: 0 };
  let usd = 0;
  try {
    const r = await refreshPayableTitlesFxValue({ ids });
    usd = r.updated || 0;
  } catch { /* sem cotação cadastrada: mantém o valor */ }
  const indexed = (await refreshIndexedTitleValues(ids)).updated;
  return { usd, indexed };
}
