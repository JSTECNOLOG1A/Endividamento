import { escapeHtml } from "./html.js";
import { civilDateLabel } from "./guideRules.js";

// Texto do resumo diário de vencimentos dos tributos (tax/alerts.js). Linguagem de quem paga as contas: o que vence,
// o que já venceu e o que ainda está sem guia, com o valor e de onde ele vem (guia ou estimado).

const MONEY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** Linhas mostradas por seção; as demais ficam no link do Planejamento (a contagem é sempre a completa). */
export const MAX_ROWS_PER_SECTION = 30;

const SPHERE_PAGES = { federal: "TaxFederal", estadual: "TaxState" };

function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function plural(count, singular, pluralText) {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function pageUrl(appUrl, page, params = null) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `${appUrl}/${page}${query}`;
}

function installmentUrl(appUrl, item) {
  const page = SPHERE_PAGES[item.esfera] || "TaxOverview";
  return pageUrl(appUrl, page, { acordo: item.agreement_id, guia: item.id });
}

function valueLabel(item) {
  const amount = MONEY.format(item.valor_para_pagamento);
  return item.origem_valor === "guia" ? `${amount} (valor da guia)` : `${amount} (estimado, sem guia vinculada)`;
}

function installmentLabel(item) {
  return item.qtd_parcelas ? `${item.numero_parcela} de ${item.qtd_parcelas}` : String(item.numero_parcela);
}

function rowCells(item) {
  return [
    ["Empresa", item.entity_name],
    ["Parcelamento", `${item.codigo_parcelamento} — ${item.orgao_label}${item.tributo ? ` — ${item.tributo}` : ""}`],
    ["Parcela", installmentLabel(item)],
    ["Vencimento", civilDateLabel(item.vencimento)],
    ["Valor", valueLabel(item)],
    ["Guia", item.guia.label],
  ];
}

const SECTIONS = [
  {
    key: "vencidas",
    title: "Parcelas vencidas e não pagas",
    intro: "Estas parcelas já venceram e não têm pagamento registrado.",
  },
  {
    key: "a_vencer",
    title: (days) => `Parcelas que vencem nos próximos ${days} dias`,
    intro: "Parcelas em aberto com vencimento de hoje até a data limite.",
  },
  {
    key: "guia_pendente",
    title: "Guia pendente",
    intro: "Parcelas que vencem nos próximos dias e ainda não têm guia vinculada (sem guia ou com guia em exceção).",
  },
];

function sectionTitle(section, days) {
  return typeof section.title === "function" ? section.title(days) : section.title;
}

/**
 * @param {object} params
 * @param {string} params.tenantName nome do cliente
 * @param {string|null} params.recipientName nome de quem recebe
 * @param {string} params.today AAAA-MM-DD
 * @param {number} params.dueSoonDays janela do "a vencer"
 * @param {{ a_vencer: object[], vencidas: object[], guia_pendente: object[] }} params.content parcelas (planning.js)
 * @param {string} params.appUrl endereço público do sistema, sem barra no fim
 */
export function buildTaxAlertEmail({ tenantName, recipientName, today, dueSoonDays, content, appUrl }) {
  const counts = {
    a_vencer: content.a_vencer.length,
    vencidas: content.vencidas.length,
    guia_pendente: content.guia_pendente.length,
  };
  const summaryParts = [
    counts.vencidas ? plural(counts.vencidas, "vencida", "vencidas") : null,
    counts.a_vencer ? `${plural(counts.a_vencer, "vence", "vencem")} em até ${dueSoonDays} dias` : null,
    counts.guia_pendente ? `${counts.guia_pendente} com guia pendente` : null,
  ].filter(Boolean);
  const subject = oneLine(`Tributos: ${summaryParts.join(", ")} — ${tenantName} — AllDebt`);

  const planningUrl = pageUrl(appUrl, "TaxPlanning");
  const greeting = recipientName ? `Olá, ${oneLine(recipientName)}.` : "Olá.";
  const intro = `Resumo de ${civilDateLabel(today)} dos parcelamentos de tributos de ${tenantName}.`;
  const valueNote = "Quando a parcela tem guia vinculada, o valor é o da guia. Sem guia, o valor é estimado (o cadastrado na parcela) e pode mudar.";
  const footer = "Você recebe este resumo porque tem acesso à Gestão Tributária no AllDebt. Para deixar de receber, desligue os alertas por e-mail em Gestão Tributária > Planejamento.";

  const textSections = [];
  const htmlSections = [];
  for (const section of SECTIONS) {
    const items = content[section.key];
    if (!items.length) continue;
    const title = `${sectionTitle(section, dueSoonDays)} (${items.length})`;
    const shown = items.slice(0, MAX_ROWS_PER_SECTION);
    const hidden = items.length - shown.length;
    const moreText = hidden > 0 ? `E mais ${plural(hidden, "parcela", "parcelas")}: veja todas no Planejamento.` : null;

    textSections.push([
      title,
      section.intro,
      ...shown.map((item) => `- ${rowCells(item).map(([label, value]) => `${label}: ${value}`).join(" | ")}\n  ${installmentUrl(appUrl, item)}`),
      ...(moreText ? [moreText] : []),
    ].join("\n"));

    const header = rowCells(shown[0]).map(([label]) => `<th align="left" style="padding:4px 8px;color:#475569;font-weight:600">${escapeHtml(label)}</th>`).join("");
    const rows = shown.map((item) => {
      const cells = rowCells(item).map(([, value]) => `<td style="padding:4px 8px;border-top:1px solid #e2e8f0">${escapeHtml(value)}</td>`).join("");
      return `<tr>${cells}<td style="padding:4px 8px;border-top:1px solid #e2e8f0"><a href="${escapeHtml(installmentUrl(appUrl, item))}">Abrir</a></td></tr>`;
    }).join("\n");
    htmlSections.push(`
      <h3 style="margin:20px 0 4px">${escapeHtml(title)}</h3>
      <p style="margin:0 0 8px;color:#475569">${escapeHtml(section.intro)}</p>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px">
        <tr>${header}<th></th></tr>
        ${rows}
      </table>
      ${moreText ? `<p><a href="${escapeHtml(planningUrl)}">${escapeHtml(moreText)}</a></p>` : ""}`);
  }

  const text = [
    greeting,
    "",
    intro,
    valueNote,
    "",
    ...textSections.flatMap((section) => [section, ""]),
    `Planejamento completo: ${planningUrl}`,
    "",
    footer,
  ].join("\n");

  const html = `
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(intro)}</p>
    <p style="color:#475569">${escapeHtml(valueNote)}</p>
    ${htmlSections.join("\n")}
    <p style="margin-top:20px"><a href="${escapeHtml(planningUrl)}">Abrir o Planejamento da Gestão Tributária</a></p>
    <p style="color:#64748b">${escapeHtml(footer)}</p>
  `;

  return { subject, text, html, counts };
}
