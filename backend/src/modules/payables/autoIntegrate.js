import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { integratePayableTitles } from "./erpIntegrate.js";
import { integrationLeadDays, refreshVariableTitleValues } from "./variableValue.js";
import { todayInSaoPaulo } from "../accounting/saoPaulo.js";

/**
 * Títulos a pagar prontos para integração automática:
 * abertos, ainda não no ERP, com natureza e fornecedor preenchidos.
 */
export async function listReadyPayableTitles({ limit = 200 } = {}) {
  const groupId = groupIdOrThrow();
  const leadDays = await integrationLeadDays(groupId);
  // Empresa aguardando a implantação não integra. Contrato em dólar ou indexado só integra a partir de
  // (vencimento - antecedência): antes disso o valor ainda é uma projeção. Taxa fixa em reais integra sem espera.
  const result = await pool.query(
    `SELECT t.id
       FROM payable_titles t
       LEFT JOIN loan_contracts c ON c.id = t.contract_id
      WHERE t.group_id = $1
        AND t.status = 'aberto'
        AND COALESCE(t.integrado_erp, false) = false
        AND COALESCE(t.retido_implantacao, false) = false
        AND COALESCE(t.erp_status, '') NOT IN ('integrado', 'baixado')
        AND btrim(COALESCE(t.natureza, '')) <> ''
        AND btrim(COALESCE(t.fornecedor, '')) <> ''
        AND NOT EXISTS (SELECT 1 FROM company_entities e WHERE e.id = t.entity_id AND e.implantacao_pendente)
        AND (
          c.id IS NULL
          OR (c.currency_id IS NULL AND upper(COALESCE(c.indexer, 'NA')) IN ('NA', ''))
          OR t.vencimento <= $3::date + ($4::int * interval '1 day')
        )
      ORDER BY t.vencimento ASC NULLS LAST, t.parcela ASC, t.id ASC
      LIMIT $2`,
    [groupId, Math.max(1, Math.min(Number(limit) || 200, 500)), todayInSaoPaulo(), leadDays]
  );
  return result.rows;
}

export async function autoIntegratePayableTitles(payload = {}) {
  const ready = await listReadyPayableTitles({ limit: payload.limit });
  if (!ready.length) {
    return {
      ok: true,
      message: "Nenhum título a pagar pronto para integrar",
      detalhes: { ready: 0, integrated: 0, failed: 0, skipped: 0, total: 0 },
    };
  }

  const ids = ready.map((row) => row.id);
  try {
    // Dólar e indexados: valor atualizado pela cotação e pelo índice mais recentes antes de ir ao ERP.
    await refreshVariableTitleValues(ids);
    const result = await integratePayableTitles({ ids });
    const integrated = result.integrated || 0;
    const failed = result.failed || 0;
    const skipped = result.skipped || 0;
    logger.info(
      { ready: ids.length, integrated, failed, skipped },
      "integração automática de títulos a pagar concluída"
    );
    return {
      ok: failed === 0,
      message: `${integrated} ${integrated === 1 ? "título integrado" : "títulos integrados"} · ${failed} com erro · ${skipped} ignorados · ${ids.length} candidatos`,
      detalhes: {
        ready: ids.length,
        integrated,
        failed,
        skipped,
        total: result.total,
        connection: result.connection,
        endpoint: result.endpoint,
        results: result.results,
      },
    };
  } catch (error) {
    logger.warn({ err: error }, "integração automática de títulos a pagar indisponível");
    return {
      ok: false,
      message: error.message || "Integração de títulos a pagar indisponível no ERP",
      detalhes: { ready: ids.length, unavailable: true },
    };
  }
}
