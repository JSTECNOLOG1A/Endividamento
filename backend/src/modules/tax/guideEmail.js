import { escapeHtml } from "./html.js";
import { formatGuideLine } from "./guideLine.js";
import { amountToPay, civilDateLabel, formatCnpj, onlyDigits } from "./guideRules.js";

// Texto do e-mail que leva a guia de uma parcela ao financeiro. Tudo o que a pessoa precisa para pagar sem
// abrir o sistema: empresa, órgão, número do parcelamento, parcela, vencimento, valor e linha digitável.

const MONEY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function money(value) {
  return value === null || value === undefined ? null : MONEY.format(Number(value));
}

// Assunto vai num cabeçalho: sem quebra de linha vinda de dado digitado.
function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function agencyLabel(ctx) {
  return ctx.esfera === "estadual" && ctx.uf ? `${ctx.orgao} — ${ctx.uf}` : ctx.orgao;
}

/**
 * @param {object} params
 * @param {object} params.ctx parcela com dados do parcelamento e da empresa (ver guides.js, loadInstallmentContext)
 * @param {object} params.guide guia atual (linha do banco já convertida)
 * @param {string|undefined} params.message mensagem opcional de quem envia
 * @param {{ email?: string, full_name?: string }} params.sender
 */
export function buildGuideEmail({ ctx, guide, message, sender }) {
  const due = civilDateLabel(ctx.vencimento);
  const payBy = civilDateLabel(guide.pagar_ate);
  const toPay = amountToPay(guide);
  const estimated = money(ctx.valor);
  const cnpj = onlyDigits(ctx.document_number).length === 14 ? formatCnpj(ctx.document_number) : null;
  const installment = ctx.qtd_parcelas ? `${ctx.numero_parcela} de ${ctx.qtd_parcelas}` : String(ctx.numero_parcela);
  const senderName = oneLine(sender?.full_name) || sender?.email || "Usuário do AllDebt";

  const subject = oneLine(
    `Guia para pagamento — ${ctx.entity_name} — ${agencyLabel(ctx)} — parcelamento ${ctx.codigo_parcelamento} — parcela ${ctx.numero_parcela} — vencimento ${due}`
  );

  const rows = [
    ["Empresa", cnpj ? `${ctx.entity_name} (CNPJ ${cnpj})` : ctx.entity_name],
    ["Órgão", agencyLabel(ctx)],
    ["Tributo", ctx.tributo],
    ["Modalidade", ctx.modalidade],
    ["Número do parcelamento", ctx.codigo_parcelamento],
    ["Parcela", installment],
    ["Vencimento da parcela", due],
    ["Pagar até", payBy],
    toPay !== null
      ? ["Valor a pagar", money(toPay)]
      : ["Valor estimado", `${estimated} (a guia não traz o valor; pague o valor impresso na guia)`],
    ["Linha digitável", formatGuideLine(guide.linha_digitavel)],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");

  const attachmentNote = guide.arquivo_chave
    ? "A guia em PDF segue anexa."
    : "Esta guia foi informada pela linha digitável; não há PDF anexo.";
  const footer = `Enviado por ${senderName}${sender?.email ? ` (${sender.email})` : ""} pelo AllDebt.`;

  const text = [
    "Olá,",
    "",
    "Segue a guia para pagamento da parcela abaixo.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(message ? ["", `Mensagem de ${senderName}:`, message] : []),
    "",
    attachmentNote,
    "",
    footer,
  ].join("\n");

  const html = `
    <p>Olá,</p>
    <p>Segue a guia para pagamento da parcela abaixo.</p>
    <table cellpadding="4" cellspacing="0" style="border-collapse:collapse">
      ${rows.map(([label, value]) => `<tr><td style="color:#475569">${escapeHtml(label)}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`).join("\n      ")}
    </table>
    ${message ? `<p><strong>Mensagem de ${escapeHtml(senderName)}:</strong><br/>${escapeHtml(message).replaceAll("\n", "<br/>")}</p>` : ""}
    <p>${escapeHtml(attachmentNote)}</p>
    <p style="color:#64748b">${escapeHtml(footer)}</p>
  `;

  return { subject, text, html };
}
