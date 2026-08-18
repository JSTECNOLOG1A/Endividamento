import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { integratePayableTitles, refreshPayableTitlesFromErp, reversePayableTitles } from "./erpIntegrate.js";

function todayIsoDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function currentMonthBounds(now = new Date()) {
  const today = todayIsoDate(now);
  const [year, month] = today.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, yearMonth: start.slice(0, 7), today };
}

function firstResult(payload) {
  return (payload?.results || [])[0] || null;
}

function inErp(title) {
  return title?.erp_status === "integrado" || Boolean(title?.integrado_erp);
}

function cannotConvert(title) {
  if (title.status && title.status !== "aberto") {
    return "Somente títulos abertos podem ser convertidos de PR para TX";
  }
  if (title.erp_status === "baixado") {
    return "Título baixado no ERP não pode ser convertido de PR para TX";
  }
  if (Number(title.saldo) + 0.009 < Number(title.valor)) {
    return "Título possui movimentação e não pode ser convertido de PR para TX";
  }
  return null;
}

async function loadTitle(id) {
  const result = await pool.query(`SELECT * FROM payable_titles WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function markAsTx(id) {
  await pool.query(
    `UPDATE payable_titles
     SET tipo = 'TX',
         converted_pr_tx_em = COALESCE(converted_pr_tx_em, now()),
         updated_date = now()
     WHERE id = $1`,
    [id]
  );
}

async function listPrDueThisMonth(end) {
  const result = await pool.query(
    `SELECT * FROM payable_titles
     WHERE upper(btrim(tipo)) = 'PR'
       AND vencimento IS NOT NULL
       AND vencimento <= $1::date
       AND status = 'aberto'
     ORDER BY vencimento ASC, parcela ASC`,
    [end]
  );
  return result.rows;
}

async function listPendingTxConversions() {
  const result = await pool.query(
    `SELECT * FROM payable_titles
     WHERE converted_pr_tx_em IS NOT NULL
       AND upper(btrim(tipo)) = 'TX'
       AND status = 'aberto'
       AND erp_status NOT IN ('integrado', 'baixado')
     ORDER BY vencimento ASC, parcela ASC`
  );
  return result.rows;
}

function reverseCanProceed(row) {
  if (!row) return { ok: false, message: "Estorno sem resposta" };
  if (row.ok) return { ok: true };
  if (row.skipped && /ainda não foi ao ERP/i.test(row.message || "")) return { ok: true, skipped: true };
  return { ok: false, skipped: Boolean(row.skipped), message: row.message || "Não foi possível estornar o PR no Protheus" };
}

async function integrateOne(title) {
  const result = await integratePayableTitles({ ids: [title.id] });
  const row = firstResult(result);
  if (row?.ok) {
    return { ok: true, message: row.message || "Integrado como TX" };
  }
  if (row?.skipped && /já integrado/i.test(row.message || "")) {
    return { ok: true, skipped: true, message: row.message };
  }
  return {
    ok: false,
    skipped: Boolean(row?.skipped),
    message: row?.message || "Não foi possível integrar o título TX no Protheus",
  };
}

async function convertOne(title) {
  const current = await loadTitle(title.id);
  if (!current) {
    return { id: title.id, ok: false, step: "local", message: "Título não encontrado" };
  }
  if (String(current.tipo || "").trim().toUpperCase() !== "PR") {
    return { id: current.id, ok: true, skipped: true, step: "local", message: "Tipo já não é PR" };
  }

  const blocked = cannotConvert(current);
  if (blocked) {
    return { id: current.id, ok: false, skipped: true, step: "local", message: blocked };
  }

  let reversed = false;
  if (inErp(current)) {
    const reverseResult = await reversePayableTitles({ ids: [current.id] });
    const check = reverseCanProceed(firstResult(reverseResult));
    if (!check.ok) {
      return {
        id: current.id,
        ok: false,
        skipped: check.skipped,
        step: "estornar",
        message: check.message,
      };
    }
    reversed = !check.skipped;
  }

  await markAsTx(current.id);
  const integrated = await integrateOne(current);
  return {
    id: current.id,
    ok: integrated.ok,
    reversed,
    converted: true,
    integrated: Boolean(integrated.ok),
    step: "integrar",
    message: reversed
      ? `PR estornado, tipo alterado para TX. ${integrated.message}`
      : `Tipo alterado para TX. ${integrated.message}`,
  };
}

async function retryOne(title) {
  const current = await loadTitle(title.id);
  if (!current) {
    return { id: title.id, ok: false, step: "integrar", message: "Título não encontrado" };
  }
  if (current.erp_status === "integrado") {
    return { id: current.id, ok: true, skipped: true, step: "integrar", message: "Já integrado" };
  }
  if (current.erp_status === "baixado" || current.status !== "aberto") {
    return { id: current.id, ok: false, skipped: true, step: "integrar", message: "Título não está aberto para reintegrar como TX" };
  }
  const integrated = await integrateOne(current);
  return {
    id: current.id,
    ok: integrated.ok,
    converted: true,
    integrated: Boolean(integrated.ok),
    step: "integrar",
    message: integrated.message,
  };
}

export async function convertPayablePrToTx(payload = {}) {
  const bounds = currentMonthBounds(payload.referenceDate ? new Date(`${payload.referenceDate}T12:00:00-03:00`) : new Date());
  const prTitles = await listPrDueThisMonth(bounds.end);
  const retryTitles = await listPendingTxConversions();

  if (prTitles.length) {
    try {
      await refreshPayableTitlesFromErp({
        ids: prTitles.map((item) => item.id),
        force: true,
        regardlessOfStatus: true,
      });
    } catch (error) {
      logger.warn({ err: error }, "consulta prévia PR→TX indisponível; segue com o status local");
    }
  }

  const results = [];
  const seen = new Set();
  let converted = 0;
  let reversed = 0;
  let integrated = 0;
  let failed = 0;
  let skipped = 0;

  for (const title of await listPrDueThisMonth(bounds.end)) {
    try {
      const row = await convertOne(title);
      results.push(row);
      seen.add(row.id);
      if (row.converted) converted += 1;
      if (row.reversed) reversed += 1;
      if (row.integrated) integrated += 1;
      if (row.skipped) skipped += 1;
      else if (!row.ok) failed += 1;
    } catch (error) {
      failed += 1;
      results.push({
        id: title.id,
        ok: false,
        step: "local",
        message: error.message || "Falha ao converter PR em TX",
      });
    }
  }

  for (const title of retryTitles) {
    if (seen.has(title.id)) continue;
    try {
      const row = await retryOne(title);
      results.push(row);
      if (row.integrated) integrated += 1;
      if (row.skipped) skipped += 1;
      else if (!row.ok) failed += 1;
    } catch (error) {
      failed += 1;
      results.push({
        id: title.id,
        ok: false,
        step: "integrar",
        message: error.message || "Falha ao reintegrar título TX",
      });
    }
  }

  const scanned = prTitles.length + retryTitles.filter((item) => !seen.has(item.id)).length;
  const message = scanned === 0
    ? `Nenhum título PR a converter em ${bounds.yearMonth}`
    : `${converted} convertidos para TX · ${reversed} estornados · ${integrated} integrados · ${failed} com erro`;

  logger.info({
    yearMonth: bounds.yearMonth,
    converted,
    reversed,
    integrated,
    failed,
    skipped,
  }, "rotina PR→TX concluída");

  return {
    ok: failed === 0,
    message,
    detalhes: {
      yearMonth: bounds.yearMonth,
      vencimentoAte: bounds.end,
      scanned,
      converted,
      reversed,
      integrated,
      failed,
      skipped,
      results,
    },
  };
}
