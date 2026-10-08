// Planejamento da Gestão Tributária: filtros da tela, opções dos filtros e séries do fluxo de caixa.
// Os totais vêm prontos do servidor (GET /api/tax/planning); aqui só se monta a consulta e se organiza o que a
// tela mostra — nenhuma soma de "a pagar" é refeita no navegador.

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Durações do período que a tela oferece, em meses. O servidor aceita no máximo 36. */
export const PLANNING_DURATIONS = [3, 6, 12, 18, 24, 36];
export const DEFAULT_PLANNING_MONTHS = 12;

/** Filtro de tributo para "tributo não informado" (o servidor recebe o texto literal "null"). */
export const NO_TRIBUTE_FILTER = "null";
export const NO_TRIBUTE_LABEL = "Tributo não informado";

/** O que "estimado" quer dizer, dito uma vez em cada tela que mostra o valor. */
export const ESTIMATE_EXPLANATION =
  "Estimado é o valor cadastrado da parcela, usado enquanto não há guia vinculada. Ele pode ficar abaixo do valor real, " +
  "porque a Receita e as Fazendas corrigem a parcela pela Selic até a guia ser emitida.";
export const ESTIMATE_SHORT_NOTE = "Sem guia vinculada: valor cadastrado, que pode ficar abaixo do real até a guia ser emitida.";

export const PLANNING_SPHERES = [
  { value: "federal", label: "Federal" },
  { value: "estadual", label: "Estadual" },
];

const SPHERE_VALUES = new Set(PLANNING_SPHERES.map((item) => item.value));

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function isMonth(value) {
  return MONTH_PATTERN.test(String(value || ""));
}

/** Soma meses a um mês AAAA-MM. */
export function addMonthsToMonth(month, count) {
  const match = MONTH_PATTERN.exec(String(month || ""));
  if (!match) return null;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + count;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "Outubro de 2026". */
export function monthName(month) {
  const match = MONTH_PATTERN.exec(String(month || ""));
  if (!match) return "";
  const name = MONTH_NAMES[Number(match[2]) - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${match[1]}`;
}

/** "out/26", para o eixo do gráfico. */
export function shortMonthLabel(month) {
  const match = MONTH_PATTERN.exec(String(month || ""));
  if (!match) return "";
  return `${MONTH_NAMES[Number(match[2]) - 1].slice(0, 3)}/${match[1].slice(2)}`;
}

/** Meses que o filtro "a partir de" oferece: de `past` meses atrás até `future` meses à frente do mês atual. */
export function startMonthOptions(currentMonth, { past = 24, future = 24 } = {}) {
  const options = [];
  for (let offset = -past; offset <= future; offset += 1) {
    const value = addMonthsToMonth(currentMonth, offset);
    options.push({ value, label: offset === 0 ? `${monthName(value)} (mês atual)` : monthName(value) });
  }
  return options;
}

/** Valor da opção de órgão: o nome e a UF juntos, porque o mesmo órgão pode existir em mais de um estado. */
export function agencyOptionValue(orgao, uf) {
  return `${String(orgao || "").trim()}|${String(uf || "").trim().toUpperCase()}`;
}

export function parseAgencyOption(value) {
  const text = String(value || "");
  const separator = text.lastIndexOf("|");
  if (separator <= 0) return null;
  const orgao = text.slice(0, separator).trim();
  if (!orgao) return null;
  return { orgao, uf: text.slice(separator + 1).trim() || null };
}

function agencyLabel(orgao, uf) {
  return uf ? `${orgao} — ${uf}` : orgao;
}

/**
 * Filtros da tela lidos da URL. Valor que não faz sentido volta ao padrão (período) ou some (demais filtros):
 * a consulta nunca vai ao servidor com um valor que a tela não sabe mostrar.
 * @param {URLSearchParams} params
 * @param {string} currentMonth AAAA-MM de hoje
 */
export function readPlanningFilters(params, currentMonth) {
  const get = (key) => (params.get(key) || "").trim();
  const inicio = isMonth(get("inicio")) ? get("inicio") : currentMonth;
  const meses = Number(get("meses"));
  const esfera = get("esfera").toLowerCase();
  return {
    inicio,
    meses: PLANNING_DURATIONS.includes(meses) ? meses : DEFAULT_PLANNING_MONTHS,
    empresa: get("empresa"),
    esfera: SPHERE_VALUES.has(esfera) ? esfera : "",
    tributo: get("tributo"),
    orgao: parseAgencyOption(get("orgao")) ? get("orgao") : "",
  };
}

/** True quando algum filtro além do período está aplicado. */
export function hasNarrowingFilters(filters) {
  return Boolean(filters.empresa || filters.esfera || filters.tributo || filters.orgao);
}

/** Parâmetros de GET /api/tax/planning a partir dos filtros da tela (só os preenchidos). */
export function planningQueryParams(filters) {
  const params = { inicio: filters.inicio, fim: addMonthsToMonth(filters.inicio, filters.meses - 1) };
  if (filters.empresa) params.entity_id = filters.empresa;
  if (filters.esfera) params.esfera = filters.esfera;
  if (filters.tributo) params.tributo = filters.tributo;
  const agency = parseAgencyOption(filters.orgao);
  if (agency) {
    params.orgao = agency.orgao;
    if (agency.uf) params.uf = agency.uf;
  }
  return params;
}

const byLabel = (a, b) => a.label.localeCompare(b.label, "pt-BR");

/**
 * Opções dos filtros de empresa, tributo e órgão, a partir dos parcelamentos ATIVOS (os únicos que o planejamento
 * soma). Tributo e órgão se comparam sem diferenciar maiúsculas, como o servidor filtra. O órgão acompanha a esfera
 * escolhida.
 */
export function planningFilterOptions(agreements, entities, { esfera = "" } = {}) {
  const active = (agreements || []).filter((agreement) => agreement.situacao === "ativo");
  const entityIds = new Set(active.map((agreement) => agreement.entity_id));
  const empresas = (entities || [])
    .filter((entity) => entityIds.has(entity.id))
    .map((entity) => ({ value: entity.id, label: entity.entity_name }))
    .sort(byLabel);

  const tributes = new Map();
  let withoutTribute = false;
  for (const agreement of active) {
    const tributo = String(agreement.tributo || "").trim();
    if (!tributo) withoutTribute = true;
    else if (!tributes.has(tributo.toLowerCase())) tributes.set(tributo.toLowerCase(), { value: tributo, label: tributo });
  }
  const tributos = [...tributes.values()].sort(byLabel);
  if (withoutTribute) tributos.push({ value: NO_TRIBUTE_FILTER, label: NO_TRIBUTE_LABEL });

  const agencies = new Map();
  for (const agreement of active) {
    if (esfera && agreement.esfera !== esfera) continue;
    const orgao = String(agreement.orgao || "").trim();
    if (!orgao) continue;
    const uf = agreement.esfera === "estadual" ? String(agreement.uf || "").trim().toUpperCase() : "";
    const key = `${orgao.toLowerCase()}|${uf}`;
    if (!agencies.has(key)) agencies.set(key, { value: agencyOptionValue(orgao, uf), label: agencyLabel(orgao, uf) });
  }

  return { empresas, tributos, orgaos: [...agencies.values()].sort(byLabel) };
}

/** Uma barra por mês: parte com guia e parte estimada (empilhadas) e o já pago (barra ao lado). Vencidas não entram. */
export function cashFlowSeries(meses) {
  return (meses || []).map((month) => ({
    mes: month.mes,
    label: shortMonthLabel(month.mes),
    nome: monthName(month.mes),
    com_guia: month.a_pagar.com_guia,
    estimado: month.a_pagar.estimado,
    a_pagar: month.a_pagar.total,
    pago: month.pago.total,
    parcelas_a_pagar: month.a_pagar.parcelas,
    parcelas_pagas_sem_valor: month.pago.parcelas_sem_valor,
  }));
}

/** True quando o período (com os filtros) não tem parcela nenhuma, nem vencida em aberto. */
export function isPlanningEmpty(data) {
  if (!data) return true;
  return (data.vencidas?.parcelas?.length || 0) === 0 && (data.meses || []).every((month) => month.parcelas.length === 0);
}

/** Primeiro mês do período com alguma parcela listada — o que o calendário abre já expandido. */
export function firstMonthWithInstallments(meses) {
  return (meses || []).find((month) => month.parcelas.length > 0)?.mes || null;
}

/** Recortes que a tela oferece, na ordem das abas. */
export const PLANNING_BREAKDOWNS = [
  { key: "por_empresa", label: "Empresa", column: "Empresa" },
  { key: "por_esfera", label: "Esfera", column: "Esfera" },
  { key: "por_tributo", label: "Tributo", column: "Tributo" },
  { key: "por_orgao", label: "Órgão", column: "Órgão" },
  { key: "por_parcelamento", label: "Parcelamento", column: "Parcelamento" },
];

/** Quantas parcelas: "1 parcela", "3 parcelas". */
export function installmentCount(count) {
  return `${count} ${count === 1 ? "parcela" : "parcelas"}`;
}
