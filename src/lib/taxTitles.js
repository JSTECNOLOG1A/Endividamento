// Título a pagar da parcela de tributo no Protheus: regras e textos que a tela usa. A situação vem do servidor
// (`situacao` + `situacao_label`); aqui só se decide a cor, o texto de apoio e o recado depois de uma ação.

/** Parâmetro da URL de Contas a Pagar que abre um título de tributo. */
export const TAX_TITLE_URL_PARAM = "tributo";

/** Endereço do título de tributo em Contas a Pagar. */
export function taxTitleLink(titleId) {
  return `/AccountsPayable?${new URLSearchParams({ [TAX_TITLE_URL_PARAM]: titleId }).toString()}`;
}

const TONES = {
  pendente: "warning",
  incerto: "warning",
  recusado: "danger",
  conferencia: "danger",
  enviado: "success",
  baixado: "info",
  parcial: "info",
  estornado: "neutral",
};

/** Cor do selo: warning, danger, success, info ou neutral (situação desconhecida). */
export function taxTitleTone(title) {
  return TONES[title?.situacao] || "neutral";
}

/** Rótulo da situação como o servidor mandou; sem rótulo, um texto neutro (nunca o valor interno). */
export function taxTitleStatusLabel(title) {
  return title?.situacao_label || "Situação não informada";
}

/** True quando a situação pede alguém olhar (pendente, sem confirmação, recusado, conferência). */
export function taxTitleNeedsAttention(title) {
  const tone = taxTitleTone(title);
  return tone === "warning" || tone === "danger";
}

/** "Parcelamento nº 123 · Receita Federal · parcela 4". */
export function taxTitleOrigin(title) {
  if (!title) return "";
  const parts = [];
  if (title.codigo_parcelamento) parts.push(`Parcelamento nº ${title.codigo_parcelamento}`);
  if (title.orgao) parts.push(title.orgao);
  if (title.numero_parcela !== null && title.numero_parcela !== undefined) parts.push(`parcela ${title.numero_parcela}`);
  return parts.join(" · ");
}

/**
 * Chave do título no Protheus: "TRB 000000123/01". Sem prefixo (pendente sem prefixo configurado) não há chave a
 * mostrar. Em título pendente a chave é a prevista (`previsto`).
 */
export function taxTitleKey(title) {
  const prefix = String(title?.prefixo || "").trim();
  if (!prefix || !title?.numero) return "";
  const installment = String(title.parcela || "").trim();
  return `${prefix} ${title.numero}${installment ? `/${installment}` : ""}`;
}

/**
 * Linha digitável em blocos para leitura: guia de arrecadação (48 dígitos) em 4 blocos de 11 + dígito; boleto
 * (47 dígitos) no formato bancário. Outro tamanho volta como veio.
 */
export function formatPaymentLine(line) {
  const digits = String(line || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 48) {
    const blocks = [];
    for (let i = 0; i < 4; i += 1) {
      const start = i * 12;
      blocks.push(`${digits.slice(start, start + 11)}-${digits[start + 11]}`);
    }
    return blocks.join(" ");
  }
  if (digits.length === 47) {
    return [
      `${digits.slice(0, 5)}.${digits.slice(5, 10)}`,
      `${digits.slice(10, 15)}.${digits.slice(15, 21)}`,
      `${digits.slice(21, 26)}.${digits.slice(26, 32)}`,
      digits.slice(32, 33),
      digits.slice(33),
    ].join(" ");
  }
  return String(line);
}

/**
 * Textos de apoio do título: o motivo (o que o AllDebt decidiu) e a resposta do Protheus, sem repetir o mesmo texto.
 * @returns {{ motivo: string | null, erpMensagem: string | null }}
 */
export function taxTitleNotes(title) {
  const motivo = String(title?.motivo || "").trim() || null;
  const erp = String(title?.erp_mensagem || "").trim() || null;
  return { motivo, erpMensagem: erp && erp !== motivo ? erp : null };
}

/** Busca livre: empresa, parcelamento, órgão, parcela, chave do título, histórico, situação. */
export function matchesTaxTitleSearch(title, term) {
  const text = String(term || "").trim().toLowerCase();
  if (!text) return true;
  return [
    "tributo",
    title.entity_name,
    title.codigo_parcelamento,
    title.orgao,
    title.numero_parcela,
    taxTitleKey(title),
    title.tipo,
    title.natureza,
    title.fornecedor,
    title.historico,
    title.situacao_label,
  ]
    .filter((item) => item !== null && item !== undefined)
    .join(" ")
    .toLowerCase()
    .includes(text);
}

/**
 * Filtra os títulos de tributo pela busca, empresa e situação da tela.
 * @param {object[]} titles
 * @param {{ term?: string, entityId?: string | null, situacao?: string | null }} filters
 */
export function filterTaxTitles(titles, { term = "", entityId = null, situacao = null } = {}) {
  return (titles || []).filter((title) => {
    if (entityId && title.entity_id !== entityId) return false;
    if (situacao && title.situacao !== situacao) return false;
    return matchesTaxTitleSearch(title, term);
  });
}

/** Situações presentes na lista (para o filtro), com o rótulo do servidor, em ordem alfabética. */
export function taxTitleSituationOptions(titles) {
  const seen = new Map();
  for (const title of titles || []) {
    if (title?.situacao && !seen.has(title.situacao)) seen.set(title.situacao, taxTitleStatusLabel(title));
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export function taxTitleTotals(titles) {
  return (titles || []).reduce(
    (acc, title) => {
      acc.valor += Number(title.valor) || 0;
      acc.saldo += Number(title.saldo) || 0;
      return acc;
    },
    { valor: 0, saldo: 0 }
  );
}

/**
 * Recado depois de Integrar, Consultar ou Confirmar ausência, pela situação que o servidor devolveu.
 * @returns {{ type: "success" | "warning", message: string, description?: string }}
 */
export function taxTitleActionOutcome(title) {
  const { motivo, erpMensagem } = taxTitleNotes(title);
  const label = taxTitleStatusLabel(title);
  switch (title?.situacao) {
    case "enviado":
      return { type: "success", message: "Título de tributo integrado no Protheus." };
    case "baixado":
    case "parcial":
      return { type: "success", message: `Título de tributo consultado: ${label.toLowerCase()} no Protheus.` };
    case "estornado":
      return { type: "success", message: "Título de tributo fora do Protheus (estornado).", description: motivo || undefined };
    case "recusado":
      return { type: "warning", message: "O Protheus recusou o título de tributo.", description: erpMensagem || motivo || undefined };
    case "incerto":
      return { type: "warning", message: "O Protheus não confirmou o envio.", description: erpMensagem || motivo || undefined };
    case "conferencia":
      return { type: "warning", message: "O título de tributo precisa de conferência.", description: motivo || undefined };
    case "pendente":
      return { type: "warning", message: "O título de tributo continua pendente.", description: motivo || erpMensagem || undefined };
    default:
      return { type: "success", message: `Situação do título de tributo: ${label}.` };
  }
}

/** True quando os dados do título são previstos a partir da guia (pendente), ainda não enviados ao Protheus. */
export function isTaxTitleForecast(title) {
  return title?.previsto === true;
}

export const TAX_TITLE_FORECAST_LABEL = "previsto, ainda não enviado ao Protheus";

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Recado do "Consultar títulos" para os títulos de tributo, a partir do resumo do servidor.
 * @returns {{ type: "success" | "warning" | "info", message: string, description?: string }}
 */
export function taxTitlesConsultOutcome(summary) {
  const total = Number(summary?.total) || 0;
  if (!total) return { type: "info", message: "Tributos — nenhum título de tributo para consultar no Protheus." };
  const by = summary?.por_resultado || {};
  const count = (key) => Number(by[key]) || 0;
  const conference = Number(summary?.conferencia) || 0;
  // Divergente (achado em outra filial ou com outro valor) já vai para conferência: entra no total de conferência,
  // então a conferência só conta à parte o que sobra.
  const otherConference = Math.max(0, conference - count("divergente"));
  const parts = [
    count("encontrado") && plural(count("encontrado"), "encontrado no Protheus", "encontrados no Protheus"),
    count("nao_encontrado") && plural(count("nao_encontrado"), "não encontrado", "não encontrados"),
    count("divergente") &&
      plural(count("divergente"), "com divergência no Protheus, precisa de conferência", "com divergência no Protheus, precisam de conferência"),
    count("inconclusivo") && plural(count("inconclusivo"), "sem resposta do Protheus", "sem resposta do Protheus"),
    count("ocupado") && plural(count("ocupado"), "com outra operação em andamento (não consultado)", "com outra operação em andamento (não consultados)"),
    count("erro") && plural(count("erro"), "com erro", "com erro"),
    otherConference && plural(otherConference, "precisa de conferência", "precisam de conferência"),
  ].filter(Boolean);
  const consulted = Number(summary?.consultados) || 0;
  const clean =
    !count("nao_encontrado") && !count("divergente") && !count("inconclusivo") && !count("ocupado") && !count("erro") && !conference;
  return {
    type: clean ? "success" : "warning",
    message: `Tributos — ${consulted} de ${plural(total, "título consultado", "títulos consultados")}`,
    description: parts.length ? `${parts.join(" · ")}.` : undefined,
  };
}

/**
 * Exclusão de parcela/parcelamento barrada pelo título de tributo (409 TAX_TITLE_BLOCKS_DELETION): os motivos por
 * parcela, como o servidor escreveu; sem a lista, a mensagem do erro. Outro erro: null.
 * @returns {string[] | null}
 */
export function deletionBlockReasons(error) {
  if (error?.code !== "TAX_TITLE_BLOCKS_DELETION") return null;
  const reasons = (error.data?.details?.motivos || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (reasons.length) return reasons;
  return [error.message || "Há título de tributo no Protheus que não foi estornado com confirmação."];
}
