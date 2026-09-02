import nodemailer from "nodemailer";
import { config } from "../../config.js";
import { logger } from "../../logger.js";

let transporter = null;

function getTransporter() {
  if (!config.smtpHost) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  const transport = getTransporter();
  if (!transport) {
    logger.warn({ to, subject }, "SMTP não configurado; e-mail não enviado");
    return { sent: false };
  }
  try {
    await transport.sendMail({
      from: config.smtpFrom,
      to,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (error) {
    logger.error({ err: error, to, subject }, "falha ao enviar e-mail");
    return { sent: false, error: error.message };
  }
}

export function resetPasswordEmail({ fullName, resetUrl }) {
  const subject = "Redefinir senha — Endividamento";
  const text = [
    `Olá, ${fullName || ""}.`,
    "",
    "Recebemos um pedido para redefinir sua senha.",
    "Se foi você, acesse o link abaixo (válido por 2 horas):",
    resetUrl,
    "",
    "Se você não pediu isso, ignore este e-mail.",
  ].join("\n");
  const html = `
    <p>Olá, ${escapeHtml(fullName || "")}.</p>
    <p>Recebemos um pedido para redefinir sua senha.</p>
    <p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Redefinir senha</a></p>
    <p>O link vale por 2 horas. Se você não pediu isso, ignore este e-mail.</p>
  `;
  return { subject, text, html };
}

export function inviteEmail({ fullName, inviteUrl, invitedBy }) {
  const subject = "Convite para o Endividamento";
  const text = [
    `Olá, ${fullName}.`,
    "",
    `${invitedBy || "Um administrador"} convidou você para acessar o Endividamento.`,
    "Defina sua senha neste link (válido por 7 dias):",
    inviteUrl,
  ].join("\n");
  const html = `
    <p>Olá, ${escapeHtml(fullName)}.</p>
    <p>${escapeHtml(invitedBy || "Um administrador")} convidou você para acessar o Endividamento.</p>
    <p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Definir senha</a></p>
    <p>O link vale por 7 dias.</p>
  `;
  return { subject, text, html };
}

export function confirmationEmail({ fullName, companyName, confirmUrl }) {
  const subject = "Conclua o cadastro no Endividamento";
  const text = [
    `Olá, ${fullName}.`,
    "",
    `Você iniciou o cadastro da empresa ${companyName} no Endividamento.`,
    "Para criar sua senha e concluir o cadastro, acesse o link abaixo:",
    confirmUrl,
    "",
    "O link expira em 48 horas. Se você não solicitou este cadastro, ignore este e-mail.",
  ].join("\n");
  const html = `
    <p>Olá, ${escapeHtml(fullName)}.</p>
    <p>Você iniciou o cadastro da empresa <strong>${escapeHtml(companyName)}</strong> no Endividamento.</p>
    <p>Para criar sua senha e concluir o cadastro, clique no botão abaixo:</p>
    <p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Concluir cadastro</a></p>
    <p>Ou copie este link: <br/><a href="${escapeHtml(confirmUrl)}">${escapeHtml(confirmUrl)}</a></p>
    <p>O link expira em 48 horas. Se você não solicitou este cadastro, ignore este e-mail.</p>
  `;
  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
