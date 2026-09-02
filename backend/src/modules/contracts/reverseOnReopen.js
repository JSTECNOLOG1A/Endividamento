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
