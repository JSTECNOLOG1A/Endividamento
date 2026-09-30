import { logger } from "../../logger.js";
import * as entityStore from "../entities/store.js";
import { sendMail } from "../signup/mailer.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Envia de verdade via SMTP (sendMail(), o mesmo transporte já usado pelos
// e-mails de cadastro/reset de senha — ver modules/signup/mailer.js) quando
// SMTP_HOST estiver configurado. Sem isso, sendMail() já devolve
// { sent: false } sem tentar nada (comportamento seguro de sempre) e cai
// pra status "simulado" — dá pra auditar exatamente o que teria sido
// enviado, pra quem e com qual texto, sem risco de disparo indevido antes
// das credenciais existirem.
export async function sendNotification({ eventType, contractId, to, subject, body }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const results = [];
  for (const toEmail of recipients) {
    const html = `<p>${escapeHtml(body).replaceAll("\n", "<br/>")}</p>`;
    const { sent, error } = await sendMail({ to: toEmail, subject, text: body, html });
    const status = sent ? "enviado" : error ? "falhou" : "simulado";
    if (status === "simulado") {
      logger.info({ toEmail, subject, eventType, contractId }, "notificação simulada — SMTP não configurado");
    } else if (status === "falhou") {
      logger.error({ toEmail, subject, eventType, contractId, error }, "falha ao enviar notificação por e-mail");
    }
    try {
      const saved = await entityStore.create(
        "NotificationLog",
        {
          event_type: eventType,
          contract_id: contractId || null,
          to_email: toEmail,
          subject,
          body,
          status,
          error_message: status === "falhou" ? error : null,
        },
        "system"
      );
      results.push(saved);
    } catch (logError) {
      logger.error({ err: logError, toEmail, subject, eventType }, "falha ao registrar notificação");
    }
  }
  return results;
}
