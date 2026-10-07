import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { writeAudit } from "../../middleware/audit.js";
import { fetchSm0Records, matchSm0ByEntity, resolveTitleBranch } from "../integrations/protheusScope.js";
import { resolveParameter } from "../parameters/service.js";
import { resolveNatureForEntity } from "../payables/natureCode.js";
import { getTenantScope } from "../tenants/access.js";
import { logIsolationMiss, requireTenantContext } from "../tenants/scope.js";
import { civilDateLabel } from "./guideRules.js";
import { resolveTaxSupplier } from "./taxSupplier.js";
import { TAX_SUPPLIERS_PARAMETER, pickTaxSupplier } from "./taxSupplierConfig.js";
import { TAX_TITLE_NATURE_PARAMETER, TAX_TITLE_PREFIX_PARAMETER, TAX_TITLE_TYPE_PARAMETER } from "./taxTitleConfig.js";
import { consultTitle, includeTitle, loadTaxTitleEndpoints, reverseTitle } from "./taxTitleErp.js";

// Título a pagar da parcela de tributo no Protheus. Nasce quando a guia da parcela fica vinculada (valor e código de
// barras da guia) e segue a guia até ser pago: guia trocada → estorna e envia de novo; guia removida, em exceção,
// parcela cancelada ou parcelamento rescindido → estorna. Pago (baixado) no Protheus, não muda mais.
//
// Caminho rígido: só vale o que o Protheus confirmar (taxTitleErp.js). Envio sem confirmação fica "incerto" e só é
// repetido depois de uma consulta provar que o título não existe; estorno sempre consulta antes; "não encontrado"
// nunca apaga nada — vira "conferencia" para alguém olhar. Uma operação por título de cada vez (trava com prazo).
// A parcela não muda por aqui.

export const TITLE_STATUS_LABELS = {
  pendente: "Pendente",
  incerto: "Envio sem confirmação",
  recusado: "Recusado pelo Protheus",
  enviado: "Integrado",
  estornado: "Estornado",
  baixado: "Baixado",
  parcial: "Baixado parcialmente",
  conferencia: "Precisa de conferência",
};

const LEASE_MINUTES = 5;
/**
 * Baixa sem data no Protheus: por quantos dias, desde a primeira vez, o agendador volta a consultar o título para
 * tentar registrar o pagamento na parcela. Uma semana cobre a correção do lançamento no Protheus sem deixar o título
 * na fila do agendador para sempre; consultar pela tela continua tentando.
 */
export const UNDATED_BAIXA_RETRY_DAYS = 7;
const MAX_STEPS = 4;
const PAID_INSTALLMENT_STATUSES = new Set(["paga_aguardando_reconhecimento", "reconhecida"]);
const FROZEN = new Set(["baixado", "parcial"]);
const OUT_OF_ERP = new Set(["pendente", "estornado"]);
const SETTINGS_PLACE = "Configurações > Lógica Contábil";
// Prefixos que a geração dos títulos de empréstimo usa (payables/generate.js).
const LOAN_FIXED_PREFIXES = new Set(["EMP", "FIN", "JUR", "IOF"]);

/** O prefixo é dos títulos de empréstimo (fixos ou já gravado em algum título a pagar do cliente)? */
export async function loanPrefixInUse(groupId, prefixo) {
  const code = String(prefixo || "").trim().toUpperCase();
  if (!code) return false;
  if (LOAN_FIXED_PREFIXES.has(code)) return true;
  const result = await pool.query(
    `SELECT 1 FROM payable_titles WHERE group_id = $1 AND upper(btrim(prefixo)) = $2 LIMIT 1`,
    [groupId, code]
  );
  return Boolean(result.rows[0]);
}

function httpError(status, message, code, details) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  if (details) err.details = details;
  return err;
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

function sameMoney(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const TITLE_COLUMNS = `t.id, t.group_id, t.installment_id, t.numero_e2, t.parcela_e2, t.situacao, t.motivo, t.guide_id,
  t.filial, t.fil_orig, t.prefixo, t.tipo, t.natureza, t.fornecedor, t.loja, t.emissao::text AS emissao,
  t.vencimento::text AS vencimento, t.valor::float8 AS valor, t.codigo_barras, t.linha_digitavel, t.historico,
  t.saldo::float8 AS saldo, t.baixa_data::text AS baixa_data, t.erp_mensagem, t.enviado_em, t.estornado_em,
  t.consultado_em, t.trava_ate, t.dados_enviados AS snapshot_enviado, t.parcela_atualizada_em, t.baixa_sem_data_desde, t.created_date, t.updated_date`;

async function loadContext(installmentId, groupId) {
  const result = await pool.query(
    `SELECT i.id, i.group_id, i.agreement_id, i.numero_parcela, i.vencimento::text AS vencimento, i.situacao,
            a.codigo_parcelamento, a.orgao, a.uf, a.esfera, a.situacao AS agreement_situacao, a.entity_id,
            e.id AS e_id, e.group_id AS e_group_id, e.entity_name, e.document_number, e.codigo_empresa,
            e.codigo_filial, e.implantacao_pendente,
            g.id AS guide_id, g.situacao AS guide_situacao, g.valor_guia::float8 AS valor_guia,
            g.pagar_ate::text AS pagar_ate, g.codigo_barras, g.linha_digitavel
       FROM tax_installments i
       JOIN tax_agreements a ON a.id = i.agreement_id
       JOIN company_entities e ON e.id = a.entity_id
       LEFT JOIN tax_installment_guides g ON g.installment_id = i.id AND g.encerrada_em IS NULL
      WHERE i.id = $1 AND i.group_id = $2`,
    [String(installmentId || ""), groupId]
  );
  if (!result.rows[0]) {
    logIsolationMiss({ table: "tax_installments", id: installmentId });
    throw httpError(404, "Parcela não encontrada", "NOT_FOUND");
  }
  return result.rows[0];
}

async function findTitle(installmentId, groupId) {
  const result = await pool.query(
    `SELECT ${TITLE_COLUMNS} FROM tax_payable_titles t WHERE t.installment_id = $1 AND t.group_id = $2`,
    [installmentId, groupId]
  );
  return result.rows[0] || null;
}

async function loadTitle(id, groupId) {
  const result = await pool.query(`SELECT ${TITLE_COLUMNS} FROM tax_payable_titles t WHERE t.id = $1 AND t.group_id = $2`, [id, groupId]);
  return result.rows[0] || null;
}

function entityOf(ctx) {
  return {
    id: ctx.e_id,
    group_id: ctx.e_group_id,
    entity_name: ctx.entity_name,
    document_number: ctx.document_number,
    codigo_empresa: ctx.codigo_empresa,
    codigo_filial: ctx.codigo_filial,
  };
}

/**
 * O que o título deve ser agora, pela parcela e pela guia atual.
 * want: deve existir no Protheus com estes valores. reverse: se existir e não for o desejado, estornar.
 */
export function titleTarget(ctx) {
  if (ctx.agreement_situacao === "rescindido") return { want: false, reverse: true, motivo: "Parcelamento rescindido." };
  if (ctx.situacao === "cancelada") return { want: false, reverse: true, motivo: "Parcela cancelada." };
  if (PAID_INSTALLMENT_STATUSES.has(ctx.situacao)) {
    return { want: false, reverse: false, motivo: "Parcela registrada como paga no AllDebt: o título de tributo não é criado por aqui." };
  }
  if (!ctx.guide_id) return { want: false, reverse: true, motivo: "Parcela sem guia anexada." };
  if (ctx.guide_situacao !== "vinculada") return { want: false, reverse: true, motivo: "A guia da parcela está em exceção." };
  if (ctx.valor_guia === null || ctx.valor_guia === undefined) {
    return { want: false, reverse: true, motivo: "A guia não traz o valor a pagar." };
  }
  return {
    want: true,
    reverse: true,
    guideId: ctx.guide_id,
    valor: ctx.valor_guia,
    codigoBarras: ctx.codigo_barras,
    linhaDigitavel: ctx.linha_digitavel,
    // A guia é o documento de pagamento: com "pagar até", é ele que vale (a regra da guia já o mantém no mês do
    // vencimento da parcela); sem ele, o vencimento da parcela.
    vencimento: ctx.pagar_ate || ctx.vencimento,
  };
}

function matchesSent(row, target) {
  return target.want
    && row.guide_id === target.guideId
    && sameMoney(row.valor, target.valor)
    && row.codigo_barras === target.codigoBarras
    && row.vencimento === target.vencimento;
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

function actorEmail() {
  return getTenantScope()?.email || "sistema";
}

async function updateTitle(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((key, index) => `${key} = $${index + 2}`);
  const result = await pool.query(
    `UPDATE tax_payable_titles t SET ${sets.join(", ")}, updated_date = now(), updated_by = $${keys.length + 2}
      WHERE t.id = $1 RETURNING ${TITLE_COLUMNS}`,
    [id, ...keys.map((key) => fields[key]), actorEmail()]
  );
  return result.rows[0];
}

async function createTitle(ctx) {
  await pool.query(
    `INSERT INTO tax_payable_titles (id, group_id, installment_id, numero_e2, motivo, created_by, updated_by)
     VALUES ($1, $2, $3, lpad(nextval('tax_payable_title_number_seq')::text, 9, '0'), 'Aguardando envio ao Protheus.', $4, $4)
     ON CONFLICT (installment_id) DO NOTHING`,
    [randomUUID(), ctx.group_id, ctx.id, actorEmail()]
  );
  return findTitle(ctx.id, ctx.group_id);
}

async function acquireLease(id, token) {
  const result = await pool.query(
    `UPDATE tax_payable_titles SET trava_ate = now() + ($3::int * interval '1 minute'), trava_por = $2
      WHERE id = $1 AND (trava_ate IS NULL OR trava_ate < now())
      RETURNING id`,
    [id, token, LEASE_MINUTES]
  );
  return Boolean(result.rows[0]);
}

async function releaseLease(id, token) {
  await pool.query(`UPDATE tax_payable_titles SET trava_ate = NULL, trava_por = NULL WHERE id = $1 AND trava_por = $2`, [id, token]);
}

function busyError() {
  return httpError(409, "Outra operação com este título de tributo está em andamento. Tente de novo em instantes.", "TAX_TITLE_BUSY");
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

function auditReq(req) {
  if (req) return req;
  const scope = getTenantScope();
  return scope?.email && scope.email !== "sistema"
    ? { user: { sub: scope.userId, email: scope.email, full_name: scope.fullName } }
    : null;
}

function titleRecord(row, ctx) {
  const key = `${row.prefixo || "?"} ${row.numero_e2}/${row.parcela_e2}`;
  return ctx
    ? `Título de tributo ${key} — parcela ${ctx.numero_parcela} do parcelamento ${ctx.codigo_parcelamento}`
    : `Título de tributo ${key}`;
}

function audit(op, action, row, ctx, after) {
  const req = auditReq(op.req);
  return writeAudit({
    req,
    action,
    resourceType: "TaxPayableTitle",
    resourceId: row.id,
    rotina: "Gestão Tributária",
    registro: titleRecord(row, ctx),
    after,
    origem: req ? undefined : "automatico",
    payload: { installment_id: row.installment_id },
  });
}

// ---------------------------------------------------------------------------
// Protheus
// ---------------------------------------------------------------------------

function lookupOf(row) {
  return {
    filial: row.filial,
    filOrig: row.fil_orig || "",
    prefixo: row.prefixo,
    numero: row.numero_e2,
    parcela: row.parcela_e2,
    tipo: row.tipo,
    fornecedor: row.fornecedor,
    loja: row.loja,
    natureza: row.natureza,
    vencimento: row.vencimento,
    valor: row.valor,
  };
}

// Conexão e SM0 lidas uma vez por execução: um lote (agendador) divide entre os títulos.
function shared(op) {
  return op.batch || op;
}

async function endpointsOrNull(op) {
  const cache = shared(op);
  if (cache.endpoints) {
    op.endpoints = cache.endpoints;
    return op.endpoints;
  }
  try {
    cache.endpoints = await loadTaxTitleEndpoints();
  } catch (error) {
    op.endpointError = error?.message || "Conexão com o Protheus indisponível.";
    return null;
  }
  op.endpoints = cache.endpoints;
  return op.endpoints;
}

class LeaseLostError extends Error {}

// Renova a trava antes de cada passo que fala com o Protheus. Perdida (venceu e outra operação pegou), para aqui.
async function keepLease(op, id) {
  if (!op.token) return;
  const result = await pool.query(
    `UPDATE tax_payable_titles SET trava_ate = now() + ($3::int * interval '1 minute')
      WHERE id = $1 AND trava_por = $2 RETURNING id`,
    [id, op.token, LEASE_MINUTES]
  );
  if (!result.rows[0]) throw new LeaseLostError("trava do título perdida");
}

function keyString(lookup) {
  return [lookup.filial, lookup.prefixo, lookup.numero, lookup.parcela, lookup.tipo, lookup.fornecedor, lookup.loja].map((v) => String(v ?? "").trim()).join("|");
}

const CONSULT_SITUATION = { aberto: "enviado", parcial: "parcial", baixado: "baixado" };

async function consultStep(op, row, ctx) {
  const endpoints = await endpointsOrNull(op);
  if (!endpoints) return { result: "inconclusivo", row: await updateTitle(row.id, { erp_mensagem: op.endpointError }) };
  await keepLease(op, row.id);
  const answer = await consultTitle(endpoints, lookupOf(row));
  await audit(op, "CONSULT", row, ctx, { resultado: answer.result, mensagem: answer.message });
  if (row.snapshot_enviado === false && (answer.result === "encontrado" || answer.result === "divergente")) {
    // A chave existe no Protheus, mas o AllDebt nunca enviou este título (parou antes do envio): achar a chave não
    // prova que o título é deste parcelamento. Só sai da conferência por "confirmar ausência".
    const updated = await updateTitle(row.id, {
      situacao: "conferencia",
      consultado_em: new Date().toISOString(),
      erp_mensagem: answer.message,
      motivo: "O título com esta chave existe no Protheus, mas não foi enviado pelo AllDebt: ele não é ligado a esta parcela. Confira no Protheus.",
    });
    return { result: answer.result, row: updated };
  }
  if (answer.result === "divergente") {
    // A chave existe, mas não é o título que o AllDebt enviou (outra filial ou outro valor): ninguém mexe sozinho.
    const updated = await updateTitle(row.id, {
      situacao: "conferencia",
      motivo: `${answer.message} Confira no Protheus antes de qualquer envio ou estorno.`,
      consultado_em: new Date().toISOString(),
      erp_mensagem: answer.message,
    });
    await audit(op, "UPDATE", updated, ctx, { situacao: TITLE_STATUS_LABELS.conferencia, mensagem: updated.motivo });
    return { result: "divergente", row: updated };
  }
  if (answer.result === "encontrado") {
    const next = CONSULT_SITUATION[answer.situacao];
    if (row.parcela_atualizada_em && next !== "baixado") {
      // A baixa que registrou o pagamento da parcela foi desfeita no Protheus. A parcela não volta sozinha.
      const updated = await updateTitle(row.id, {
        situacao: "conferencia",
        saldo: answer.saldo,
        baixa_data: answer.baixa,
        consultado_em: new Date().toISOString(),
        erp_mensagem: answer.message,
        motivo: undoneBaixaMessage(ctx),
      });
      await audit(op, "UPDATE", updated, ctx, { situacao: TITLE_STATUS_LABELS.conferencia, mensagem: updated.motivo });
      return { result: "encontrado", row: updated };
    }
    return { result: "encontrado", row: await recordFound(op, row, ctx, answer, next) };
  }
  if (answer.result === "nao_encontrado") {
    return { result: "nao_encontrado", row: await updateTitle(row.id, { consultado_em: new Date().toISOString(), erp_mensagem: answer.message }) };
  }
  return { result: "inconclusivo", row: await updateTitle(row.id, { erp_mensagem: answer.message }) };
}

function undoneBaixaMessage(ctx) {
  return `A baixa deste título no Protheus foi desfeita, mas a parcela ${ctx.numero_parcela} continua registrada como paga: ela não é revertida sozinha. Confira no Protheus e corrija a parcela se for o caso.`;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Baixa total no Protheus → parcela "Paga, aguardando reconhecimento", na mesma transação do título. Só parcela "a
 * vencer/vencida" (em_aberto) — marcada à mão, fica como está —, com data de baixa conhecida e não futura (a regra
 * da parcela não aceita pagamento no futuro; volta a tentar na próxima consulta).
 * valor_pago = valor do título − saldo, os dois da consulta ao Protheus (E2_VALOR − E2_SALDO): o que a consulta
 * prova que foi baixado. Juros e multa pagos na baixa não aparecem na consulta e não entram.
 */
async function applyPayment(client, row, answer) {
  const result = await client.query(
    `SELECT id, numero_parcela, vencimento::text AS vencimento, situacao, data_pagamento::text AS data_pagamento,
            valor_pago::float8 AS valor_pago
       FROM tax_installments WHERE id = $1 AND group_id = $2 FOR UPDATE`,
    [row.installment_id, row.group_id]
  );
  const installment = result.rows[0];
  if (!installment) return { moved: false, note: null };
  if (installment.situacao !== "em_aberto") {
    return { moved: false, note: "A parcela já tinha outra situação registrada no AllDebt e não foi alterada." };
  }
  if (!answer.baixa) {
    return {
      moved: false,
      undated: true,
      note: `O Protheus não informou a data da baixa, então a parcela não foi alterada. Registre o pagamento da parcela à mão ou confira a baixa no Protheus. O agendador tenta de novo por até ${UNDATED_BAIXA_RETRY_DAYS} dias.`,
    };
  }
  if (answer.baixa > todayInSaoPaulo()) {
    return { moved: false, note: `A baixa no Protheus tem data futura (${civilDateLabel(answer.baixa)}): a parcela será atualizada quando a data chegar.` };
  }
  const paid = round2(Number(answer.valor) - Number(answer.saldo));
  if (!(paid > 0)) return { moved: false, note: "A consulta não mostra valor baixado: a parcela não foi alterada." };
  const moved = await client.query(
    `UPDATE tax_installments
        SET situacao = 'paga_aguardando_reconhecimento', data_pagamento = $3, valor_pago = $4,
            pagamento_origem = 'protheus', pagamento_titulo_id = $5, pagamento_registrado_em = now(), updated_date = now()
      WHERE id = $1 AND group_id = $2 AND situacao = 'em_aberto'
      RETURNING id`,
    [installment.id, row.group_id, answer.baixa, paid, row.id]
  );
  if (!moved.rows[0]) return { moved: false, note: null };
  await client.query(`UPDATE tax_payable_titles SET parcela_atualizada_em = now() WHERE id = $1`, [row.id]);
  return { moved: true, installment, dataPagamento: answer.baixa, valorPago: paid };
}

// Título achado na consulta: grava saldo/baixa e, se baixado, registra o pagamento na parcela — tudo junto.
async function recordFound(op, row, ctx, answer, next) {
  const client = await pool.connect();
  let applied = { moved: false, note: null };
  let updated;
  try {
    await client.query("BEGIN");
    if (next === "baixado" && !row.parcela_atualizada_em) applied = await applyPayment(client, row, answer);
    const paidMotivo = "Pago no Protheus: o título não muda mais por troca ou remoção da guia.";
    const fields = {
      situacao: next,
      saldo: answer.saldo,
      baixa_data: answer.baixa,
      consultado_em: new Date().toISOString(),
      erp_mensagem: answer.message,
      motivo: FROZEN.has(next) ? [paidMotivo, applied.moved ? "A parcela passou a paga, aguardando reconhecimento." : applied.note].filter(Boolean).join(" ") : null,
    };
    const keys = Object.keys(fields);
    const result = await client.query(
      `UPDATE tax_payable_titles t SET ${keys.map((key, i) => `${key} = $${i + 2}`).join(", ")}, updated_date = now(),
              updated_by = $${keys.length + 2}
        WHERE t.id = $1 RETURNING ${TITLE_COLUMNS}`,
      [row.id, ...keys.map((key) => fields[key]), actorEmail()]
    );
    updated = result.rows[0];
    // Desde quando a baixa veio sem data (a primeira vez vale; com data, ou fora do caso, zera).
    const undated = await client.query(
      `UPDATE tax_payable_titles t
          SET baixa_sem_data_desde = CASE WHEN $2::boolean THEN COALESCE(t.baixa_sem_data_desde, now()) ELSE NULL END
        WHERE t.id = $1 RETURNING ${TITLE_COLUMNS}`,
      [row.id, Boolean(applied.undated)]
    );
    updated = undated.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (applied.moved) {
    const req = auditReq(op.req);
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: "TaxInstallment",
      resourceId: row.installment_id,
      rotina: "Gestão Tributária",
      before: { numero_parcela: applied.installment.numero_parcela, vencimento: applied.installment.vencimento, situacao: applied.installment.situacao, data_pagamento: applied.installment.data_pagamento, valor_pago: applied.installment.valor_pago },
      after: {
        numero_parcela: applied.installment.numero_parcela,
        vencimento: applied.installment.vencimento,
        situacao: "paga_aguardando_reconhecimento",
        data_pagamento: applied.dataPagamento,
        valor_pago: applied.valorPago,
        pagamento_origem: `Baixa no Protheus — título ${row.prefixo} ${row.numero_e2}/${row.parcela_e2}`,
      },
      origem: req ? undefined : "automatico",
      payload: { pagamento_origem: "protheus", titulo_id: row.id },
    });
  }
  return updated;
}

// Envio sem confirmação (ou recusado): só a consulta decide. Achou → está no Protheus; não achou → pode ser enviado
// de novo.
async function settleUncertain(op, row, ctx) {
  const consulted = await consultStep(op, row, ctx);
  if (consulted.result === "nao_encontrado") {
    op.provenAbsentKey = keyString(lookupOf(row));
    return updateTitle(row.id, {
      situacao: "pendente",
      motivo: row.situacao === "recusado"
        ? "O Protheus tinha recusado o título; a consulta confirmou que ele não está lá."
        : "O envio anterior não foi confirmado e a consulta mostrou que o título não está no Protheus.",
    });
  }
  return consulted.row;
}

// Estorno: sempre consulta antes. Só estorna título achado e em aberto; "não encontrado" vai para conferência.
async function reverseStep(op, row, ctx) {
  const consulted = await consultStep(op, row, ctx);
  if (consulted.result === "inconclusivo") return { done: false, row: consulted.row };
  if (consulted.result === "nao_encontrado") {
    const updated = await updateTitle(row.id, {
      situacao: "conferencia",
      motivo: "O título deveria estar no Protheus, mas a consulta antes do estorno não o encontrou. Confira no Protheus e, se ele não existir mesmo, confirme a ausência.",
    });
    await audit(op, "UPDATE", updated, ctx, { situacao: TITLE_STATUS_LABELS.conferencia, mensagem: updated.motivo });
    return { done: false, row: updated };
  }
  if (consulted.row.situacao !== "enviado") return { done: false, row: consulted.row };
  await keepLease(op, row.id);
  const answer = await reverseTitle(op.endpoints, lookupOf(consulted.row));
  await audit(op, "REVERSE", consulted.row, ctx, { resultado: answer.confirmed ? "confirmado" : "sem confirmação", mensagem: answer.message });
  if (!answer.confirmed) {
    return { done: false, row: await updateTitle(row.id, { erp_mensagem: `Estorno não confirmado: ${answer.message}` }) };
  }
  return {
    done: true,
    row: await updateTitle(row.id, {
      situacao: "estornado",
      estornado_em: new Date().toISOString(),
      erp_mensagem: answer.message,
      motivo: "Estornado no Protheus.",
      saldo: null,
      baixa_data: null,
    }),
  };
}

async function sm0Match(op, entity) {
  const cache = shared(op);
  if (cache.sm0 === undefined) {
    try {
      cache.sm0 = await fetchSm0Records(op.endpoints.include.linked.integration, op.endpoints.include.credential);
    } catch (error) {
      logger.warn({ err: error }, "falha ao ler SM0 para o título de tributo; a filial usará o cadastro da empresa");
      cache.sm0 = [];
    }
  }
  return matchSm0ByEntity(entity, cache.sm0);
}

// Dados do envio vindos da configuração do cliente. Faltando algo, devolve o motivo em português comum.
async function sendConfig(op, ctx) {
  const groupId = ctx.group_id;
  if ((await resolveParameter("integrations.external_erp_enabled")) === false) {
    return { motivo: "Este cliente não integra com ERP: o título de tributo não é enviado." };
  }
  if (ctx.implantacao_pendente) {
    return { motivo: "Empresa aguardando a implantação de saldos: nada é enviado ao ERP até aplicar a implantação." };
  }
  let supplier;
  try {
    supplier = await resolveTaxSupplier({ esfera: ctx.esfera, uf: ctx.uf });
  } catch (error) {
    if (error?.code === "TAX_SUPPLIER_NOT_CONFIGURED") return { motivo: error.message };
    throw error;
  }
  const tipo = String((await resolveParameter(TAX_TITLE_TYPE_PARAMETER)) || "").trim();
  if (!tipo) return { motivo: `Informe o tipo do título de tributo em ${SETTINGS_PLACE}.` };
  const prefixo = String((await resolveParameter(TAX_TITLE_PREFIX_PARAMETER)) || "").trim();
  if (!prefixo) return { motivo: `Informe o prefixo do título de tributo em ${SETTINGS_PLACE}.` };
  if (await loanPrefixInUse(groupId, prefixo)) {
    return { motivo: `O prefixo ${prefixo} já é usado pelos títulos de empréstimo. Escolha outro prefixo para os títulos de tributo em ${SETTINGS_PLACE}.` };
  }
  const naturezaCode = String((await resolveParameter(TAX_TITLE_NATURE_PARAMETER)) || "").trim();
  if (!naturezaCode) return { motivo: `Informe a natureza do título de tributo em ${SETTINGS_PLACE}.` };
  const entity = entityOf(ctx);
  const nature = await resolveNatureForEntity(naturezaCode, entity);
  if (!nature || nature.codigo !== naturezaCode) {
    return { motivo: `A natureza ${naturezaCode} não está no cadastro de naturezas da empresa ${ctx.entity_name}. Cadastre-a ou corrija em ${SETTINGS_PLACE}.` };
  }
  const endpoints = await endpointsOrNull(op);
  if (!endpoints) return { motivo: op.endpointError };
  const codes = resolveTitleBranch({}, entity, await sm0Match(op, entity));
  if (!codes) return { motivo: "Informe empresa e filial da entidade em Governança." };
  return {
    config: {
      filial: codes.e2Filial || codes.filial,
      filOrig: codes.filialOrigem || "",
      prefixo,
      tipo,
      natureza: nature.codigo,
      fornecedor: supplier.fornecedor,
      loja: supplier.loja,
    },
  };
}

/**
 * Corpo da inclusão do título de tributo no FinRestTitulos. Mesmas chaves do título de empréstimo; fornecedor e
 * loja vão como configurados (o Protheus completa com espaços), sem completar com zeros.
 */
export function buildTaxTitlePayload({ config, numero, parcela, emissao, target, historico }) {
  const payload = {
    filial: config.filial,
    filOrig: config.filOrig,
    prefixo: config.prefixo,
    numero,
    parcela,
    tipo: config.tipo,
    natureza: config.natureza,
    fornecedor: config.fornecedor,
    loja: config.loja,
    emissao,
    vencimento: target.vencimento,
    valor: Number(target.valor),
    historico,
    moeda: 1,
  };
  const codBarras = String(target.codigoBarras || "").replace(/\D/g, "");
  if (codBarras.length === 44) payload.codBarras = codBarras;
  const linha = String(target.linhaDigitavel || "").replace(/\D/g, "");
  if (payload.codBarras && (linha.length === 47 || linha.length === 48)) payload.linhaDigitavel = linha;
  return payload;
}

async function sendStep(op, row, ctx, target) {
  const resolved = await sendConfig(op, ctx);
  if (!resolved.config) {
    const updated = await updateTitle(row.id, { motivo: resolved.motivo });
    return { done: true, row: updated };
  }
  const historico = titleHistory(ctx.codigo_parcelamento, ctx.numero_parcela);
  const payload = buildTaxTitlePayload({
    config: resolved.config,
    numero: row.numero_e2,
    parcela: row.parcela_e2,
    emissao: todayInSaoPaulo(),
    target,
    historico,
  });
  const snapshot = {
    guide_id: target.guideId,
    filial: payload.filial,
    fil_orig: payload.filOrig,
    prefixo: payload.prefixo,
    tipo: payload.tipo,
    natureza: payload.natureza,
    fornecedor: payload.fornecedor,
    loja: payload.loja,
    emissao: payload.emissao,
    vencimento: payload.vencimento,
    valor: payload.valor,
    codigo_barras: payload.codBarras || null,
    linha_digitavel: payload.linhaDigitavel || null,
    historico,
    saldo: null,
    baixa_data: null,
  };
  const lookup = {
    filial: payload.filial, filOrig: payload.filOrig, prefixo: payload.prefixo, numero: payload.numero, parcela: payload.parcela,
    tipo: payload.tipo, fornecedor: payload.fornecedor, loja: payload.loja, natureza: payload.natureza,
    vencimento: payload.vencimento, valor: payload.valor,
  };
  // O FinRestTitulos responde "incluído com sucesso" também quando a chave JÁ existia (FA050NUM/"já existe"), com o
  // valor do pedido: incluir sem saber que a chave está livre poderia ligar a guia a um título alheio. Consulta
  // antes — a não ser que esta mesma chave tenha acabado de ter a ausência provada nesta rodada.
  if (op.provenAbsentKey !== keyString(lookup)) {
    await keepLease(op, row.id);
    const before = await consultTitle(op.endpoints, lookup);
    await audit(op, "CONSULT", row, ctx, { resultado: before.result, mensagem: before.message, momento: "antes do envio" });
    if (before.result === "encontrado" || before.result === "divergente") {
      const updated = await updateTitle(row.id, {
        ...snapshot,
        dados_enviados: false,
        situacao: "conferencia",
        consultado_em: new Date().toISOString(),
        erp_mensagem: before.message,
        motivo: `Já existe no Protheus um título com a chave ${payload.prefixo} ${payload.numero}/${payload.parcela} (tipo ${payload.tipo}, fornecedor ${payload.fornecedor}/${payload.loja}) que o AllDebt não enviou. Ele não foi ligado a esta parcela: confira no Protheus.`,
      });
      await audit(op, "UPDATE", updated, ctx, { situacao: TITLE_STATUS_LABELS.conferencia, mensagem: updated.motivo });
      return { done: true, row: updated };
    }
    if (before.result !== "nao_encontrado") {
      return {
        done: true,
        row: await updateTitle(row.id, {
          motivo: "Não foi possível confirmar no Protheus que a chave do título está livre; o envio fica para a próxima tentativa.",
          erp_mensagem: before.message,
        }),
      };
    }
  }
  // Antes de enviar, o título vira "incerto" com o que vai ser enviado: se nada voltar, a consulta usa esta chave.
  const sending = await updateTitle(row.id, { ...snapshot, dados_enviados: true, situacao: "incerto", motivo: "Envio ao Protheus em andamento." });
  await keepLease(op, row.id);
  const answer = await includeTitle(op.endpoints, payload);
  await audit(op, "INTEGRATE", sending, ctx, {
    resultado: answer.confirmed ? "confirmado" : "sem confirmação",
    mensagem: answer.message,
    valor: payload.valor,
    vencimento: civilDateLabel(payload.vencimento),
  });
  if (answer.rejected) {
    // Recusa explícita: o agendador não reenvia. Volta a tentar quando alguém pede ou quando muda algo do envio,
    // sempre com consulta antes (algumas recusas do FinRestTitulos vêm depois de o FINA050 ter rodado).
    return {
      done: true,
      row: await updateTitle(row.id, {
        situacao: "recusado",
        motivo: "O Protheus recusou o título. Corrija o que a mensagem aponta e clique em Integrar.",
        erp_mensagem: answer.message,
      }),
    };
  }
  if (answer.confirmed) {
    return {
      done: true,
      row: await updateTitle(row.id, {
        situacao: "enviado",
        motivo: null,
        enviado_em: new Date().toISOString(),
        erp_mensagem: answer.message,
        saldo: payload.valor,
      }),
    };
  }
  return {
    done: true,
    row: await updateTitle(row.id, {
      motivo: "O Protheus não confirmou a inclusão. Antes de enviar de novo, o título é consultado.",
      erp_mensagem: answer.message,
    }),
  };
}

async function reconcile(op, titleId, installmentId, groupId) {
  let row = await loadTitle(titleId, groupId);
  for (let step = 0; step < MAX_STEPS; step += 1) {
    await keepLease(op, titleId);
    const ctx = await loadContext(installmentId, groupId);
    const target = titleTarget(ctx);
    if (FROZEN.has(row.situacao) || row.situacao === "conferencia") return row;
    if (row.situacao === "incerto") {
      const settled = await settleUncertain(op, row, ctx);
      if (settled.situacao === "incerto") return settled;
      row = settled;
      continue;
    }
    if (row.situacao === "recusado") {
      // Só com pedido (botão) ou mudança no envio; e sempre consultando antes. Recusado de novo, o envio volta
      // direto (sendStep encerra a rodada): uma tentativa por pedido.
      if (!op.retryRejected) return row;
      const settled = await settleUncertain(op, row, ctx);
      if (settled.situacao === "recusado") return settled;
      row = settled;
      continue;
    }
    if (row.situacao === "enviado") {
      if (matchesSent(row, target) || (!target.want && !target.reverse)) return row;
      const reversed = await reverseStep(op, row, ctx);
      row = reversed.row;
      if (!reversed.done) return row;
      continue;
    }
    // Fora do Protheus (pendente ou estornado).
    if (!target.want) {
      return row.motivo === target.motivo ? row : updateTitle(row.id, { motivo: target.motivo });
    }
    return (await sendStep(op, row, ctx, target)).row;
  }
  return row;
}

/**
 * Leva o título da parcela ao estado que a guia pede (cria, envia, estorna e reenvia). Sem guia vinculada e sem
 * título, não faz nada.
 * @param {string} installmentId
 * @param {{ req?: object, strict?: boolean, retryRejected?: boolean }} [options] strict: título ocupado vira erro
 *   409 (ação da tela); retryRejected: tenta de novo título recusado pelo Protheus (pedido ou mudança no envio)
 */
export async function processTaxTitle(installmentId, { req = null, strict = false, retryRejected = false, batch = null } = {}) {
  const groupId = requireTenantContext();
  const ctx = await loadContext(installmentId, groupId);
  let row = await findTitle(ctx.id, groupId);
  if (!row) {
    if (!titleTarget(ctx).want) return null;
    row = await createTitle(ctx);
  }
  const token = randomUUID();
  if (!(await acquireLease(row.id, token))) {
    if (strict) throw busyError();
    return presentTitle(row, ctx);
  }
  try {
    const op = { req, retryRejected, token, batch };
    try {
      const final = await reconcile(op, row.id, ctx.id, groupId);
      return presentTitle(final, ctx);
    } catch (error) {
      if (!(error instanceof LeaseLostError)) throw error;
      logger.warn({ titleId: row.id }, "trava do título de tributo perdida no meio do processamento; parou sem falar com o Protheus");
      return presentTitle(await loadTitle(row.id, groupId), ctx);
    }
  } finally {
    await releaseLease(row.id, token);
  }
}

// ---------------------------------------------------------------------------
// Fila das ações da guia e da parcela (em segundo plano, no escopo do cliente de quem agiu)
// ---------------------------------------------------------------------------

const runningSyncs = new Set();

// Chamada quando muda algo do envio (guia, parcela, parcelamento, parâmetros): por isso tenta de novo o recusado.
export function queueTaxTitleSync(installmentIds) {
  const ids = [...new Set((installmentIds || []).filter(Boolean))];
  if (!ids.length) return;
  const run = (async () => {
    for (const id of ids) {
      try {
        await processTaxTitle(id, { retryRejected: true });
      } catch (error) {
        if (error?.status !== 404) logger.error({ err: error, installmentId: id }, "falha ao sincronizar o título de tributo");
      }
    }
  })();
  runningSyncs.add(run);
  run.finally(() => runningSyncs.delete(run));
}

/** Espera as sincronizações em segundo plano terminarem (testes e encerramento). */
export async function settleTaxTitleSyncs() {
  while (runningSyncs.size) await Promise.allSettled([...runningSyncs]);
}

/** Mudou parâmetro do envio (tipo, prefixo, natureza, fornecedor): tenta de novo os títulos recusados do cliente. */
export async function queueRejectedTaxTitlesRetry() {
  const groupId = requireTenantContext();
  const result = await pool.query(`SELECT installment_id FROM tax_payable_titles WHERE group_id = $1 AND situacao = 'recusado'`, [groupId]);
  queueTaxTitleSync(result.rows.map((row) => row.installment_id));
}

/** Parcelas do parcelamento (para sincronizar depois de mudar o parcelamento). */
export async function installmentIdsOfAgreement(agreementId) {
  const groupId = requireTenantContext();
  const result = await pool.query(`SELECT id FROM tax_installments WHERE agreement_id = $1 AND group_id = $2`, [agreementId, groupId]);
  return result.rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// Exclusão de parcela/parcelamento: estorno confirmado antes
// ---------------------------------------------------------------------------

/**
 * Antes de excluir parcela ou parcelamento: estorna (com confirmação) os títulos que estão no Protheus. Se algum
 * não puder ser estornado com confirmação, a exclusão é barrada com o motivo. Títulos pagos barram sempre.
 */
export async function releaseTaxTitlesForDeletion({ installmentId = null, agreementId = null, req = null }) {
  const groupId = requireTenantContext();
  const result = await pool.query(
    `SELECT t.id, t.installment_id, t.situacao FROM tax_payable_titles t
       JOIN tax_installments i ON i.id = t.installment_id
      WHERE t.group_id = $1 AND (i.id = $2 OR i.agreement_id = $3)`,
    [groupId, installmentId, agreementId]
  );
  const blocked = [];
  const op = { req };
  for (const item of result.rows) {
    if (OUT_OF_ERP.has(item.situacao)) continue;
    const ctx = await loadContext(item.installment_id, groupId);
    const label = `parcela ${ctx.numero_parcela}`;
    if (FROZEN.has(item.situacao)) {
      blocked.push(`O título de tributo da ${label} já foi pago no Protheus e não pode ser estornado.`);
      continue;
    }
    if (item.situacao === "conferencia") {
      blocked.push(`O título de tributo da ${label} precisa de conferência antes (veja em Contas a Pagar).`);
      continue;
    }
    const token = randomUUID();
    if (!(await acquireLease(item.id, token))) {
      blocked.push(`O título de tributo da ${label} está sendo enviado ou estornado agora. Tente de novo em instantes.`);
      continue;
    }
    op.token = token;
    try {
      let row = await loadTitle(item.id, groupId);
      if (row.situacao === "incerto" || row.situacao === "recusado") row = await settleUncertain(op, row, ctx);
      if (row.situacao === "enviado") row = (await reverseStep(op, row, ctx)).row;
      if (!OUT_OF_ERP.has(row.situacao)) {
        blocked.push(`O título de tributo da ${label} não pôde ser estornado no Protheus com confirmação${row.erp_mensagem ? ` (${row.erp_mensagem})` : ""}.`);
      }
    } catch (error) {
      if (!(error instanceof LeaseLostError)) throw error;
      blocked.push(`O título de tributo da ${label} está sendo enviado ou estornado agora. Tente de novo em instantes.`);
    } finally {
      await releaseLease(item.id, token);
    }
  }
  if (blocked.length) {
    throw httpError(
      409,
      `Não foi possível excluir: ${blocked.join(" ")} Nada foi excluído.`,
      "TAX_TITLE_BLOCKS_DELETION",
      { motivos: blocked }
    );
  }
}

// ---------------------------------------------------------------------------
// Agendador e ações da tela
// ---------------------------------------------------------------------------

/** Envia/estorna o que estiver pendente no cliente (agendador). */
export async function syncTaxTitles() {
  const groupId = requireTenantContext();
  const result = await pool.query(
    `SELECT i.id FROM tax_installments i
       LEFT JOIN tax_payable_titles t ON t.installment_id = i.id
       LEFT JOIN tax_installment_guides g ON g.installment_id = i.id AND g.encerrada_em IS NULL
      WHERE i.group_id = $1
        AND ((t.id IS NULL AND g.situacao = 'vinculada') OR t.situacao IN ('pendente', 'incerto', 'enviado', 'estornado'))
      ORDER BY i.vencimento, i.id`,
    [groupId]
  );
  const summary = { total: result.rows.length, enviados: 0, estornados: 0, pendentes: 0, incertos: 0, outros: 0 };
  // Conexão e SM0 lidas uma vez para o lote todo.
  const batch = {};
  for (const { id } of result.rows) {
    try {
      const title = await processTaxTitle(id, { batch });
      if (!title) continue;
      if (title.situacao === "enviado") summary.enviados += 1;
      else if (title.situacao === "estornado") summary.estornados += 1;
      else if (title.situacao === "pendente") summary.pendentes += 1;
      else if (title.situacao === "incerto") summary.incertos += 1;
      else summary.outros += 1;
    } catch (error) {
      logger.error({ err: error, installmentId: id }, "falha ao sincronizar o título de tributo");
      summary.outros += 1;
    }
  }
  return summary;
}

// Consulta de um título, com o resultado da consulta: "encontrado" | "nao_encontrado" | "inconclusivo" | "ocupado" |
// "sem_titulo_no_erp" (pendente ou estornado: não há o que consultar).
async function consultOne(id, { req = null, strict = false } = {}) {
  const groupId = requireTenantContext();
  const row = await loadTitle(String(id || ""), groupId);
  if (!row) throw httpError(404, "Título de tributo não encontrado", "NOT_FOUND");
  const ctx = await loadContext(row.installment_id, groupId);
  if (OUT_OF_ERP.has(row.situacao)) return { result: "sem_titulo_no_erp" };
  const token = randomUUID();
  if (!(await acquireLease(row.id, token))) {
    if (strict) throw busyError();
    return { result: "ocupado" };
  }
  try {
    const op = { req, token };
    const fresh = await loadTitle(row.id, groupId);
    if (fresh.situacao === "incerto") {
      const settled = await settleUncertain(op, fresh, ctx);
      const bySituation = { pendente: "nao_encontrado", incerto: "inconclusivo", conferencia: "divergente" };
      return { result: bySituation[settled.situacao] || "encontrado" };
    }
    // Recusado: a consulta só confirma se ele entrou; não achado continua recusado (o agendador não reenvia).
    const consulted = await consultStep(op, fresh, ctx);
    if (consulted.result === "nao_encontrado" && ["enviado", "parcial", "baixado"].includes(fresh.situacao)) {
      const final = await updateTitle(row.id, {
        situacao: "conferencia",
        motivo: fresh.parcela_atualizada_em
          ? undoneBaixaMessage(ctx)
          : "A consulta não encontrou no Protheus um título que estava integrado. Confira no Protheus e, se ele não existir mesmo, confirme a ausência.",
      });
      await audit(op, "UPDATE", final, ctx, { situacao: TITLE_STATUS_LABELS.conferencia, mensagem: final.motivo });
    }
    return { result: consulted.result };
  } catch (error) {
    if (error instanceof LeaseLostError) return { result: "ocupado" };
    throw error;
  } finally {
    await releaseLease(row.id, token);
  }
}

/** Consulta no Protheus um título (saldo e baixa). Não encontrado nunca apaga: vira conferência. */
export async function consultTaxTitle(id, { req = null, strict = false } = {}) {
  const groupId = requireTenantContext();
  const row = await loadTitle(String(id || ""), groupId);
  if (!row) throw httpError(404, "Título de tributo não encontrado", "NOT_FOUND");
  await consultOne(id, { req, strict });
  return getInstallmentTitle(row.installment_id);
}

const CONSULTABLE = ["enviado", "parcial", "incerto"];
const CONSULTABLE_ON_REQUEST = ["enviado", "parcial", "baixado", "incerto", "recusado", "conferencia"];

/**
 * Consulta os títulos do cliente no Protheus (agendador: os integrados e os sem confirmação; botão "Consultar
 * títulos": também pagos, recusados e em conferência). Só o título muda; a parcela não.
 * @returns {Promise<{ total: number, consultados: number, conferencia: number, por_resultado: Record<string, number> }>}
 */
export async function consultTaxTitles({ req = null, onRequest = false } = {}) {
  const groupId = requireTenantContext();
  // Pagos também entram quando ainda falta registrar o pagamento na parcela (ex.: baixa com data futura) ou quando a
  // parcela movida pela baixa ainda aguarda reconhecimento (para notar baixa desfeita).
  const result = await pool.query(
    `SELECT t.id FROM tax_payable_titles t JOIN tax_installments i ON i.id = t.installment_id
      WHERE t.group_id = $1
        AND (t.situacao = ANY($2::text[])
          OR (t.situacao = 'baixado' AND (
            (t.parcela_atualizada_em IS NULL AND i.situacao = 'em_aberto'
              AND ($3::boolean OR t.baixa_sem_data_desde IS NULL OR t.baixa_sem_data_desde > now() - ($4::int * interval '1 day')))
            OR (t.parcela_atualizada_em IS NOT NULL AND i.situacao = 'paga_aguardando_reconhecimento'))))
      ORDER BY t.updated_date`,
    [groupId, onRequest ? CONSULTABLE_ON_REQUEST : CONSULTABLE, onRequest, UNDATED_BAIXA_RETRY_DAYS]
  );
  const summary = {
    total: result.rows.length,
    consultados: 0,
    conferencia: 0,
    por_resultado: { encontrado: 0, nao_encontrado: 0, inconclusivo: 0, divergente: 0, ocupado: 0, erro: 0 },
  };
  for (const { id } of result.rows) {
    try {
      const outcome = await consultOne(id, { req });
      if (outcome.result in summary.por_resultado) summary.por_resultado[outcome.result] += 1;
      if (["encontrado", "nao_encontrado", "inconclusivo", "divergente"].includes(outcome.result)) summary.consultados += 1;
    } catch (error) {
      summary.por_resultado.erro += 1;
      logger.error({ err: error, titleId: id }, "falha ao consultar o título de tributo");
    }
  }
  const conference = await pool.query(
    `SELECT count(*)::int AS n FROM tax_payable_titles WHERE group_id = $1 AND situacao = 'conferencia' AND id = ANY($2::text[])`,
    [groupId, result.rows.map((row) => row.id)]
  );
  summary.conferencia = conference.rows[0].n;
  return summary;
}

/** Ação da tela: envia/estorna agora o título da parcela. */
export async function integrateTaxTitle(id, { req = null } = {}) {
  const groupId = requireTenantContext();
  const row = await loadTitle(String(id || ""), groupId);
  if (!row) throw httpError(404, "Título de tributo não encontrado", "NOT_FOUND");
  await processTaxTitle(row.installment_id, { req, strict: true, retryRejected: true });
  return getInstallmentTitle(row.installment_id);
}

/**
 * Conferência humana: a pessoa confirmou no Protheus que o título não existe. Só para título em conferência.
 * O título passa a "estornado" e a guia atual decide se ele é enviado de novo.
 */
export async function confirmTaxTitleAbsence(id, { req = null } = {}) {
  const groupId = requireTenantContext();
  const row = await loadTitle(String(id || ""), groupId);
  if (!row) throw httpError(404, "Título de tributo não encontrado", "NOT_FOUND");
  if (row.situacao !== "conferencia") {
    throw httpError(409, "Só um título em conferência pode ter a ausência confirmada.", "TAX_TITLE_NOT_IN_CONFERENCE");
  }
  const token = randomUUID();
  if (!(await acquireLease(row.id, token))) throw busyError();
  let updated;
  try {
    updated = await updateTitle(row.id, {
      situacao: "estornado",
      estornado_em: new Date().toISOString(),
      motivo: `Ausência no Protheus confirmada por ${actorEmail()}.`,
    });
    const ctx = await loadContext(row.installment_id, groupId);
    await audit({ req }, "UPDATE", updated, ctx, { situacao: "Ausência confirmada", mensagem: updated.motivo });
  } finally {
    await releaseLease(row.id, token);
  }
  queueTaxTitleSync([row.installment_id]);
  return getInstallmentTitle(row.installment_id);
}

// ---------------------------------------------------------------------------
// Para a tela
// ---------------------------------------------------------------------------

// Situações em que os dados do título são os que foram mandados ao Protheus (na última tentativa).
const SENT_DATA = new Set(["incerto", "recusado", "enviado", "baixado", "parcial", "conferencia", "estornado"]);

/** Título como a tela recebe (Contas a Pagar, parcela e guia). `forecast`: dados previstos do título pendente. */
export function presentTitle(row, ctx = null, forecast = null) {
  if (!row) return null;
  const busy = row.trava_ate ? new Date(row.trava_ate).getTime() > Date.now() : false;
  // Pendente: o que vale é o previsto pela guia e pela configuração de agora (null quando falta), nunca o que sobrou
  // de uma tentativa anterior. Título que parou antes do envio (ex.: chave já existente): os dados gravados são os
  // que SERIAM enviados — também previstos, não enviados.
  const pending = row.situacao === "pendente";
  const notSent = row.snapshot_enviado === false;
  const previsto = pending || notSent;
  const data = pending ? (forecast || {}) : row;
  return {
    id: row.id,
    origem: "tributo",
    installment_id: row.installment_id,
    agreement_id: ctx?.agreement_id ?? row.agreement_id ?? null,
    entity_id: ctx?.entity_id ?? row.entity_id ?? null,
    entity_name: ctx?.entity_name ?? row.entity_name ?? null,
    codigo_parcelamento: ctx?.codigo_parcelamento ?? row.codigo_parcelamento ?? null,
    orgao: ctx?.orgao ?? row.orgao ?? null,
    numero_parcela: ctx?.numero_parcela ?? row.numero_parcela ?? null,
    numero: row.numero_e2,
    parcela: row.parcela_e2,
    // Dados do título: enviados ao Protheus (dados_enviados) ou previstos a partir da guia vinculada (previsto).
    previsto,
    dados_enviados: SENT_DATA.has(row.situacao) && !notSent,
    prefixo: data.prefixo ?? null,
    tipo: data.tipo ?? null,
    natureza: data.natureza ?? null,
    fornecedor: data.fornecedor ?? null,
    loja: data.loja ?? null,
    filial: pending ? null : row.filial,
    fil_orig: pending ? null : row.fil_orig,
    emissao: pending ? null : row.emissao,
    vencimento: data.vencimento ?? null,
    valor: data.valor ?? null,
    saldo: previsto ? null : row.saldo,
    baixa_data: previsto ? null : row.baixa_data,
    codigo_barras: data.codigo_barras ?? null,
    linha_digitavel: data.linha_digitavel ?? null,
    historico: data.historico ?? null,
    situacao: row.situacao,
    situacao_label: TITLE_STATUS_LABELS[row.situacao] || row.situacao,
    motivo: row.motivo,
    erp_mensagem: row.erp_mensagem,
    enviado_em: row.enviado_em,
    estornado_em: row.estornado_em,
    consultado_em: row.consultado_em,
    em_andamento: busy,
    // A baixa deste título registrou o pagamento da parcela ("Paga, aguardando reconhecimento").
    parcela_atualizada: Boolean(row.parcela_atualizada_em),
    parcela_atualizada_em: row.parcela_atualizada_em || null,
    // Pago no Protheus sem data de baixa: desde quando (o agendador desiste depois de UNDATED_BAIXA_RETRY_DAYS dias).
    baixa_sem_data_desde: row.baixa_sem_data_desde || null,
    pode_integrar: !busy && ["pendente", "incerto", "recusado", "enviado", "estornado"].includes(row.situacao),
    pode_consultar: !busy && ["incerto", "recusado", "enviado", "parcial", "baixado", "conferencia"].includes(row.situacao),
    pode_confirmar_ausencia: !busy && row.situacao === "conferencia",
    created_date: row.created_date,
    updated_date: row.updated_date,
  };
}

function titleHistory(codigoParcelamento, numeroParcela) {
  return `Tributo ${codigoParcelamento} parcela ${numeroParcela}`.slice(0, 40);
}

// Configuração do envio já gravada (sem consultar Protheus nem validar natureza): o que a tela pode mostrar como
// previsto. O que faltar vem null.
async function forecastConfig() {
  const read = async (key) => String((await resolveParameter(key)) || "").trim() || null;
  return {
    tipo: await read(TAX_TITLE_TYPE_PARAMETER),
    prefixo: await read(TAX_TITLE_PREFIX_PARAMETER),
    natureza: await read(TAX_TITLE_NATURE_PARAMETER),
    suppliers: await resolveParameter(TAX_SUPPLIERS_PARAMETER),
  };
}

function forecastOf(title, ctx, config) {
  if (title.situacao !== "pendente") return null;
  let supplier = null;
  try {
    supplier = pickTaxSupplier(config.suppliers, { esfera: ctx.esfera, uf: ctx.uf });
  } catch {
    supplier = null;
  }
  const base = {
    tipo: config.tipo,
    prefixo: config.prefixo,
    natureza: config.natureza,
    fornecedor: supplier?.fornecedor ?? null,
    loja: supplier?.loja ?? null,
  };
  const target = titleTarget(ctx);
  if (!target.want) return base;
  const codBarras = String(target.codigoBarras || "").replace(/\D/g, "");
  const linha = String(target.linhaDigitavel || "").replace(/\D/g, "");
  return {
    ...base,
    valor: Number(target.valor),
    vencimento: target.vencimento,
    codigo_barras: codBarras.length === 44 ? codBarras : null,
    linha_digitavel: codBarras.length === 44 && (linha.length === 47 || linha.length === 48) ? linha : null,
    historico: titleHistory(ctx.codigo_parcelamento, ctx.numero_parcela),
  };
}

/** Título da parcela (ou null) para a tela da parcela/guia. */
export async function getInstallmentTitle(installmentId) {
  const [title] = await listTaxPayableTitles({ installmentId: String(installmentId || "") });
  return title || null;
}

/** Títulos de tributo do cliente, para Contas a Pagar (junto dos títulos de empréstimo). */
export async function listTaxPayableTitles({ situacao, agreementId, installmentId } = {}) {
  const groupId = requireTenantContext();
  const params = [groupId];
  const filters = [];
  if (situacao) {
    params.push(String(situacao).split(",").map((item) => item.trim()).filter(Boolean));
    filters.push(`t.situacao = ANY($${params.length}::text[])`);
  }
  if (agreementId) {
    params.push(String(agreementId));
    filters.push(`i.agreement_id = $${params.length}`);
  }
  if (installmentId) {
    params.push(String(installmentId));
    filters.push(`t.installment_id = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT ${TITLE_COLUMNS}, i.agreement_id, i.numero_parcela, i.situacao AS installment_situacao,
            i.vencimento::text AS installment_vencimento, a.codigo_parcelamento, a.orgao, a.entity_id, a.esfera, a.uf,
            a.situacao AS agreement_situacao, e.entity_name,
            g.id AS current_guide_id, g.situacao AS guide_situacao, g.valor_guia::float8 AS valor_guia,
            g.pagar_ate::text AS pagar_ate, g.codigo_barras AS guide_codigo_barras, g.linha_digitavel AS guide_linha_digitavel
       FROM tax_payable_titles t
       JOIN tax_installments i ON i.id = t.installment_id
       JOIN tax_agreements a ON a.id = i.agreement_id
       JOIN company_entities e ON e.id = a.entity_id
       LEFT JOIN tax_installment_guides g ON g.installment_id = i.id AND g.encerrada_em IS NULL
      WHERE t.group_id = $1 ${filters.map((f) => `AND ${f}`).join(" ")}
      ORDER BY COALESCE(t.vencimento, i.vencimento), a.codigo_parcelamento, i.numero_parcela`,
    params
  );
  const config = result.rows.some((row) => row.situacao === "pendente") ? await forecastConfig() : null;
  return result.rows.map((row) => {
    // Mesmo formato do contexto usado no envio (titleTarget), com os campos da guia atual.
    const ctxLike = {
      ...row,
      situacao: row.installment_situacao,
      vencimento: row.installment_vencimento,
      guide_id: row.current_guide_id,
      codigo_barras: row.guide_codigo_barras,
      linha_digitavel: row.guide_linha_digitavel,
    };
    const forecast = config ? forecastOf(row, ctxLike, config) : null;
    return presentTitle(row, null, forecast);
  });
}
