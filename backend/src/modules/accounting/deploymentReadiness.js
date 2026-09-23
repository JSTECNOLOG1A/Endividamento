// Prontidão da Lógica Contábil para a Implantação de Saldos.
//
// A implantação lança a abertura e, depois dela, o fechamento contabiliza os títulos e as parcelas novos.
// Sem as contas da matriz necessárias para essa contabilização, o fechamento acusaria "matriz incompleta"
// logo na virada. Por isso a tela só abre, e a aprovação só passa, quando as contas necessárias de cada
// categoria de operação (empréstimos, financiamentos...) já estão preenchidas na Lógica Contábil.
import { pool } from "../../db/pool.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { EVENT_TYPE_LABELS, OPERATION_CATEGORY_LABELS } from "./closingEngine.js";
import { isIndexedContract } from "./liveSchedule.js";

// Necessárias para qualquer contrato: liberação, apropriação (provisão) de juros, pagamentos e reclassificação.
const ALWAYS_REQUIRED = [
  "liberacao",
  "juros_apropriados",
  "pagamento_principal",
  "pagamento_juros",
  "reclassificacao_circulante_principal",
];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function scheduleOf(contract) {
  try {
    const parsed = typeof contract.schedule_data === "string" ? JSON.parse(contract.schedule_data) : contract.schedule_data;
    return Array.isArray(parsed?.schedule) ? parsed.schedule : [];
  } catch {
    return [];
  }
}

/**
 * @returns {{ready: boolean, categories: Array<{category, label, contracts, required: string[], missing: Array<{eventType, label}>}>}}
 */
export async function getDeploymentReadiness(payload = {}) {
  const { entityId } = payload;
  if (!entityId) throw httpError(400, "entityId é obrigatório");
  const groupId = groupIdOrThrow();

  const contracts = (await pool.query(
    `SELECT id, operation_category, currency_id, iof_value, other_fees, schedule_data, indexer, transaction_cost_recognition
       FROM loan_contracts WHERE entity_id = $1 AND group_id = $2 AND status = 'aprovado'`,
    [entityId, groupId]
  )).rows;
  const mappings = (await pool.query(
    `SELECT event_type, operation_category, debit_account_id, credit_account_id, status
       FROM accounting_event_mappings WHERE entity_id = $1 AND group_id = $2`,
    [entityId, groupId]
  )).rows;

  const byCategory = new Map();
  for (const c of contracts) {
    const category = c.operation_category || "emprestimos";
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(c);
  }

  const categories = [...byCategory.entries()].map(([category, rows]) => {
    const required = new Set(ALWAYS_REQUIRED);
    // Só exige o que os contratos da categoria realmente usam.
    if (rows.some((c) => c.currency_id)) { required.add("variacao_cambial_passiva"); required.add("variacao_cambial_ativa"); }
    if (rows.some((c) => Number(c.iof_value) > 0)) required.add("iof");
    if (rows.some(isIndexedContract)) required.add("ajuste_provisao_juros");
    const feeRows = rows.filter((c) => Number(c.other_fees) > 0);
    if (feeRows.some((c) => c.transaction_cost_recognition !== "amortizado")) required.add("custo_transacao_inicial");
    if (feeRows.some((c) => c.transaction_cost_recognition === "amortizado")) {
      required.add("custo_transacao_diferido");
      required.add("custo_transacao_apropriacao");
    }
    if (rows.some((c) => scheduleOf(c).some((r) => Number(r.jurosCapitalizados) > 0 || Number(r.jurosCapitalizadosBRL) > 0))) required.add("capitalizacao_juros");

    const filled = (type) => mappings.some(
      (m) => m.event_type === type && (m.operation_category || "emprestimos") === category && m.status !== "inativo" && m.debit_account_id && m.credit_account_id
    );
    const missing = [...required].filter((type) => !filled(type)).map((eventType) => ({ eventType, label: EVENT_TYPE_LABELS[eventType] || eventType }));
    return { category, label: OPERATION_CATEGORY_LABELS[category] || category, contracts: rows.length, required: [...required], missing };
  });

  return { ready: categories.every((c) => c.missing.length === 0), categories };
}

/** Mensagem para recusar a aprovação quando a Lógica Contábil está incompleta. */
export function readinessMessage(readiness) {
  const parts = readiness.categories
    .filter((c) => c.missing.length)
    .map((c) => `${c.label}: ${c.missing.map((m) => m.label).join(", ")}`);
  return `Preencha a Lógica Contábil antes de aprovar a implantação — faltam contas em ${parts.join("; ")}`;
}
