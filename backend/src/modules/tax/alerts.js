import { randomUUID } from "node:crypto";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { sendMail } from "../signup/mailer.js";
import { isTenantBlocked } from "../tenants/access.js";
import { requireTenantContext } from "../tenants/scope.js";
import { PREFERENCE_KEYS, emailsWithPreferenceOff } from "../preferences/service.js";
import { buildTaxAlertEmail } from "./alertEmail.js";
import { addDays, brazilDate, brazilHour } from "./brazilClock.js";
import { loadOpenInstallmentsDueBy, presentPlanningInstallment } from "./planning.js";

// Alertas diários da Gestão Tributária por e-mail: um resumo por usuário com o módulo, por cliente, com
// - parcelas que vencem nos próximos DUE_SOON_DAYS dias (de hoje até hoje + 7, como o "a vencer" do semáforo);
// - parcelas vencidas e não pagas;
// - guia pendente: parcela que vence nesses dias sem guia vinculada (sem guia ou com guia em exceção).
// Só parcelamentos ativos. Só envia se houver algo a avisar. Quem desligou os alertas não recebe.
//
// No máximo um resumo por usuário, cliente e dia (tax_alert_sends): a linha é reservada antes do envio, então rodar
// a rotina duas vezes no dia (agendamento + "executar agora", ou duas execuções ao mesmo tempo) não repete o e-mail.
// Resumo que falhou (inclusive por falta de SMTP) é tentado de novo na execução seguinte do mesmo dia, até
// MAX_ALERT_ATTEMPTS vezes. Os alertas saem a partir das ALERT_FROM_HOUR horas de Brasília: com o agendamento de hora
// em hora, o resumo chega de manhã e uma falha tem como ser repetida no mesmo dia.

/** Mesmo prazo do "a vencer" do semáforo dos parcelamentos (src/lib/taxSignal.js, DUE_SOON_DAYS). */
export const DUE_SOON_DAYS = 7;
export const ALERT_FROM_HOUR = 7;
export const MAX_ALERT_ATTEMPTS = 3;
/** Maior intervalo aceito no agendamento dos alertas (schedules/tasks.js): garante uma execução depois das 7h todo dia. */
export const ALERT_MAX_INTERVAL_MINUTES = 60;

const SMTP_NOT_CONFIGURED = "SMTP não configurado";

/**
 * Separa as parcelas em aberto (já presentes como no planejamento) nas três seções do resumo.
 * @param {object[]} rows linhas de loadOpenInstallmentsDueBy
 * @param {string} today AAAA-MM-DD
 */
export function classifyAlertContent(rows, today) {
  const limit = addDays(today, DUE_SOON_DAYS);
  const content = { a_vencer: [], vencidas: [], guia_pendente: [] };
  for (const row of rows) {
    const item = presentPlanningInstallment(row, today);
    if (!item) continue;
    if (item.conta_em === "vencida") {
      content.vencidas.push(item);
      continue;
    }
    if (item.conta_em !== "a_pagar" || item.vencimento > limit) continue;
    content.a_vencer.push(item);
    if (item.guia.situacao !== "vinculada") content.guia_pendente.push(item);
  }
  return content;
}

function hasSomething(content) {
  return content.a_vencer.length > 0 || content.vencidas.length > 0 || content.guia_pendente.length > 0;
}

async function loadTenant(groupId) {
  const result = await pool.query(
    `SELECT id, tenant_name, billing_status, lifecycle_status FROM tenants WHERE group_id = $1 ORDER BY created_date ASC LIMIT 1`,
    [groupId]
  );
  return result.rows[0] || null;
}

/** Usuários ativos do cliente com a Gestão Tributária liberada no cadastro de usuários (o master não entra). */
export async function listAlertRecipients(groupId) {
  const result = await pool.query(
    `SELECT DISTINCT ON (lower(u.email)) lower(u.email) AS email, u.full_name
       FROM tenant_users tu
       JOIN users u ON lower(u.email) = lower(tu.user_email)
      WHERE tu.group_id = $1
        AND tu.permissions @> '{"tax": true}'::jsonb
        AND u.status = 'active' AND u.blocked IS NOT TRUE AND u.platform_admin IS NOT TRUE
        AND u.email LIKE '%_@_%'
      ORDER BY lower(u.email)`,
    [groupId]
  );
  return result.rows;
}

// Reserva o resumo do dia: cria a linha, ou retoma uma que falhou (dentro do limite de tentativas). Devolve null
// quando o resumo do dia já saiu, está saindo agora, ou esgotou as tentativas.
async function claimSend({ groupId, email, day, summary, subject }) {
  const result = await pool.query(
    `INSERT INTO tax_alert_sends (id, group_id, user_email, data_referencia, situacao, tentativas, resumo, assunto)
     VALUES ($1, $2, $3, $4::date, 'enviando', 1, $5::jsonb, $6)
     ON CONFLICT (group_id, user_email, data_referencia) DO UPDATE
        SET situacao = 'enviando', tentativas = tax_alert_sends.tentativas + 1, resumo = EXCLUDED.resumo,
            assunto = EXCLUDED.assunto, erro = NULL, updated_date = now()
      WHERE tax_alert_sends.situacao = 'falhou' AND tax_alert_sends.tentativas < $7
     RETURNING id`,
    [randomUUID(), groupId, email, day, JSON.stringify(summary), subject, MAX_ALERT_ATTEMPTS]
  );
  return result.rows[0]?.id || null;
}

async function currentSendStatus(groupId, email, day) {
  const result = await pool.query(
    `SELECT situacao FROM tax_alert_sends WHERE group_id = $1 AND user_email = $2 AND data_referencia = $3::date`,
    [groupId, email, day]
  );
  return result.rows[0]?.situacao || null;
}

async function finishSend(id, { sent, error }) {
  await pool.query(
    `UPDATE tax_alert_sends
        SET situacao = $2, erro = $3, enviado_em = CASE WHEN $2 = 'enviado' THEN now() ELSE enviado_em END,
            updated_date = now()
      WHERE id = $1`,
    [id, sent ? "enviado" : "falhou", error ? String(error).slice(0, 2000) : null]
  );
}

// Um destinatário só por e-mail: recusado pelo servidor chega como falha do envio (sendMail devolve sent: false).
function outcomeOf(result) {
  if (!result.sent && !result.error) return { sent: false, error: SMTP_NOT_CONFIGURED };
  if (!result.sent) return { sent: false, error: result.error };
  return { sent: true, error: null };
}

function plural(count, singular, pluralText) {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function summaryMessage(s) {
  if (s.fora_do_horario) {
    return `Os alertas de vencimento dos tributos são enviados a partir das ${ALERT_FROM_HOUR}h (horário de Brasília). Nada foi enviado agora; o resumo de hoje sai na primeira execução depois das ${ALERT_FROM_HOUR}h.`;
  }
  if (s.cliente_suspenso) return "Cliente com acesso suspenso: nenhum alerta enviado.";
  if (!s.tem_algo) {
    return `Nada a avisar hoje: nenhuma parcela de tributo vencida ou vencendo nos próximos ${DUE_SOON_DAYS} dias.`;
  }
  const parts = [
    `${plural(s.enviados, "resumo enviado", "resumos enviados")}`,
    s.falhas ? `${plural(s.falhas, "resumo não enviado", "resumos não enviados")}${s.sem_smtp ? " (envio de e-mail não configurado)" : ""}` : null,
    s.ja_enviados ? `${plural(s.ja_enviados, "usuário já recebeu", "usuários já receberam")} o resumo de hoje` : null,
    s.esgotados ? `${plural(s.esgotados, "resumo não foi enviado", "resumos não foram enviados")} hoje depois de ${MAX_ALERT_ATTEMPTS} tentativas` : null,
    s.desligados ? `${plural(s.desligados, "usuário desligou", "usuários desligaram")} os alertas` : null,
    s.destinatarios === 0 ? "nenhum usuário com acesso à Gestão Tributária para receber" : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Envia os resumos do dia do cliente atual. Nunca lança por falha de envio: cada falha fica registrada.
 * @returns {Promise<{ ok: boolean, message: string, detalhes: object }>}
 */
export async function runTaxAlerts({ now = new Date() } = {}) {
  const groupId = requireTenantContext();
  const day = brazilDate(now);
  const s = {
    data_referencia: day,
    fora_do_horario: false,
    cliente_suspenso: false,
    tem_algo: false,
    a_vencer: 0,
    vencidas: 0,
    guia_pendente: 0,
    destinatarios: 0,
    enviados: 0,
    falhas: 0,
    sem_smtp: false,
    ja_enviados: 0,
    esgotados: 0,
    desligados: 0,
  };
  const done = (ok) => ({ ok, message: summaryMessage(s), detalhes: s });

  if (brazilHour(now) < ALERT_FROM_HOUR) {
    s.fora_do_horario = true;
    return done(true);
  }
  const tenant = await loadTenant(groupId);
  if (!tenant || isTenantBlocked(tenant)) {
    s.cliente_suspenso = true;
    return done(true);
  }

  const content = classifyAlertContent(await loadOpenInstallmentsDueBy(groupId, addDays(day, DUE_SOON_DAYS)), day);
  s.a_vencer = content.a_vencer.length;
  s.vencidas = content.vencidas.length;
  s.guia_pendente = content.guia_pendente.length;
  s.tem_algo = hasSomething(content);
  if (!s.tem_algo) return done(true);

  const recipients = await listAlertRecipients(groupId);
  const optedOut = await emailsWithPreferenceOff(groupId, PREFERENCE_KEYS.taxAlerts);
  s.destinatarios = recipients.length;
  const summary = { a_vencer: s.a_vencer, vencidas: s.vencidas, guia_pendente: s.guia_pendente };

  for (const recipient of recipients) {
    if (optedOut.has(recipient.email)) {
      s.desligados += 1;
      continue;
    }
    const email = buildTaxAlertEmail({
      tenantName: tenant.tenant_name,
      recipientName: recipient.full_name,
      today: day,
      dueSoonDays: DUE_SOON_DAYS,
      content,
      appUrl: config.appPublicUrl,
    });
    const sendId = await claimSend({ groupId, email: recipient.email, day, summary, subject: email.subject });
    if (!sendId) {
      if ((await currentSendStatus(groupId, recipient.email, day)) === "falhou") s.esgotados += 1;
      else s.ja_enviados += 1;
      continue;
    }
    const outcome = outcomeOf(await sendMail({ to: recipient.email, subject: email.subject, text: email.text, html: email.html }));
    if (outcome.sent) s.enviados += 1;
    else {
      s.falhas += 1;
      if (outcome.error === SMTP_NOT_CONFIGURED) s.sem_smtp = true;
    }
    try {
      await finishSend(sendId, outcome);
    } catch (error) {
      // Fica "enviando": não é repetido hoje (o e-mail pode ter saído).
      logger.error({ err: error, groupId, sendId, sent: outcome.sent }, "falha ao registrar o resultado do alerta de tributos");
    }
  }
  return done(s.falhas === 0 && s.esgotados === 0);
}
