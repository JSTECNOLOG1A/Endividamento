import { pool } from "../../db/pool.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import * as entityStore from "../entities/store.js";
import { sendNotification } from "./mailer.js";
import { requireTenantContext } from "../tenants/scope.js";

function parseStatusHistory(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function adminEmails() {
  const groupId = requireTenantContext();
  const result = await pool.query(
    `SELECT u.email
     FROM users u
     JOIN tenant_users tu ON lower(tu.user_email) = lower(u.email)
     WHERE tu.group_id = $1
       AND u.status = 'active'
       AND u.blocked IS NOT TRUE
       AND u.platform_admin IS NOT TRUE
       AND (u.role = 'admin' OR tu.role IN ('OWNER', 'ADMIN'))`,
    [groupId]
  );
  return [...new Set(result.rows.map((row) => row.email))];
}

// Quem enviou o contrato pra aprovação (procura no histórico, do mais
// recente pro mais antigo, a última transição para "pendente_aprovacao") —
// mais preciso que created_by, que é quem cadastrou o contrato originalmente
// e pode ser outra pessoa.
function submitterEmail(contract) {
  const history = parseStatusHistory(contract.status_history);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.to === "pendente_aprovacao" && history[i]?.by) return history[i].by;
  }
  return contract.created_by || null;
}

async function bankName(bankId) {
  if (!bankId) return "Sem Banco";
  try {
    const bank = await entityStore.getById("Bank", bankId);
    return bank?.bank_name || "Sem Banco";
  } catch {
    return "Sem Banco";
  }
}

function contractLink(contractId) {
  return `${config.appBaseUrl}/Contracts?contract=${contractId}`;
}

/**
 * Dispara os avisos de mudança de status do contrato (pendente → admins,
 * aprovado/devolvido → quem enviou). Chamado depois que o UPDATE já foi
 * persistido — nunca bloqueia nem reverte a mudança de status se o envio
 * falhar (mesmo padrão dos outros efeitos colaterais pós-aprovação, como a
 * geração de títulos a pagar/receber).
 */
export async function notifyContractStatusChange(contract, previousStatus) {
  if (contract.status === previousStatus) return;
  const link = contractLink(contract.id);
  const bank = await bankName(contract.bank_id);
  const label = `${bank} nº ${contract.contract_number}`;

  if (contract.status === "pendente_aprovacao") {
    const to = await adminEmails();
    if (!to.length) {
      logger.warn({ contractId: contract.id }, "nenhum admin ativo para notificar contrato pendente de aprovação");
      return;
    }
    await sendNotification({
      eventType: "contrato_pendente_aprovacao",
      contractId: contract.id,
      to,
      subject: `Contrato ${label} aguardando aprovação`,
      body: `O contrato do ${bank}, número ${contract.contract_number}, foi liberado para sua revisão.\n\nAcesse o link para revisar: ${link}`,
    });
    return;
  }

  if (contract.status === "aprovado") {
    const to = submitterEmail(contract);
    if (!to) return;
    await sendNotification({
      eventType: "contrato_aprovado",
      contractId: contract.id,
      to,
      subject: `Contrato ${label} aprovado`,
      body: `Seu contrato do ${bank}, número ${contract.contract_number}, foi aprovado.\n\nAcesse o link para conferir: ${link}`,
    });
    return;
  }

  if (contract.status === "rascunho" && previousStatus === "pendente_aprovacao") {
    const to = submitterEmail(contract);
    if (!to) return;
    const motivo = contract.rejection_comments
      ? `\n\nComentário de quem devolveu: ${contract.rejection_comments}`
      : "";
    await sendNotification({
      eventType: "contrato_devolvido",
      contractId: contract.id,
      to,
      subject: `Contrato ${label} devolvido`,
      body: `Seu contrato do ${bank}, número ${contract.contract_number}, foi devolvido para ajustes.${motivo}\n\nAcesse o link para revisar: ${link}`,
    });
  }
}
