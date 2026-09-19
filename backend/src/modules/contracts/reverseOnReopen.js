import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { reversePayableTitles } from "../payables/erpIntegrate.js";
import { reverseReceivableTitles } from "../receivables/erpIntegrate.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { assertContractInTenant } from "../tenants/scope.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function inErp(title) {
  const erpStatus = String(title?.erp_status || "");
  if (erpStatus === "integrado") return true;
  if (erpStatus === "estornado" || erpStatus === "baixado") return false;
  return Boolean(title?.integrado_erp);
}

function blockerFor(kind, title) {
  const label = kind === "pagar" ? "a pagar" : "a receber";
  const ref = `${title.prefixo || ""} ${title.titulo_numero || ""}-${title.parcela || ""}`.trim();
  if (title.erp_status === "baixado" || title.status === "baixado") {
    return `Título ${label} ${ref} está baixado e não pode ser estornado.`;
  }
  if (Number(title.saldo) + 0.009 < Number(title.valor)) {
    return `Título ${label} ${ref} possui movimentação e não pode ser estornado.`;
  }
  return null;
}

function assertReverseOk(kind, result) {
  const failures = (result?.results || []).filter((row) => {
    if (row.ok) return false;
    if (row.skipped && /ainda não foi ao ERP/i.test(row.message || "")) return false;
    return true;
  });
  if (!failures.length) return;
  const sample = failures[0]?.message || "Falha ao estornar no ERP";
  const label = kind === "pagar" ? "contas a pagar" : "contas a receber";
  throw httpError(
    409,
    `Não foi possível reabrir o contrato: o estorno de ${label} falhou (${failures.length}). ${sample}`
  );
}

async function deleteContractTitles(contractId) {
  const payables = await pool.query(
    `DELETE FROM payable_titles WHERE contract_id = $1 AND group_id = $2`,
    [contractId, groupIdOrThrow()]
  );
  const receivables = await pool.query(
    `DELETE FROM receivable_titles WHERE contract_id = $1 AND group_id = $2`,
    [contractId, groupIdOrThrow()]
  );
  return {
    payables: payables.rowCount || 0,
    receivables: receivables.rowCount || 0,
  };
}

export async function reverseTitlesForContractReopen(contractId) {
  await assertContractInTenant(contractId);
  const groupId = groupIdOrThrow();
  const [payables, receivables] = await Promise.all([
    pool.query(`SELECT * FROM payable_titles WHERE contract_id = $1 AND group_id = $2`, [contractId, groupId]),
    pool.query(`SELECT * FROM receivable_titles WHERE contract_id = $1 AND group_id = $2`, [contractId, groupId]),
  ]);

  const openPayables = payables.rows.filter((row) => row.status === "aberto");
  const openReceivables = receivables.rows.filter((row) => row.status === "aberto");
  if (!payables.rows.length && !receivables.rows.length) {
    return { payables: 0, receivables: 0 };
  }

  const blockers = [
    ...openPayables.map((row) => blockerFor("pagar", row)),
    ...openReceivables.map((row) => blockerFor("receber", row)),
  ].filter(Boolean);
  if (blockers.length) {
    throw httpError(
      409,
      `Não é possível reabrir o contrato enquanto houver títulos que não podem ser estornados. ${blockers.slice(0, 3).join(" ")}`
    );
  }

  const payableIds = openPayables.filter(inErp).map((row) => row.id);
  const receivableIds = openReceivables.filter(inErp).map((row) => row.id);

  try {
    if (payableIds.length) {
      const reversed = await reversePayableTitles({ ids: payableIds });
      assertReverseOk("pagar", reversed);
    }
    if (receivableIds.length) {
      const reversed = await reverseReceivableTitles({ ids: receivableIds });
      assertReverseOk("receber", reversed);
    }
  } catch (error) {
    if (error.status === 409) throw error;
    const message = error.message || "Falha ao estornar títulos no ERP";
    throw httpError(
      error.status === 400 ? 409 : (error.status || 502),
      `Não foi possível reabrir o contrato: os títulos gerados precisam ser estornados. ${message}`
    );
  }

  const deleted = await deleteContractTitles(contractId);

  logger.info(
    {
      contractId,
      payables: deleted.payables,
      receivables: deleted.receivables,
      payableErp: payableIds.length,
      receivableErp: receivableIds.length,
    },
    "títulos estornados e excluídos na reabertura do contrato"
  );

  return deleted;
}

function dueIso(row) {
  const v = row.vencimento;
  if (!v) return "";
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return String(v).slice(0, 10);
}

// Renegociação e quitação antecipada encerram o cronograma numa data de corte,
// mas NÃO reabrem o contrato: o histórico do que já foi pago precisa ficar.
// Remove só os títulos ABERTOS com vencimento depois do corte (estornando no
// ERP os que já foram integrados). Títulos baixados, cancelados, ou vencidos
// até o corte, continuam intactos. Título futuro com movimentação parcial não
// pode ser removido — bloqueia com 409 em vez de perder o registro.
export async function closeTitlesAfterCutoff(contractId, cutoffDate) {
  await assertContractInTenant(contractId);
  const groupId = groupIdOrThrow();
  const cutoff = dueIso({ vencimento: cutoffDate });
  if (!cutoff) return { payables: 0, receivables: 0 };

  const [payables, receivables] = await Promise.all([
    pool.query(`SELECT * FROM payable_titles WHERE contract_id = $1 AND group_id = $2`, [contractId, groupId]),
    pool.query(`SELECT * FROM receivable_titles WHERE contract_id = $1 AND group_id = $2`, [contractId, groupId]),
  ]);
  const future = (row) => row.status === "aberto" && dueIso(row) > cutoff;
  const payableTargets = payables.rows.filter(future);
  const receivableTargets = receivables.rows.filter(future);
  if (!payableTargets.length && !receivableTargets.length) return { payables: 0, receivables: 0 };

  const blockers = [
    ...payableTargets.map((row) => blockerFor("pagar", row)),
    ...receivableTargets.map((row) => blockerFor("receber", row)),
  ].filter(Boolean);
  if (blockers.length) {
    throw httpError(
      409,
      `Não é possível encerrar o cronograma enquanto houver títulos futuros com movimentação. ${blockers.slice(0, 3).join(" ")}`
    );
  }

  const payableErp = payableTargets.filter(inErp).map((row) => row.id);
  const receivableErp = receivableTargets.filter(inErp).map((row) => row.id);
  try {
    if (payableErp.length) assertReverseOk("pagar", await reversePayableTitles({ ids: payableErp }));
    if (receivableErp.length) assertReverseOk("receber", await reverseReceivableTitles({ ids: receivableErp }));
  } catch (error) {
    if (error.status === 409) throw error;
    throw httpError(
      error.status === 400 ? 409 : (error.status || 502),
      `Não foi possível encerrar o cronograma: os títulos futuros precisam ser estornados no ERP. ${error.message || ""}`.trim()
    );
  }

  const removedPayables = payableTargets.length
    ? await pool.query(`DELETE FROM payable_titles WHERE id = ANY($1::text[]) AND group_id = $2`, [payableTargets.map((r) => r.id), groupId])
    : { rowCount: 0 };
  const removedReceivables = receivableTargets.length
    ? await pool.query(`DELETE FROM receivable_titles WHERE id = ANY($1::text[]) AND group_id = $2`, [receivableTargets.map((r) => r.id), groupId])
    : { rowCount: 0 };
  logger.info(
    { contractId, cutoff, payables: removedPayables.rowCount, receivables: removedReceivables.rowCount },
    "títulos futuros removidos no encerramento do cronograma (renegociação/quitação)"
  );
  return { payables: removedPayables.rowCount || 0, receivables: removedReceivables.rowCount || 0 };
}
