import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { actorEmail } from "../tenants/policy.js";
import { computeDeploymentPosition, isLastDayOfMonthIso } from "./deploymentPosition.js";
import { markContractForDeployment } from "../payables/implantacao.js";

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

async function loadEntity(entityId) {
  const found = await pool.query(`SELECT id, entity_name FROM company_entities WHERE id = $1 AND group_id = $2`, [entityId, groupIdOrThrow()]);
  if (!found.rows[0]) throw httpError(404, "Entidade não encontrada");
  return found.rows[0];
}

function parseOpen(value) {
  let v = value;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { v = []; }
  }
  return Array.isArray(v) ? v.map((p) => String(p)) : [];
}

/**
 * Prévia da posição de abertura, por contrato, na data-base. Só leitura.
 * openParcelasByContract: { [contractId]: ["27","28"] } — parcelas até a data-base ainda em aberto.
 */
export async function previewBalanceDeployment(payload = {}) {
  const { entityId, dataBase, openParcelasByContract = {} } = payload;
  if (!entityId) throw httpError(400, "entityId é obrigatório");
  if (!isLastDayOfMonthIso(dataBase)) throw httpError(400, "A data-base deve ser o último dia de um mês (AAAA-MM-DD)");
  const entity = await loadEntity(entityId);

  const contracts = (await pool.query(
    `SELECT * FROM loan_contracts WHERE entity_id = $1 AND group_id = $2 AND status = 'aprovado' ORDER BY operation_date, contract_number`,
    [entityId, groupIdOrThrow()]
  )).rows;

  const items = [];
  const excluded = [];
  for (const c of contracts) {
    const opDate = iso(c.operation_date);
    if (opDate && opDate > dataBase) {
      excluded.push({ contractId: c.id, contractNumber: c.contract_number, motivo: "Operação posterior à data-base" });
      continue;
    }
    const lastDue = (() => {
      try {
        const s = JSON.parse(typeof c.schedule_data === "string" ? c.schedule_data : JSON.stringify(c.schedule_data)).schedule || [];
        return s.length ? s[s.length - 1].dataVencimento : "";
      } catch { return ""; }
    })();
    if (lastDue && lastDue <= dataBase && !(openParcelasByContract[c.id] || parseOpen(c.deployment_open_parcelas)).length) {
      excluded.push({ contractId: c.id, contractNumber: c.contract_number, motivo: "Contrato já vencido por inteiro na data-base" });
      continue;
    }
    const open = openParcelasByContract[c.id] !== undefined ? openParcelasByContract[c.id].map(String) : parseOpen(c.deployment_open_parcelas);
    const calc = computeDeploymentPosition(c, dataBase, open);
    items.push({
      contractId: c.id,
      contractNumber: c.contract_number,
      operationDate: opDate,
      operationValue: Number(c.operation_value) || 0,
      currency: c.currency_id || "BRL",
      inDeployment: Boolean(c.deployment_mode),
      openParcelas: open,
      parcelasAteDataBase: calc.parcelasAteDataBase,
      position: calc.position,
      warnings: calc.warnings,
    });
  }

  const sum = (k) => r2(items.reduce((s, i) => s + i.position[k], 0));
  const totals = {
    principalCP: sum("principalCP"), principalLP: sum("principalLP"),
    jurosCP: sum("jurosCP"), jurosLP: sum("jurosLP"),
    principalVencido: sum("principalVencido"), jurosVencido: sum("jurosVencido"), total: sum("total"),
  };
  return {
    entityId, entityName: entity.entity_name, dataBase, contracts: items, excluded, totals,
    // Lançamento de abertura previsto (T8 o executa): Débito na transitória, Crédito nas contas de passivo.
    entry: { debitoTransitoria: totals.total, creditos: { principalCP: totals.principalCP, principalLP: totals.principalLP, jurosCP: totals.jurosCP, jurosLP: totals.jurosLP } },
  };
}

const ACCOUNT_KEYS = ["principal_cp_account_id", "principal_lp_account_id", "juros_cp_account_id", "juros_lp_account_id", "transitoria_account_id"];

async function loadConfig(configId) {
  const found = await pool.query(`SELECT * FROM balance_deployment_configs WHERE id = $1 AND group_id = $2`, [configId, groupIdOrThrow()]);
  if (!found.rows[0]) throw httpError(404, "Configuração de implantação não encontrada");
  return found.rows[0];
}

/**
 * Aprova a configuração: valida contas e datas, congela a fotografia da posição (dados, parâmetros e
 * resultado) e trava a edição. A posição aprovada só muda por nova aprovação.
 */
export async function approveBalanceDeployment(payload = {}) {
  const { configId, openParcelasByContract = {} } = payload;
  if (!configId) throw httpError(400, "configId é obrigatório");
  const cfg = await loadConfig(configId);
  if (cfg.status !== "rascunho") throw httpError(409, "Só configurações em rascunho podem ser aprovadas");

  const dataBase = iso(cfg.data_base);
  const virada = iso(cfg.data_virada);
  if (!isLastDayOfMonthIso(dataBase)) throw httpError(400, "A data-base deve ser o último dia de um mês");
  if (!(virada > dataBase)) throw httpError(400, "A data da virada deve ser posterior à data-base");
  const missing = ACCOUNT_KEYS.filter((k) => !cfg[k]);
  if (missing.length) throw httpError(400, "Defina as cinco contas (passivo circulante e não circulante, juros a pagar circulante e não circulante, transitória) antes de aprovar");
  if (new Set(ACCOUNT_KEYS.map((k) => cfg[k])).size !== ACCOUNT_KEYS.length) throw httpError(400, "As cinco contas devem ser diferentes entre si");

  const accounts = await pool.query(
    `SELECT id, account_type FROM chart_of_accounts WHERE id = ANY($1::text[]) AND group_id = $2`,
    [ACCOUNT_KEYS.map((k) => cfg[k]), groupIdOrThrow()]
  );
  if (accounts.rows.length !== ACCOUNT_KEYS.length) throw httpError(400, "Alguma conta selecionada não existe neste cliente");
  if (accounts.rows.some((a) => a.account_type === "sintetica")) throw httpError(400, "Use apenas contas analíticas");

  const preview = await previewBalanceDeployment({ entityId: cfg.entity_id, dataBase, openParcelasByContract });
  if (!preview.contracts.length) throw httpError(400, "Nenhum contrato aprovado entra na posição desta data-base");
  const blocking = preview.contracts.filter((c) => c.warnings.some((w) => w.startsWith("Saldo negativo")));
  if (blocking.length) throw httpError(400, `Revise antes de aprovar: saldo negativo em ${blocking.map((c) => c.contractNumber).join(", ")}`);

  const snapshot = {
    aprovadoEm: new Date().toISOString(),
    aprovadoPor: actorEmail() || "sistema",
    dataBase, dataVirada: virada,
    contas: Object.fromEntries(ACCOUNT_KEYS.map((k) => [k, cfg[k]])),
    // Parâmetros que produziram o saldo: mantém a fotografia reproduzível.
    parametros: { regraCircularCP: "data-base + 12 meses (CPC 26)", juros: "rateio por dias corridos no período de cada parcela" },
    contratos: preview.contracts.map((c) => ({
      contractId: c.contractId, contractNumber: c.contractNumber, openParcelas: c.openParcelas, position: c.position, warnings: c.warnings,
    })),
    totals: preview.totals,
  };

  await pool.query(
    `UPDATE balance_deployment_configs
        SET status = 'aprovada', approved_by = $1, approved_at = now(), position_snapshot = $2::jsonb, updated_date = now()
      WHERE id = $3 AND group_id = $4`,
    [snapshot.aprovadoPor, JSON.stringify(snapshot), configId, groupIdOrThrow()]
  );
  logger.info({ configId, contratos: snapshot.contratos.length, total: snapshot.totals.total }, "implantação de saldos aprovada");
  return { configId, status: "aprovada", totals: snapshot.totals, contratos: snapshot.contratos.length };
}

/** Reabre uma configuração aprovada (e ainda não aplicada) para edição; descarta a fotografia. */
export async function reopenBalanceDeployment(payload = {}) {
  const { configId } = payload;
  if (!configId) throw httpError(400, "configId é obrigatório");
  const cfg = await loadConfig(configId);
  if (cfg.status === "aplicada") throw httpError(409, "Configuração já aplicada aos contratos");
  await pool.query(
    `UPDATE balance_deployment_configs SET status = 'rascunho', approved_by = NULL, approved_at = NULL, position_snapshot = NULL, updated_date = now()
      WHERE id = $1 AND group_id = $2`,
    [configId, groupIdOrThrow()]
  );
  return { configId, status: "rascunho" };
}

/**
 * Aplica a configuração aprovada: marca cada contrato da fotografia como "em implantação"
 * (filtro de títulos, retenção da integração, bloqueio de fechamento até a data-base).
 * Não apaga nem recria títulos e não lança nada (troca = T9, abertura = T8).
 */
export async function applyBalanceDeployment(payload = {}) {
  const { configId } = payload;
  if (!configId) throw httpError(400, "configId é obrigatório");
  const cfg = await loadConfig(configId);
  if (cfg.status !== "aprovada") throw httpError(409, "Aprove a configuração antes de aplicar");
  let snap = cfg.position_snapshot;
  if (typeof snap === "string") snap = JSON.parse(snap);
  if (!snap?.contratos?.length) throw httpError(409, "Fotografia da posição ausente");

  const results = [];
  for (const c of snap.contratos) {
    const res = await markContractForDeployment({ contractId: c.contractId, cutoffDate: snap.dataBase, openParcelas: c.openParcelas });
    results.push({ contractNumber: c.contractNumber, titulosRetidos: res.titulosRetidos });
  }
  await pool.query(`UPDATE balance_deployment_configs SET status = 'aplicada', applied_at = now(), updated_date = now() WHERE id = $1 AND group_id = $2`, [configId, groupIdOrThrow()]);
  return { configId, status: "aplicada", contratos: results };
}
