import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { isPdf } from "../../services/pdfStore.js";
import { sendMail } from "../signup/mailer.js";
import { logIsolationMiss, requireTenantContext } from "../tenants/scope.js";
import { buildGuideEmail } from "./guideEmail.js";
import { guideFiles } from "./guideFiles.js";
import { formatGuideLine, parseGuideLine } from "./guideLine.js";
import { readGuidePdf } from "./guidePdf.js";
import {
  GUIDE_STATUS_LABELS,
  GUIDE_STATUSES,
  amountToPay,
  civilDateLabel,
  guideExceptionReasons,
  guideStatusFor,
} from "./guideRules.js";
import { parseDate, validationError } from "./rules.js";

// Guia de pagamento de uma parcela de tributo: anexar (PDF ou linha digitada), corrigir, substituir, remover e
// enviar por e-mail. A guia nunca muda a situação de pagamento da parcela.
//
// Concorrência: toda mudança trava a parcela (FOR UPDATE) e, para cada código de barras envolvido, um lock de
// transação por grupo + código de barras — duas parcelas recebendo a mesma guia ao mesmo tempo não escapam da
// regra de duplicidade. Ordem dos locks: parcela, códigos de barras (ordenados), linha da guia.

export const MAX_GUIDE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RECIPIENTS = 10;
/** Envios de guia por e-mail que um usuário pode tentar por hora (contando os que falharam). */
export const MAX_SENDS_PER_HOUR = 30;
const MESSAGE_MAX = 2000;

const CLOSED_INSTALLMENT_MESSAGES = {
  paga_aguardando_reconhecimento: "Esta parcela já está paga (aguardando reconhecimento). A guia não pode ser enviada para pagamento de novo.",
  reconhecida: "Esta parcela já está paga. A guia não pode ser enviada para pagamento de novo.",
  cancelada: "Esta parcela está cancelada. A guia não pode ser enviada para pagamento.",
};

function httpError(status, message, code, details) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  if (details) err.details = details;
  return err;
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function isTruthy(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

function guideColumns(alias = "") {
  const c = alias ? `${alias}.` : "";
  return `${c}id, ${c}group_id, ${c}installment_id, ${c}origem, ${c}linha_fonte, ${c}falha_leitura, ${c}linha_digitavel,
          ${c}codigo_barras, ${c}valor_guia::float8 AS valor_guia, ${c}pagar_ate::text AS pagar_ate, ${c}cnpj_guia,
          ${c}arquivo_chave, ${c}arquivo_nome, ${c}arquivo_tamanho, ${c}situacao, ${c}motivos, ${c}verificada_em,
          ${c}encerrada_em, ${c}encerrada_por, ${c}motivo_encerramento, ${c}created_date, ${c}updated_date,
          ${c}created_by, ${c}created_by_name, ${c}updated_by`;
}

// Parcela com o que a regra e o e-mail precisam do parcelamento e da empresa. Datas como texto (data civil) e
// valores como número.
async function loadInstallmentContext(client, installmentId, groupId, { lock = false } = {}) {
  const result = await client.query(
    `SELECT i.id, i.group_id, i.agreement_id, i.numero_parcela, i.vencimento::text AS vencimento,
            i.valor::float8 AS valor, i.situacao, i.data_pagamento::text AS data_pagamento,
            i.valor_pago::float8 AS valor_pago, i.pagamento_origem, i.pagamento_registrado_em,
            a.codigo_parcelamento, a.orgao, a.uf, a.esfera, a.modalidade, a.tributo, a.qtd_parcelas,
            e.entity_name, e.document_number
       FROM tax_installments i
       JOIN tax_agreements a ON a.id = i.agreement_id
       JOIN company_entities e ON e.id = a.entity_id
      WHERE i.id = $1 AND i.group_id = $2
      ${lock ? "FOR UPDATE OF i" : ""}`,
    [String(installmentId || ""), groupId]
  );
  if (!result.rows[0]) {
    logIsolationMiss({ table: "tax_installments", id: installmentId });
    throw httpError(404, "Parcela não encontrada", "NOT_FOUND");
  }
  return result.rows[0];
}

async function currentGuide(client, installmentId, { lock = false } = {}) {
  const result = await client.query(
    `SELECT ${guideColumns()} FROM tax_installment_guides
      WHERE installment_id = $1 AND encerrada_em IS NULL
      ${lock ? "FOR UPDATE" : ""}`,
    [installmentId]
  );
  return result.rows[0] || null;
}

function noGuideError() {
  return httpError(404, "Esta parcela não tem guia anexada.", "TAX_GUIDE_NOT_FOUND");
}

/** Guia como a tela recebe. `installment` traz ao menos agreement_id e valor (o valor cadastrado, estimado). */
export function presentGuide(row, installment) {
  if (!row) return null;
  return {
    id: row.id,
    installment_id: row.installment_id,
    agreement_id: installment?.agreement_id ?? null,
    origem: row.origem,
    linha_fonte: row.linha_fonte,
    linha_digitavel: row.linha_digitavel,
    linha_digitavel_formatada: formatGuideLine(row.linha_digitavel),
    codigo_barras: row.codigo_barras,
    valor_guia: row.valor_guia,
    pagar_ate: row.pagar_ate,
    cnpj_guia: row.cnpj_guia,
    situacao: row.situacao,
    situacao_label: GUIDE_STATUS_LABELS[row.situacao] || row.situacao,
    motivos: Array.isArray(row.motivos) ? row.motivos : [],
    tem_arquivo: Boolean(row.arquivo_chave),
    arquivo_nome: row.arquivo_nome,
    arquivo_tamanho: row.arquivo_tamanho,
    valor_estimado: installment?.valor ?? null,
    valor_a_pagar: amountToPay(row),
    verificada_em: row.verificada_em,
    criada_por: row.created_by,
    criada_por_nome: row.created_by_name,
    atualizada_por: row.updated_by,
    created_date: row.created_date,
    updated_date: row.updated_date,
    encerrada_em: row.encerrada_em,
    encerrada_por: row.encerrada_por,
    motivo_encerramento: row.motivo_encerramento,
  };
}

/** Guia atual e guias anteriores (substituídas ou removidas) de uma parcela. */
export async function getInstallmentGuide(installmentId) {
  const groupId = requireTenantContext();
  const ctx = await loadInstallmentContext(pool, installmentId, groupId);
  const result = await pool.query(
    `SELECT ${guideColumns()} FROM tax_installment_guides
      WHERE installment_id = $1 AND group_id = $2
      ORDER BY (encerrada_em IS NULL) DESC, created_date DESC`,
    [ctx.id, groupId]
  );
  const [first, ...rest] = result.rows;
  const current = first && !first.encerrada_em ? first : null;
  const history = current ? rest : result.rows;
  return {
    parcela: {
      id: ctx.id,
      agreement_id: ctx.agreement_id,
      numero_parcela: ctx.numero_parcela,
      vencimento: ctx.vencimento,
      valor: ctx.valor,
      situacao: ctx.situacao,
      data_pagamento: ctx.data_pagamento,
      valor_pago: ctx.valor_pago,
      // "protheus" = pagamento registrado pela baixa do título de tributo no Protheus; null = registrado à mão.
      pagamento_origem: ctx.pagamento_origem,
      pagamento_registrado_em: ctx.pagamento_registrado_em,
    },
    guia: presentGuide(current, ctx),
    historico: history.map((row) => presentGuide(row, ctx)),
  };
}

/**
 * Guias atuais do grupo (ou de um parcelamento), uma por parcela — para a lista e a Visão geral mostrarem
 * situação da guia e valor a pagar sem uma chamada por parcela.
 */
export async function listCurrentGuides({ agreementId } = {}) {
  const groupId = requireTenantContext();
  const params = [groupId];
  let filter = "";
  if (!isBlank(agreementId)) {
    const agreement = await pool.query(`SELECT id FROM tax_agreements WHERE id = $1 AND group_id = $2`, [String(agreementId), groupId]);
    if (!agreement.rows[0]) {
      logIsolationMiss({ table: "tax_agreements", id: agreementId });
      throw httpError(404, "Parcelamento não encontrado", "NOT_FOUND");
    }
    params.push(String(agreementId));
    filter = "AND i.agreement_id = $2";
  }
  const result = await pool.query(
    `SELECT ${guideColumns("g")}, i.agreement_id, i.valor::float8 AS valor_parcela
       FROM tax_installment_guides g
       JOIN tax_installments i ON i.id = g.installment_id
      WHERE g.group_id = $1 AND g.encerrada_em IS NULL ${filter}
      ORDER BY i.agreement_id, i.numero_parcela`,
    params
  );
  return result.rows.map((row) => presentGuide(row, { agreement_id: row.agreement_id, valor: row.valor_parcela }));
}

// ---------------------------------------------------------------------------
// Regra de exceção
// ---------------------------------------------------------------------------

async function lockBarcodes(client, groupId, barcodes) {
  const keys = [...new Set(barcodes.filter(Boolean))].sort();
  for (const barcode of keys) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`tax-guide:${groupId}:${barcode}`]);
  }
}

// Outras parcelas do grupo com guia atual de mesmo código de barras.
async function findPeers(client, groupId, barcode, installmentId) {
  if (!barcode) return [];
  const result = await client.query(
    `SELECT i.id AS installment_id, i.numero_parcela, a.codigo_parcelamento, a.orgao
       FROM tax_installment_guides g
       JOIN tax_installments i ON i.id = g.installment_id
       JOIN tax_agreements a ON a.id = i.agreement_id
      WHERE g.group_id = $1 AND g.codigo_barras = $2 AND g.encerrada_em IS NULL AND g.installment_id <> $3
      ORDER BY a.codigo_parcelamento, i.numero_parcela`,
    [groupId, barcode, installmentId]
  );
  return result.rows;
}

async function evaluate(client, ctx, facts) {
  const peers = await findPeers(client, ctx.group_id, facts.codigo_barras, ctx.id);
  const motivos = guideExceptionReasons({
    barcode: facts.codigo_barras,
    readFailure: facts.falha_leitura,
    guideCnpj: facts.cnpj_guia,
    companyCnpj: ctx.document_number,
    payBy: facts.pagar_ate,
    dueDate: ctx.vencimento,
    peers,
  });
  return { situacao: guideStatusFor(motivos), motivos };
}

async function reevaluateGuide(client, guide, ctx) {
  const { situacao, motivos } = await evaluate(client, ctx, guide);
  const result = await client.query(
    `UPDATE tax_installment_guides
        SET situacao = $2, motivos = $3::jsonb, verificada_em = now()
      WHERE id = $1 AND encerrada_em IS NULL
      RETURNING ${guideColumns()}`,
    [guide.id, situacao, JSON.stringify(motivos)]
  );
  return result.rows[0] || guide;
}

// Guias de outras parcelas que compartilham (ou compartilhavam) o código de barras: a duplicidade delas pode ter
// começado ou acabado. Os códigos já precisam estar travados por quem chama. Devolve as parcelas conferidas.
async function reevaluateBarcodes(client, groupId, barcodes, { exceptGuideId = null } = {}) {
  const installments = [];
  for (const barcode of [...new Set(barcodes.filter(Boolean))]) {
    const result = await client.query(
      `SELECT ${guideColumns()} FROM tax_installment_guides
        WHERE group_id = $1 AND codigo_barras = $2 AND encerrada_em IS NULL AND id IS DISTINCT FROM $3
        FOR UPDATE`,
      [groupId, barcode, exceptGuideId]
    );
    for (const guide of result.rows) {
      const ctx = await loadInstallmentContext(client, guide.installment_id, groupId);
      await reevaluateGuide(client, guide, ctx);
      installments.push(guide.installment_id);
    }
  }
  return installments;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

function parseLineOrThrow(value) {
  const parsed = parseGuideLine(value);
  if (!parsed.ok) throw validationError("linha_digitavel", parsed.message);
  return parsed;
}

function lineFacts(parsed, source) {
  return {
    linha_fonte: source,
    falha_leitura: null,
    linha_digitavel: parsed.line,
    codigo_barras: parsed.barcode,
    valor_guia: parsed.value,
  };
}

function validateGuideFile(file) {
  if (!file.buffer?.length) throw httpError(400, "O arquivo da guia está vazio.", "VALIDATION");
  if (!isPdf(file.buffer)) throw httpError(400, "A guia precisa ser um arquivo PDF.", "INVALID_FILE");
}

// Nome guardado só para o download: sem caminho, sem caractere de controle, e sempre terminando em ".pdf".
function safeFileName(name, fallback) {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f"]/g, "").trim().slice(0, 150);
  if (!base) return fallback;
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

async function factsFromInput(body, file) {
  const payBy = "pagar_ate" in body ? parseDate("pagar_ate", body.pagar_ate) : null;
  if (file) {
    if (!isBlank(body.linha_digitavel)) {
      throw validationError(
        "linha_digitavel",
        "Anexe o PDF ou informe a linha digitável, não os dois. Se o PDF não puder ser lido, você poderá informar a linha depois."
      );
    }
    validateGuideFile(file);
    const read = await readGuidePdf(file.buffer);
    const parsed = read.barcode ? parseGuideLine(read.barcode) : null;
    return {
      origem: "pdf",
      ...(parsed?.ok
        ? lineFacts(parsed, "pdf")
        : { linha_fonte: null, falha_leitura: read.failure, linha_digitavel: null, codigo_barras: null, valor_guia: null }),
      pagar_ate: payBy ?? read.fields.pagarAte,
      cnpj_guia: read.fields.cnpj,
    };
  }
  if (isBlank(body.linha_digitavel)) {
    throw validationError("linha_digitavel", "Anexe o PDF da guia ou informe a linha digitável.");
  }
  return { origem: "digitada", ...lineFacts(parseLineOrThrow(body.linha_digitavel), "digitada"), pagar_ate: payBy, cnpj_guia: null };
}

function mapGuideDbError(error) {
  if (error?.code === "23505" && error.constraint === "tax_installment_guides_current_uidx") {
    return httpError(409, "Esta parcela já tem uma guia. Para trocar, confirme a substituição.", "TAX_GUIDE_EXISTS");
  }
  if (error?.code === "23503") return httpError(404, "Parcela não encontrada", "NOT_FOUND");
  return error;
}

// ---------------------------------------------------------------------------
// Anexar, substituir, corrigir, remover
// ---------------------------------------------------------------------------

/**
 * Anexa a guia da parcela: PDF (campo "file") ou linha digitável. Com guia atual, só substitui com `substituir`.
 * @returns {Promise<{ ctx: object, guide: object, replaced: object|null }>}
 */
export async function attachGuide(installmentId, { body = {}, file = null, user } = {}) {
  const groupId = requireTenantContext();
  const replace = isTruthy(body.substituir);

  // Conferência antecipada (sem lock) para não ler nem gravar o PDF à toa; a definitiva é na transação.
  const preview = await loadInstallmentContext(pool, installmentId, groupId);
  if (!replace && (await currentGuide(pool, preview.id))) {
    throw httpError(409, "Esta parcela já tem uma guia. Para trocar, confirme a substituição.", "TAX_GUIDE_EXISTS");
  }

  const facts = await factsFromInput(body, file);
  const guideId = randomUUID();
  let stored = null;
  if (file) {
    stored = await guideFiles.save(`${guideId}/guia-${randomUUID()}.pdf`, file.buffer);
  }

  try {
    return await inTransaction(async (client) => {
      const ctx = await loadInstallmentContext(client, installmentId, groupId, { lock: true });
      const peek = await currentGuide(client, ctx.id);
      if (peek && !replace) {
        throw httpError(409, "Esta parcela já tem uma guia. Para trocar, confirme a substituição.", "TAX_GUIDE_EXISTS");
      }
      await lockBarcodes(client, groupId, [peek?.codigo_barras, facts.codigo_barras]);
      const current = peek ? await currentGuide(client, ctx.id, { lock: true }) : null;

      let replaced = null;
      if (current) {
        const ended = await client.query(
          `UPDATE tax_installment_guides
              SET encerrada_em = now(), encerrada_por = $2, motivo_encerramento = 'substituida',
                  updated_date = now(), updated_by = $2
            WHERE id = $1
            RETURNING ${guideColumns()}`,
          [current.id, user?.email || null]
        );
        replaced = ended.rows[0];
      }

      const { situacao, motivos } = await evaluate(client, ctx, facts);
      const inserted = await client.query(
        `INSERT INTO tax_installment_guides
           (id, group_id, installment_id, origem, linha_fonte, falha_leitura, linha_digitavel, codigo_barras, valor_guia,
            pagar_ate, cnpj_guia, arquivo_chave, arquivo_nome, arquivo_tamanho, situacao, motivos, created_by,
            created_by_name, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$17)
         RETURNING ${guideColumns()}`,
        [
          guideId, groupId, ctx.id, facts.origem, facts.linha_fonte, facts.falha_leitura, facts.linha_digitavel,
          facts.codigo_barras, facts.valor_guia, facts.pagar_ate, facts.cnpj_guia, stored?.key || null,
          file ? safeFileName(file.originalname, `guia-parcela-${ctx.numero_parcela}.pdf`) : null,
          stored?.size ?? null, situacao, JSON.stringify(motivos), user?.email || null, user?.full_name || null,
        ]
      );
      const peers = await reevaluateBarcodes(client, groupId, [facts.codigo_barras, current?.codigo_barras], { exceptGuideId: guideId });
      return { ctx, guide: presentGuide(inserted.rows[0], ctx), replaced: presentGuide(replaced, ctx), afetadas: [ctx.id, ...peers] };
    });
  } catch (error) {
    if (stored) await guideFiles.remove(stored.key);
    throw mapGuideDbError(error);
  }
}

/**
 * Corrige a guia atual: linha digitável informada à mão (quando o PDF não foi lido) e/ou "pagar até".
 * @returns {Promise<{ ctx: object, before: object, guide: object }>}
 */
export async function correctGuide(installmentId, body = {}, user) {
  const groupId = requireTenantContext();
  const hasLine = Object.prototype.hasOwnProperty.call(body, "linha_digitavel");
  const hasPayBy = Object.prototype.hasOwnProperty.call(body, "pagar_ate");
  if (!hasLine && !hasPayBy) {
    throw validationError("linha_digitavel", "Informe a linha digitável ou o \"pagar até\" da guia.");
  }
  const parsed = hasLine ? parseLineOrThrow(body.linha_digitavel) : null;
  const payBy = hasPayBy ? parseDate("pagar_ate", body.pagar_ate) : undefined;

  return inTransaction(async (client) => {
    const ctx = await loadInstallmentContext(client, installmentId, groupId, { lock: true });
    const peek = await currentGuide(client, ctx.id);
    if (!peek) throw noGuideError();
    // A linha lida do PDF é a do documento anexado: trocá-la à mão faria o e-mail levar um PDF com outra linha.
    if (parsed && peek.linha_fonte === "pdf" && parsed.barcode !== peek.codigo_barras) {
      throw httpError(
        409,
        "A linha digitável desta guia foi lida do PDF anexado e não pode ser trocada à mão. Se a guia estiver errada, substitua o PDF.",
        "TAX_GUIDE_LINE_FROM_PDF"
      );
    }
    await lockBarcodes(client, groupId, [peek.codigo_barras, parsed?.barcode]);
    const current = await currentGuide(client, ctx.id, { lock: true });
    const next = {
      ...current,
      ...(parsed && current.linha_fonte !== "pdf" ? lineFacts(parsed, "digitada") : {}),
      ...(hasPayBy ? { pagar_ate: payBy } : {}),
    };
    const { situacao, motivos } = await evaluate(client, ctx, next);
    const updated = await client.query(
      `UPDATE tax_installment_guides
          SET linha_fonte = $2, falha_leitura = $3, linha_digitavel = $4, codigo_barras = $5, valor_guia = $6,
              pagar_ate = $7, situacao = $8, motivos = $9::jsonb, verificada_em = now(), updated_date = now(),
              updated_by = $10
        WHERE id = $1
        RETURNING ${guideColumns()}`,
      [
        current.id, next.linha_fonte, next.falha_leitura, next.linha_digitavel, next.codigo_barras, next.valor_guia,
        next.pagar_ate, situacao, JSON.stringify(motivos), user?.email || null,
      ]
    );
    const peers = await reevaluateBarcodes(client, groupId, [current.codigo_barras, next.codigo_barras], { exceptGuideId: current.id });
    return { ctx, before: presentGuide(current, ctx), guide: presentGuide(updated.rows[0], ctx), afetadas: [ctx.id, ...peers] };
  });
}

/**
 * Remove a guia atual da parcela. A linha fica no histórico (encerrada como "removida"), com o PDF, porque um
 * envio por e-mail já feito aponta para ela.
 * @returns {Promise<{ ctx: object, before: object }>}
 */
export async function removeGuide(installmentId, user) {
  const groupId = requireTenantContext();
  return inTransaction(async (client) => {
    const ctx = await loadInstallmentContext(client, installmentId, groupId, { lock: true });
    const peek = await currentGuide(client, ctx.id);
    if (!peek) throw noGuideError();
    await lockBarcodes(client, groupId, [peek.codigo_barras]);
    const current = await currentGuide(client, ctx.id, { lock: true });
    await client.query(
      `UPDATE tax_installment_guides
          SET encerrada_em = now(), encerrada_por = $2, motivo_encerramento = 'removida', updated_date = now(), updated_by = $2
        WHERE id = $1`,
      [current.id, user?.email || null]
    );
    const peers = await reevaluateBarcodes(client, groupId, [current.codigo_barras], { exceptGuideId: current.id });
    return { ctx, before: presentGuide(current, ctx), afetadas: [ctx.id, ...peers] };
  });
}

/**
 * Verifica de novo a guia atual da parcela (ex.: o vencimento da parcela mudou). Sem guia, não faz nada.
 */
export async function refreshInstallmentGuide(installmentId) {
  const groupId = requireTenantContext();
  await inTransaction(async (client) => {
    const ctx = await loadInstallmentContext(client, installmentId, groupId, { lock: true });
    const peek = await currentGuide(client, ctx.id);
    if (!peek) return;
    await lockBarcodes(client, groupId, [peek.codigo_barras]);
    const current = await currentGuide(client, ctx.id, { lock: true });
    await reevaluateGuide(client, current, ctx);
  });
}

/**
 * Depois da exclusão de parcelas (ver collectGuidesForDeletion): apaga os PDFs que saíram com elas e verifica de
 * novo as guias de outras parcelas que tinham o mesmo código de barras. Nada aqui desfaz a exclusão.
 * @returns {Promise<string[]>} parcelas cujas guias foram conferidas de novo
 */
export async function afterGuidesDeleted(collected) {
  if (!collected) return [];
  for (const key of collected.fileKeys) await guideFiles.remove(key);
  if (!collected.barcodes.length) return [];
  let peers = [];
  try {
    await inTransaction(async (client) => {
      await lockBarcodes(client, collected.groupId, collected.barcodes);
      peers = await reevaluateBarcodes(client, collected.groupId, collected.barcodes);
    });
  } catch (error) {
    logger.error({ err: error, groupId: collected.groupId }, "falha ao verificar de novo guias após exclusão de parcela");
  }
  return peers;
}

// ---------------------------------------------------------------------------
// Download do PDF
// ---------------------------------------------------------------------------

export async function getGuideFile(guideId) {
  const groupId = requireTenantContext();
  const result = await pool.query(
    `SELECT g.arquivo_chave, g.arquivo_nome, i.numero_parcela
       FROM tax_installment_guides g JOIN tax_installments i ON i.id = g.installment_id
      WHERE g.id = $1 AND g.group_id = $2`,
    [String(guideId || ""), groupId]
  );
  const row = result.rows[0];
  if (!row) {
    logIsolationMiss({ table: "tax_installment_guides", id: guideId });
    throw httpError(404, "Guia não encontrada", "NOT_FOUND");
  }
  if (!row.arquivo_chave) {
    throw httpError(404, "Esta guia não tem PDF: ela foi informada pela linha digitável.", "FILE_NOT_FOUND");
  }
  if (!(await guideFiles.exists(row.arquivo_chave))) {
    throw httpError(404, "O PDF da guia não foi encontrado no servidor. Anexe a guia de novo.", "FILE_NOT_FOUND");
  }
  return {
    path: guideFiles.resolve(row.arquivo_chave),
    fileName: row.arquivo_nome || `guia-parcela-${row.numero_parcela}.pdf`,
  };
}

// ---------------------------------------------------------------------------
// Envio por e-mail
// ---------------------------------------------------------------------------

const sendSchema = z.object({
  destinatarios: z.preprocess(
    (value) => (typeof value === "string" ? value.split(/[,;\s]+/) : value),
    z.array(z.string({ invalid_type_error: "Informe os e-mails dos destinatários." }), {
      required_error: "Informe ao menos um e-mail de destinatário.",
      invalid_type_error: "Informe os e-mails dos destinatários.",
    })
  ).transform((list) => {
    const seen = new Set();
    return list.map((item) => item.trim()).filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }).superRefine((list, ctx) => {
    if (!list.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe ao menos um e-mail de destinatário." });
      return;
    }
    if (list.length > MAX_RECIPIENTS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Informe no máximo ${MAX_RECIPIENTS} destinatários.` });
      return;
    }
    const invalid = list.filter((item) => item.length > 254 || !z.string().email().safeParse(item).success);
    if (invalid.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: invalid.length === 1
          ? `"${invalid[0]}" não é um e-mail válido. Confira o endereço.`
          : `Estes endereços não são e-mails válidos: ${invalid.map((item) => `"${item}"`).join(", ")}. Confira os endereços.`,
      });
    }
  }),
  mensagem: z.preprocess(
    (value) => (value === null || (typeof value === "string" && value.trim() === "") ? undefined : value),
    z.string({ invalid_type_error: "A mensagem precisa ser um texto." })
      .trim()
      .max(MESSAGE_MAX, `A mensagem pode ter no máximo ${MESSAGE_MAX} caracteres.`)
      .optional()
  ),
});

function parseSendInput(body) {
  const parsed = sendSchema.safeParse(body || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw httpError(400, issue?.message || "Dados de envio inválidos.", "VALIDATION", { field: issue?.path?.[0] || null });
  }
  return parsed.data;
}

const SMTP_NOT_CONFIGURED = "SMTP não configurado";

function listLabel(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

// O texto do servidor de e-mail fica só no banco e no log: a tela recebe o resultado em português comum.
function sendResultMessage(row) {
  if (row.resultado === "enviado") return "E-mail enviado.";
  if (row.resultado === "parcial") {
    return `E-mail enviado só para parte dos destinatários. O servidor de e-mail recusou ${listLabel(row.recusados || [])}.`;
  }
  if (row.erro === SMTP_NOT_CONFIGURED) return "Não enviado: o envio de e-mail não está configurado no sistema.";
  if (row.recusados?.length) return `Não enviado: o servidor de e-mail recusou ${listLabel(row.recusados)}.`;
  return "Não enviado: o servidor de e-mail não aceitou a mensagem.";
}

function presentSend(row) {
  if (!row) return null;
  return {
    id: row.id,
    guide_id: row.guide_id,
    installment_id: row.installment_id,
    destinatarios: row.destinatarios,
    recusados: row.recusados,
    assunto: row.assunto,
    mensagem: row.mensagem,
    com_anexo: row.com_anexo,
    resultado: row.resultado,
    mensagem_resultado: sendResultMessage(row),
    enviado_por: row.enviado_por,
    enviado_por_nome: row.enviado_por_nome,
    created_date: row.created_date,
    linha_digitavel_formatada: formatGuideLine(row.linha_digitavel ?? null),
  };
}

async function insertSend(record) {
  const result = await pool.query(
    `INSERT INTO tax_guide_sends
       (id, group_id, guide_id, installment_id, destinatarios, recusados, assunto, mensagem, com_anexo, resultado, erro,
        enviado_por, enviado_por_nome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      randomUUID(), record.groupId, record.guideId, record.installmentId, record.recipients, record.rejected,
      record.subject, record.message || null, record.withAttachment, record.result,
      record.error ? String(record.error).slice(0, 2000) : null, record.user?.email || null, record.user?.full_name || null,
    ]
  );
  return result.rows[0];
}

// Guia atual conferida de novo, sob lock, na hora do envio: o que valeu ao anexar pode ter mudado (outra parcela
// recebeu a mesma guia, o vencimento da parcela foi alterado...). A conferência fica gravada mesmo quando o envio
// é recusado.
async function guideReadyToSend(installmentId, groupId) {
  const checked = await inTransaction(async (client) => {
    const ctx = await loadInstallmentContext(client, installmentId, groupId, { lock: true });
    const peek = await currentGuide(client, ctx.id);
    if (!peek) throw httpError(404, "Esta parcela não tem guia anexada. Anexe a guia antes de enviar.", "TAX_GUIDE_NOT_FOUND");
    await lockBarcodes(client, groupId, [peek.codigo_barras]);
    const current = await currentGuide(client, ctx.id, { lock: true });
    return { ctx, guide: await reevaluateGuide(client, current, ctx) };
  });
  const closed = CLOSED_INSTALLMENT_MESSAGES[checked.ctx.situacao];
  if (closed) throw httpError(409, closed, "TAX_INSTALLMENT_CLOSED");
  if (checked.guide.situacao !== GUIDE_STATUSES.vinculada) {
    const reasons = Array.isArray(checked.guide.motivos) ? checked.guide.motivos : [];
    throw httpError(
      409,
      `Esta guia está em exceção e não pode ser enviada. ${reasons.map((item) => item.mensagem).join(" ")} Corrija ou substitua a guia antes de enviar.`,
      "TAX_GUIDE_EXCEPTION",
      { motivos: reasons }
    );
  }
  return checked;
}

async function guideAttachment(guide, ctx) {
  if (!guide.arquivo_chave) return null;
  if (!(await guideFiles.exists(guide.arquivo_chave))) {
    throw httpError(409, "O PDF desta guia não foi encontrado no servidor. Anexe a guia de novo antes de enviar.", "TAX_GUIDE_FILE_MISSING");
  }
  return {
    filename: guide.arquivo_nome || `guia-parcela-${ctx.numero_parcela}.pdf`,
    content: await fs.readFile(guideFiles.resolve(guide.arquivo_chave)),
    contentType: "application/pdf",
  };
}

function sendOutcome(outcome, recipients) {
  if (!outcome.sent && !outcome.error) {
    return {
      result: "falhou",
      detail: SMTP_NOT_CONFIGURED,
      error: httpError(503, "O envio de e-mail não está configurado no sistema, então a guia não foi enviada. Fale com o suporte.", "EMAIL_NOT_CONFIGURED"),
    };
  }
  const rejected = outcome.rejected || [];
  if (!outcome.sent) {
    const allRejected = rejected.length > 0 && rejected.length >= recipients.length;
    return {
      result: "falhou",
      detail: outcome.error,
      error: httpError(
        502,
        allRejected
          ? `O servidor de e-mail recusou ${rejected.length === 1 ? "o endereço" : "os endereços"} ${listLabel(rejected)}. A guia não foi enviada. Confira os endereços.`
          : "Não foi possível enviar o e-mail agora. A guia não foi enviada. Tente novamente em alguns minutos.",
        "EMAIL_SEND_FAILED"
      ),
    };
  }
  if (rejected.length) {
    const accepted = recipients.filter((item) => !rejected.some((r) => r.toLowerCase() === item.toLowerCase()));
    return {
      result: "parcial",
      detail: `recusados pelo servidor: ${rejected.join(", ")}`,
      error: httpError(
        502,
        `A guia foi enviada para ${listLabel(accepted)}, mas o servidor de e-mail recusou ${listLabel(rejected)}. Confira ${rejected.length === 1 ? "esse endereço e envie de novo só para ele" : "esses endereços e envie de novo só para eles"}.`,
        "EMAIL_SEND_PARTIAL"
      ),
    };
  }
  return { result: "enviado", detail: null, error: null };
}

const RETRY_TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

// Tentativas registradas do usuário na última hora (enviadas, parciais e falhas). Bloqueio por guia em exceção não
// é registrado e não conta.
async function assertSendQuota(user) {
  const sender = user?.email || null;
  if (!sender) return;
  const result = await pool.query(
    `SELECT count(*)::int AS total, min(created_date) AS oldest
       FROM tax_guide_sends
      WHERE enviado_por = $1 AND created_date > now() - interval '1 hour'`,
    [sender]
  );
  const { total, oldest } = result.rows[0];
  if (total < MAX_SENDS_PER_HOUR) return;
  const retryAt = new Date(new Date(oldest).getTime() + 60 * 60 * 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000));
  throw httpError(
    429,
    `Você chegou ao limite de ${MAX_SENDS_PER_HOUR} envios de guia por e-mail em uma hora. Tente de novo a partir das ${RETRY_TIME.format(retryAt)}.`,
    "TAX_GUIDE_SEND_LIMIT",
    { tentar_apos: retryAt.toISOString(), retry_after_seconds: retryAfterSeconds }
  );
}

/**
 * Envia a guia atual da parcela por e-mail. Guia em exceção, parcela paga ou cancelada: recusado antes de enviar.
 * Falha do envio é registrada no histórico e devolvida em `error` (quem chama audita e lança).
 * @returns {Promise<{ ctx: object, guide: object, send: object|null, error: Error|null }>}
 */
export async function sendGuideEmail(installmentId, body, user) {
  const input = parseSendInput(body);
  const groupId = requireTenantContext();
  await assertSendQuota(user);
  const { ctx, guide } = await guideReadyToSend(installmentId, groupId);
  const attachment = await guideAttachment(guide, ctx);
  const email = buildGuideEmail({ ctx, guide, message: input.mensagem, sender: user });

  const outcome = await sendMail({
    to: input.destinatarios,
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments: attachment ? [attachment] : undefined,
    replyTo: user?.email || undefined,
  });
  const { result, detail, error } = sendOutcome(outcome, input.destinatarios);

  let send = null;
  try {
    send = await insertSend({
      groupId,
      guideId: guide.id,
      installmentId: ctx.id,
      recipients: input.destinatarios,
      rejected: outcome.rejected || [],
      subject: email.subject,
      message: input.mensagem,
      withAttachment: Boolean(attachment),
      result,
      error: detail,
      user,
    });
    send.linha_digitavel = guide.linha_digitavel;
  } catch (recordError) {
    logger.error({ err: recordError, installmentId: ctx.id, result }, "falha ao registrar envio da guia por e-mail");
    if (result !== "falhou") {
      // O e-mail saiu: dizer "tente novamente" faria a guia chegar duas vezes.
      const err = httpError(500, "O e-mail foi enviado, mas não conseguimos registrar o envio no histórico. Não é preciso reenviar.", "EMAIL_SENT_NOT_RECORDED");
      err.expose = true;
      return { ctx, guide: presentGuide(guide, ctx), send: null, error: error || err };
    }
  }
  if (error) error.expose = true;
  return { ctx, guide: presentGuide(guide, ctx), send: presentSend(send), error };
}

/** Histórico de envios por e-mail das guias de uma parcela (inclusive de guias já substituídas). */
export async function listGuideSends(installmentId) {
  const groupId = requireTenantContext();
  const ctx = await loadInstallmentContext(pool, installmentId, groupId);
  const result = await pool.query(
    `SELECT s.*, g.linha_digitavel
       FROM tax_guide_sends s JOIN tax_installment_guides g ON g.id = s.guide_id
      WHERE s.installment_id = $1 AND s.group_id = $2
      ORDER BY s.created_date DESC`,
    [ctx.id, groupId]
  );
  return result.rows.map(presentSend);
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

export function guideAuditRecord(ctx) {
  return `Guia da parcela ${ctx.numero_parcela} — vencimento ${civilDateLabel(ctx.vencimento)} — parcelamento ${ctx.codigo_parcelamento}`;
}

/** O que a tela de auditoria mostra de uma guia: rótulos que o usuário conhece, sem chave de arquivo. */
export function guideAuditSnapshot(guide) {
  if (!guide) return null;
  return {
    situacao: guide.situacao_label,
    motivos: guide.motivos.length ? guide.motivos.map((item) => item.mensagem).join(" ") : null,
    origem: guide.origem === "pdf" ? "PDF anexado" : "Linha digitada",
    linha_digitavel: guide.linha_digitavel_formatada,
    valor_guia: guide.valor_guia,
    pagar_ate: civilDateLabel(guide.pagar_ate),
    arquivo: guide.arquivo_nome,
  };
}
