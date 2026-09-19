import { pool } from "../../db/pool.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { actorEmail } from "../tenants/policy.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const iso = (v) => {
  if (!v) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};

async function loadConfig(configId) {
  const found = await pool.query(`SELECT * FROM balance_deployment_configs WHERE id = $1 AND group_id = $2`, [configId, groupIdOrThrow()]);
  if (!found.rows[0]) throw httpError(404, "Configuração de implantação não encontrada");
  return found.rows[0];
}

/**
 * Registra o lançamento espelho feito pelo contador no sistema antigo (Débito no passivo antigo /
 * Crédito na conta transitória). Só depois de aplicada a implantação.
 */
export async function recordDeploymentMirror(payload = {}) {
  const { configId, amount, reference, mirrorDate } = payload;
  if (!configId) throw httpError(400, "configId é obrigatório");
  const cfg = await loadConfig(configId);
  if (cfg.status !== "aplicada") throw httpError(409, "O lançamento espelho é registrado depois de aplicar a implantação");
  const value = r2(amount);
  if (!(value > 0)) throw httpError(400, "Informe o valor lançado no sistema antigo");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(mirrorDate || ""))) throw httpError(400, "Informe a data do lançamento espelho (AAAA-MM-DD)");
  if (!String(reference || "").trim()) throw httpError(400, "Informe a referência do lançamento (número do lote/lançamento no sistema antigo)");
  await pool.query(
    `UPDATE balance_deployment_configs
        SET mirror_amount = $1, mirror_reference = $2, mirror_date = $3::date, mirror_by = $4, mirror_at = now(), updated_date = now()
      WHERE id = $5 AND group_id = $6`,
    [value, String(reference).trim(), mirrorDate, actorEmail() || "sistema", configId, groupIdOrThrow()]
  );
  return getDeploymentReconciliation({ configId });
}

/**
 * Conciliação da abertura: fotografia aprovada x lançamento de abertura efetivamente lançado no
 * fechamento x lançamento espelho no sistema antigo. Só leitura.
 *  - aguardando_lancamento: o fechamento da competência da virada ainda não foi aprovado com a abertura
 *  - aguardando_espelho: abertura lançada, falta o espelho do contador
 *  - conciliada: lançado = fotografia, sem duplicidade, espelho = transitória debitada
 *  - divergente: qualquer diferença (detalhada em "problemas")
 */
export async function getDeploymentReconciliation(payload = {}) {
  const { configId } = payload;
  if (!configId) throw httpError(400, "configId é obrigatório");
  const cfg = await loadConfig(configId);
  if (!["aprovada", "aplicada"].includes(cfg.status)) throw httpError(409, "Nada a conciliar: configuração ainda em rascunho");
  let snap = cfg.position_snapshot;
  if (typeof snap === "string") snap = JSON.parse(snap);

  const rows = (await pool.query(
    `SELECT e.contract_id, e.side, e.amount, e.extra_json->>'event_key' AS event_key, e.account_id
       FROM accounting_journal_entries e
       JOIN accounting_closings c ON c.id = e.closing_id
      WHERE e.group_id = $1 AND e.event_type = 'abertura_implantacao' AND (e.extra_json->>'event_key') LIKE $2 AND c.status = 'aprovado'`,
    [groupIdOrThrow(), `abertura|${configId}|%`]
  )).rows;

  const sum = (side) => r2(rows.filter((r) => r.side === side).reduce((s, r) => s + Number(r.amount), 0));
  const postedDebit = sum("debito");
  const postedCredit = sum("credito");
  const keys = rows.map((r) => `${r.event_key}|${r.side}`);
  const duplicated = keys.length - new Set(keys).size;
  const expected = r2(snap?.totals?.total);
  const wrongTransit = rows.filter((r) => r.side === "debito" && r.account_id !== cfg.transitoria_account_id).length;

  const diffs = [];
  for (const c of snap?.contratos || []) {
    const contractDebit = r2(rows.filter((r) => r.contract_id === c.contractId && r.side === "debito").reduce((s, r) => s + Number(r.amount), 0));
    const wanted = r2(c.position?.total);
    if (rows.length && Math.abs(contractDebit - wanted) > 0.01) diffs.push({ contractNumber: c.contractNumber, esperado: wanted, lancado: contractDebit });
  }

  const mirror = cfg.mirror_amount === null || cfg.mirror_amount === undefined ? null : r2(cfg.mirror_amount);
  const problems = [];
  let status;
  if (!rows.length) {
    status = "aguardando_lancamento";
  } else {
    if (Math.abs(postedDebit - postedCredit) > 0.01) problems.push("Débitos e créditos da abertura não fecham");
    if (Math.abs(postedDebit - expected) > 0.01) problems.push("Total lançado diferente da fotografia aprovada");
    if (duplicated > 0) problems.push(`${duplicated} lançamento(s) duplicado(s)`);
    if (wrongTransit > 0) problems.push("Débito lançado fora da conta transitória configurada");
    if (diffs.length) problems.push("Contratos com valor lançado diferente da fotografia");
    if (mirror !== null && Math.abs(mirror - postedDebit) > 0.01) problems.push("Lançamento espelho diferente da abertura lançada");
    if (problems.length) status = "divergente";
    else if (mirror === null) status = "aguardando_espelho";
    else status = "conciliada";
  }

  return {
    configId,
    status,
    esperado: expected,
    lancadoDebito: postedDebit,
    lancadoCredito: postedCredit,
    espelho: mirror === null ? null : { valor: mirror, referencia: cfg.mirror_reference, data: cfg.mirror_date ? iso(cfg.mirror_date) : null, por: cfg.mirror_by },
    saldoTransitoria: rows.length ? r2(postedDebit - (mirror || 0)) : 0,
    duplicados: duplicated,
    contratosComDiferenca: diffs,
    problemas: problems,
  };
}
