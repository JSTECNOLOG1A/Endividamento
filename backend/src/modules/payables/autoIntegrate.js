import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { integratePayableTitles } from "./erpIntegrate.js";

/**
 * Títulos a pagar prontos para integração automática:
 * abertos, ainda não no ERP, com natureza e fornecedor preenchidos.
 */
export async function listReadyPayableTitles({ limit = 200 } = {}) {
  const result = await pool.query(
    `SELECT id
     FROM payable_titles
     WHERE group_id = $1
       AND status = 'aberto'
       AND COALESCE(integrado_erp, false) = false
       AND COALESCE(retido_implantacao, false) = false
       AND COALESCE(erp_status, '') NOT IN ('integrado', 'baixado')
       AND btrim(COALESCE(natureza, '')) <> ''
       AND btrim(COALESCE(fornecedor, '')) <> ''
     ORDER BY vencimento ASC NULLS LAST, parcela ASC, id ASC
     LIMIT $2`,
    [groupIdOrThrow(), Math.max(1, Math.min(Number(limit) || 200, 500))]
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
