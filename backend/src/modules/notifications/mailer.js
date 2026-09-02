import { logger } from "../../logger.js";
import * as entityStore from "../entities/store.js";

// Nenhum provedor de e-mail está configurado ainda (Microsoft 365/Graph API
// ou SMTP — ver README/.env.example). Enquanto isso, toda notificação fica
// registrada em NotificationLog com status "simulado": dá pra auditar
// exatamente o que teria sido enviado, pra quem e com qual texto, sem
// nenhum risco de disparo real antes das credenciais existirem.
//
// Quando o provedor for definido, o envio de verdade entra aqui dentro
// (branch por config.graph/config.smtp) e passa a gravar status
// "enviado"/"falhou" — o resto do sistema (quem chama sendNotification, os
// gatilhos de status do contrato, o botão de enviar PDF) não muda nada.
export async function sendNotification({ eventType, contractId, to, subject, body }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const results = [];
  for (const toEmail of recipients) {
    try {
      logger.info(
        { toEmail, subject, eventType, contractId },
        "notificação simulada — envio de e-mail ainda não configurado"
      );
      const saved = await entityStore.create(
        "NotificationLog",
        { event_type: eventType, contract_id: contractId || null, to_email: toEmail, subject, body, status: "simulado" },
        "system"
      );
      results.push(saved);
    } catch (error) {
      logger.error({ err: error, toEmail, subject, eventType }, "falha ao registrar notificação");
    }
  }
  return results;
}
