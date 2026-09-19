import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { assertContractInTenant } from "../tenants/scope.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isLastDayOfMonth(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m, 0).getDate() === d;
}

export function isoDate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

/**
 * Filtro da geração de títulos para contrato em implantação de saldos:
 * só parcelas com vencimento DEPOIS da data de corte, mais as parcelas vencidas em aberto informadas
 * (que são recriadas). Contrato sem a marca não passa por aqui.
 */
export function deploymentKeepsTitle(contract, title) {
  if (!contract?.deployment_mode) return true;
  const cutoff = isoDate(contract.deployment_cutoff);
  if (!cutoff) return true;
  if (isoDate(title.vencimento) > cutoff) return true;
  let open = contract.deployment_open_parcelas;
  if (typeof open === "string") {
    try { open = JSON.parse(open); } catch { open = []; }
  }
  const set = new Set((Array.isArray(open) ? open : []).map((p) => String(p).padStart(3, "0")));
  return set.has(String(title.parcela).padStart(3, "0")) || set.has(String(Number(title.parcela)));
}

/**
 * Marca o contrato como "em implantação de saldos". NÃO apaga nem recria títulos (isso é a troca,
 * feita à parte e com janela combinada): só liga o filtro de geração, a retenção da integração
 * automática e o bloqueio de fechamento até a data de corte.
 * A data de corte é sempre o último dia de um mês (regra da implantação).
 */
export async function markContractForDeployment(payload = {}) {
  const { contractId, cutoffDate, openParcelas = [] } = payload;
  if (!contractId) throw httpError(400, "contractId é obrigatório");
  if (!ISO.test(String(cutoffDate || "")) || !isLastDayOfMonth(cutoffDate)) {
    throw httpError(400, "A data de corte deve ser o último dia de um mês (AAAA-MM-DD)");
  }
  if (!Array.isArray(openParcelas)) throw httpError(400, "openParcelas deve ser uma lista de números de parcela");
  await assertContractInTenant(contractId);
  const groupId = groupIdOrThrow();
  const found = await pool.query(`SELECT id, status FROM loan_contracts WHERE id = $1 AND group_id = $2`, [contractId, groupId]);
  if (!found.rows[0]) throw httpError(404, "Contrato não encontrado");
  if (found.rows[0].status !== "aprovado") throw httpError(409, "Só contratos aprovados entram em implantação");

  await pool.query(
    `UPDATE loan_contracts
        SET deployment_mode = true, deployment_cutoff = $1::date, deployment_open_parcelas = $2::jsonb, updated_date = now()
      WHERE id = $3 AND group_id = $4`,
    [cutoffDate, JSON.stringify(openParcelas.map((p) => String(p))), contractId, groupId]
  );
  // Títulos já gerados e ainda não integrados ficam retidos até a liberação explícita.
  const held = await pool.query(
    `UPDATE payable_titles SET retido_implantacao = true, updated_date = now()
      WHERE contract_id = $1 AND group_id = $2 AND COALESCE(integrado_erp, false) = false
        AND COALESCE(erp_status, '') NOT IN ('integrado', 'baixado') AND status = 'aberto'`,
    [contractId, groupId]
  );
  logger.info({ contractId, cutoffDate, retidos: held.rowCount }, "contrato marcado para implantação de saldos");
  return { contractId, cutoffDate, openParcelas, titulosRetidos: held.rowCount || 0 };
}

/** Libera a retenção dos títulos do contrato para a integração (feito só na janela de troca). */
export async function releaseDeploymentTitles(payload = {}) {
  const { contractId } = payload;
  if (!contractId) throw httpError(400, "contractId é obrigatório");
  await assertContractInTenant(contractId);
  const released = await pool.query(
    `UPDATE payable_titles SET retido_implantacao = false, updated_date = now()
      WHERE contract_id = $1 AND group_id = $2 AND retido_implantacao = true`,
    [contractId, groupIdOrThrow()]
  );
  return { contractId, titulosLiberados: released.rowCount || 0 };
}
