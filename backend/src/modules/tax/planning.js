import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { logIsolationMiss, requireTenantContext } from "../tenants/scope.js";
import { addDays, addMonths, brazilDate, lastDayOfMonth, monthLabel, monthsBetween } from "./brazilClock.js";
import { GUIDE_STATUS_LABELS, amountToPay } from "./guideRules.js";
import { installmentStatusLabel } from "./labels.js";
import { validationError } from "./rules.js";
import { TITLE_STATUS_LABELS } from "./taxTitles.js";

// Planejamento da Gestão Tributária: calendário e fluxo de caixa dos vencimentos das parcelas, agregados no servidor
// (sem teto de leitura), e a série dos tributos nos vencimentos do Dashboard.
//
// O que entra:
// - Só parcelamentos ATIVOS. Quitado, rescindido e suspenso ficam de fora: não há o que pagar neles pelo calendário.
// - "A pagar": parcela em aberto com vencimento de hoje em diante. Valor para pagamento = o da guia vinculada, senão o
//   cadastrado (estimado) — um ou outro, nunca os dois somados (guideRules.amountToPay). Cada total separa quanto vem
//   de guia e quanto é estimado.
// - "Vencidas": parcela em aberto com vencimento antes de hoje. Ficam num bloco à parte, nunca somadas ao "a pagar" de
//   mês nenhum, e não somem por estarem fora do período.
// - "Pago": parcela paga (aguardando reconhecimento ou reconhecida), pelo mês do vencimento, com o valor pago
//   informado. Nunca somado ao "a pagar". Pagamento sem valor informado é contado à parte, nunca vira zero.
// - Parcela cancelada não entra.
// "Hoje" é a data civil de Brasília.

const DEFAULT_MONTHS = 12;
export const MAX_PLANNING_MONTHS = 36;
const PAID_STATUSES = new Set(["paga_aguardando_reconhecimento", "reconhecida"]);
const SPHERE_LABELS = { federal: "Federal", estadual: "Estadual", municipal: "Municipal" };
const SPHERES = new Set(["federal", "estadual"]);
const NO_GUIDE = "sem_guia";
const GUIDE_LABELS = { [NO_GUIDE]: "Sem guia", ...GUIDE_STATUS_LABELS };
/** Valor literal do filtro de tributo para "tributo não informado". */
export const NO_TRIBUTE_FILTER = "null";
const NO_TRIBUTE_LABEL = "Tributo não informado";

/** Janelas de vencimento do Dashboard, em dias a partir da data-base (as mesmas da dívida bancária). */
export const DASHBOARD_WINDOWS = { d30: 30, d90: 90, d180: 180 };

const FIELD_LABELS = {
  inicio: "início do período",
  fim: "fim do período",
  entity_id: "empresa",
  agreement_id: "parcelamento",
  esfera: "esfera",
  tributo: "tributo",
  orgao: "órgão",
  uf: "UF",
};

// ---------------------------------------------------------------------------
// Valores em centavos (soma sem erro de arredondamento)
// ---------------------------------------------------------------------------

function cents(value) {
  if (value === null || value === undefined) return null;
  return Math.round(Number(value) * 100);
}

const reais = (value) => value / 100;

function newDue() {
  return { com_guia: 0, estimado: 0, parcelas: 0, parcelas_com_guia: 0, parcelas_estimadas: 0 };
}

function addDue(bucket, item) {
  if (item.origem_valor === "guia") {
    bucket.com_guia += item.cents;
    bucket.parcelas_com_guia += 1;
  } else {
    bucket.estimado += item.cents;
    bucket.parcelas_estimadas += 1;
  }
  bucket.parcelas += 1;
}

function presentDue(bucket) {
  return {
    total: reais(bucket.com_guia + bucket.estimado),
    com_guia: reais(bucket.com_guia),
    estimado: reais(bucket.estimado),
    parcelas: bucket.parcelas,
    parcelas_com_guia: bucket.parcelas_com_guia,
    parcelas_estimadas: bucket.parcelas_estimadas,
  };
}

function newPaid() {
  return { total: 0, parcelas: 0, parcelas_sem_valor: 0 };
}

function addPaid(bucket, item) {
  bucket.parcelas += 1;
  if (item.cents === null) bucket.parcelas_sem_valor += 1;
  else bucket.total += item.cents;
}

function presentPaid(bucket) {
  return { total: reais(bucket.total), parcelas: bucket.parcelas, parcelas_sem_valor: bucket.parcelas_sem_valor };
}

// ---------------------------------------------------------------------------
// Parcela
// ---------------------------------------------------------------------------

function agencyLabel(row) {
  return row.esfera === "estadual" && row.uf ? `${row.orgao} — ${row.uf}` : row.orgao;
}

/**
 * Onde a parcela conta, em `today` (AAAA-MM-DD): "a_pagar", "vencida", "pago" — ou null (cancelada, fora do cálculo).
 */
export function installmentBucket(situacao, vencimento, today) {
  if (situacao === "em_aberto") return vencimento < today ? "vencida" : "a_pagar";
  if (PAID_STATUSES.has(situacao)) return "pago";
  return null;
}

/**
 * Parcela como o calendário recebe, com o valor que vale para pagamento e de onde ele vem.
 * `row` é a linha da consulta (valores em texto, como o banco devolve NUMERIC).
 */
export function presentPlanningInstallment(row, today) {
  const contaEm = installmentBucket(row.situacao, row.vencimento, today);
  if (!contaEm) return null;
  const guideSituacao = row.guide_situacao || NO_GUIDE;
  const fromGuide = amountToPay({ situacao: row.guide_situacao, valor_guia: row.valor_guia === null ? null : Number(row.valor_guia) });
  const paid = contaEm === "pago";
  const origemValor = paid ? null : fromGuide !== null ? "guia" : "estimado";
  const amountCents = paid ? cents(row.valor_pago) : origemValor === "guia" ? cents(row.valor_guia) : cents(row.valor);
  return {
    id: row.id,
    agreement_id: row.agreement_id,
    numero_parcela: row.numero_parcela,
    qtd_parcelas: row.qtd_parcelas,
    vencimento: row.vencimento,
    mes: row.vencimento.slice(0, 7),
    situacao: row.situacao,
    situacao_label: installmentStatusLabel(row.situacao, row.vencimento, today),
    conta_em: contaEm,
    valor_estimado: reais(cents(row.valor)),
    valor_guia: origemValor === "guia" ? reais(amountCents) : null,
    // Valor que vale para pagamento (guia vinculada, senão o estimado). Parcela paga não tem: vale o valor pago.
    valor_para_pagamento: paid ? null : reais(amountCents),
    origem_valor: origemValor,
    data_pagamento: row.data_pagamento,
    valor_pago: row.valor_pago === null ? null : reais(cents(row.valor_pago)),
    guia: { id: row.guide_id || null, situacao: guideSituacao, label: GUIDE_LABELS[guideSituacao] || guideSituacao },
    titulo: row.title_id
      ? { id: row.title_id, situacao: row.title_situacao, situacao_label: TITLE_STATUS_LABELS[row.title_situacao] || row.title_situacao, numero: row.numero_e2 }
      : null,
    entity_id: row.entity_id,
    entity_name: row.entity_name,
    esfera: row.esfera,
    esfera_label: SPHERE_LABELS[row.esfera] || row.esfera,
    uf: row.uf,
    orgao: row.orgao,
    orgao_label: agencyLabel(row),
    modalidade: row.modalidade,
    tributo: row.tributo,
    codigo_parcelamento: row.codigo_parcelamento,
    cents: amountCents,
  };
}

function publicItem(item) {
  const { cents: _omit, ...rest } = item;
  return rest;
}

// ---------------------------------------------------------------------------
// Agregação
// ---------------------------------------------------------------------------

const DIMENSIONS = {
  por_empresa: (item) => ({ chave: item.entity_id, label: item.entity_name }),
  por_esfera: (item) => ({ chave: item.esfera, label: item.esfera_label }),
  por_tributo: (item) => (item.tributo
    ? { chave: item.tributo.toLowerCase(), label: item.tributo }
    : { chave: null, label: NO_TRIBUTE_LABEL }),
  por_orgao: (item) => ({ chave: `${item.orgao.toLowerCase()}|${item.uf || ""}`, label: item.orgao_label }),
  por_parcelamento: (item) => ({
    chave: item.agreement_id,
    label: `${item.codigo_parcelamento} — ${item.orgao_label} — ${item.entity_name}`,
  }),
};

function newDimensionEntry(key, months) {
  return {
    ...key,
    a_pagar: newDue(),
    vencidas: newDue(),
    pago: newPaid(),
    meses: new Map(months.map((month) => [month, { a_pagar: newDue(), pago: newPaid() }])),
  };
}

function presentDimension(map, months) {
  return [...map.values()]
    .map((entry) => ({
      chave: entry.chave,
      label: entry.label,
      a_pagar: presentDue(entry.a_pagar),
      vencidas: presentDue(entry.vencidas),
      pago: presentPaid(entry.pago),
      meses: months.map((month) => ({
        mes: month,
        a_pagar: presentDue(entry.meses.get(month).a_pagar),
        pago: presentPaid(entry.meses.get(month).pago),
      })),
    }))
    // Sem tributo informado vai por último; o resto, em ordem alfabética.
    .sort((a, b) => (a.chave === null) - (b.chave === null) || a.label.localeCompare(b.label, "pt-BR"));
}

/**
 * Agrega as parcelas por mês e por empresa, esfera, tributo, órgão e parcelamento.
 * @param {object[]} rows linhas da consulta (loadPlanningRows)
 * @param {{ today: string, months: string[] }} options hoje (AAAA-MM-DD) e meses do período (AAAA-MM), em ordem
 */
export function aggregatePlanning(rows, { today, months }) {
  const monthly = new Map(months.map((month) => [month, { a_pagar: newDue(), pago: newPaid(), vencidas: 0, parcelas: [] }]));
  const totals = { a_pagar: newDue(), pago: newPaid() };
  const overdue = { a_pagar: newDue(), parcelas: [] };
  const dimensions = Object.fromEntries(Object.keys(DIMENSIONS).map((name) => [name, new Map()]));

  for (const row of rows) {
    const item = presentPlanningInstallment(row, today);
    if (!item) continue;
    const month = monthly.get(item.mes) || null;
    if (item.conta_em !== "vencida" && !month) continue;

    const entries = Object.entries(DIMENSIONS).map(([name, keyOf]) => {
      const key = keyOf(item);
      const map = dimensions[name];
      const mapKey = key.chave ?? "\u0000";
      if (!map.has(mapKey)) map.set(mapKey, newDimensionEntry(key, months));
      return map.get(mapKey);
    });

    if (item.conta_em === "vencida") {
      // Vencida: só no bloco à parte. No calendário do mês aparece listada, mas não entra na soma do mês.
      addDue(overdue.a_pagar, item);
      overdue.parcelas.push(publicItem(item));
      for (const entry of entries) addDue(entry.vencidas, item);
      if (month) {
        month.vencidas += 1;
        month.parcelas.push(publicItem(item));
      }
      continue;
    }

    month.parcelas.push(publicItem(item));
    if (item.conta_em === "a_pagar") {
      addDue(month.a_pagar, item);
      addDue(totals.a_pagar, item);
      for (const entry of entries) {
        addDue(entry.a_pagar, item);
        addDue(entry.meses.get(item.mes).a_pagar, item);
      }
    } else {
      addPaid(month.pago, item);
      addPaid(totals.pago, item);
      for (const entry of entries) {
        addPaid(entry.pago, item);
        addPaid(entry.meses.get(item.mes).pago, item);
      }
    }
  }

  return {
    totais: { a_pagar: presentDue(totals.a_pagar), pago: presentPaid(totals.pago) },
    vencidas: { a_pagar: presentDue(overdue.a_pagar), parcelas: overdue.parcelas },
    meses: months.map((month) => {
      const entry = monthly.get(month);
      return {
        mes: month,
        label: monthLabel(month),
        a_pagar: presentDue(entry.a_pagar),
        pago: presentPaid(entry.pago),
        parcelas_vencidas: entry.vencidas,
        parcelas: entry.parcelas,
      };
    }),
    ...Object.fromEntries(Object.entries(dimensions).map(([name, map]) => [name, presentDimension(map, months)])),
  };
}

// ---------------------------------------------------------------------------
// Entrada (query string)
// ---------------------------------------------------------------------------

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function queryText(query, field) {
  const value = query[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw validationError(field, `Informe um valor só no campo ${FIELD_LABELS[field]}.`);
  }
  const text = value.trim();
  return text === "" ? null : text;
}

function parseMonth(query, field) {
  const text = queryText(query, field);
  if (text === null) return null;
  if (!MONTH_PATTERN.test(text)) {
    throw validationError(field, `Informe o ${FIELD_LABELS[field]} como ano e mês (AAAA-MM), por exemplo 2026-10.`);
  }
  return text;
}

/** Período em meses: padrão = mês atual e os 11 seguintes; só o início = início e os 11 seguintes. */
export function parsePeriod(query, today) {
  const start = parseMonth(query, "inicio") || today.slice(0, 7);
  const end = parseMonth(query, "fim") || addMonths(start, DEFAULT_MONTHS - 1);
  if (end < start) throw validationError("fim", "O fim do período não pode ser antes do início.");
  const months = monthsBetween(start, end);
  if (months.length > MAX_PLANNING_MONTHS) {
    throw validationError("fim", `O período pode ter no máximo ${MAX_PLANNING_MONTHS} meses.`);
  }
  return { inicio: start, fim: end, meses: months };
}

async function assertInGroup(table, field, id, groupId, message) {
  const found = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND group_id = $2`, [id, groupId]);
  if (!found.rows[0]) {
    logIsolationMiss({ table, id });
    const err = new Error(message);
    err.status = 404;
    err.code = "NOT_FOUND";
    err.details = { field };
    throw err;
  }
}

async function parseFilters(query, groupId) {
  const filters = {
    entity_id: queryText(query, "entity_id"),
    agreement_id: queryText(query, "agreement_id"),
    esfera: queryText(query, "esfera")?.toLowerCase() ?? null,
    tributo: queryText(query, "tributo"),
    orgao: queryText(query, "orgao"),
    uf: queryText(query, "uf")?.toUpperCase() ?? null,
  };
  if (filters.esfera && !SPHERES.has(filters.esfera)) {
    throw validationError("esfera", "Esfera inválida. Use federal ou estadual.");
  }
  // Filtro com empresa ou parcelamento de outro cliente (ou inexistente) é recusado: devolver vazio pareceria
  // "nada a pagar".
  if (filters.entity_id) {
    await assertInGroup("company_entities", "entity_id", filters.entity_id, groupId, "Empresa não encontrada");
  }
  if (filters.agreement_id) {
    await assertInGroup("tax_agreements", "agreement_id", filters.agreement_id, groupId, "Parcelamento não encontrado");
  }
  return filters;
}

function filterSql(filters, params) {
  const clauses = [];
  const add = (sql, value) => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.entity_id) add("a.entity_id = ?", filters.entity_id);
  if (filters.agreement_id) add("a.id = ?", filters.agreement_id);
  if (filters.esfera) add("a.esfera = ?", filters.esfera);
  if (filters.tributo === NO_TRIBUTE_FILTER) clauses.push("a.tributo IS NULL");
  else if (filters.tributo) add("lower(a.tributo) = lower(?)", filters.tributo);
  if (filters.orgao) add("lower(a.orgao) = lower(?)", filters.orgao);
  if (filters.uf) add("a.uf = ?", filters.uf);
  return clauses.map((clause) => `AND ${clause}`).join(" ");
}

const INSTALLMENT_COLUMNS = `
  i.id, i.agreement_id, i.numero_parcela, i.vencimento::text AS vencimento, i.valor::text AS valor, i.situacao,
  i.data_pagamento::text AS data_pagamento, i.valor_pago::text AS valor_pago,
  a.entity_id, e.entity_name, a.esfera, a.uf, a.orgao, a.modalidade, a.tributo, a.codigo_parcelamento, a.qtd_parcelas,
  g.id AS guide_id, g.situacao AS guide_situacao, g.valor_guia::text AS valor_guia,
  t.id AS title_id, t.situacao AS title_situacao, t.numero_e2`;

const INSTALLMENT_FROM = `
  FROM tax_installments i
  JOIN tax_agreements a ON a.id = i.agreement_id AND a.group_id = i.group_id
  JOIN company_entities e ON e.id = a.entity_id
  LEFT JOIN tax_installment_guides g ON g.installment_id = i.id AND g.encerrada_em IS NULL
  LEFT JOIN tax_payable_titles t ON t.installment_id = i.id`;

const INSTALLMENT_ORDER = "ORDER BY i.vencimento, e.entity_name, a.codigo_parcelamento, i.numero_parcela";

async function loadPlanningRows(groupId, { from, to, today, filters }) {
  const params = [groupId, from, to, today];
  const extra = filterSql(filters, params);
  // Sem LIMIT: o planejamento soma tudo. Vencidas em aberto entram mesmo fora do período.
  const result = await pool.query(
    `SELECT ${INSTALLMENT_COLUMNS} ${INSTALLMENT_FROM}
      WHERE i.group_id = $1 AND a.situacao = 'ativo' AND i.situacao <> 'cancelada'
        AND (i.vencimento BETWEEN $2::date AND $3::date OR (i.situacao = 'em_aberto' AND i.vencimento < $4::date))
        ${extra}
      ${INSTALLMENT_ORDER}`,
    params
  );
  return result.rows;
}

/**
 * Parcelas em aberto de parcelamentos ativos com vencimento até `lastDate` (inclusive), vencidas incluídas. Sem LIMIT.
 */
export async function loadOpenInstallmentsDueBy(groupId, lastDate) {
  const result = await pool.query(
    `SELECT ${INSTALLMENT_COLUMNS} ${INSTALLMENT_FROM}
      WHERE i.group_id = $1 AND a.situacao = 'ativo' AND i.situacao = 'em_aberto' AND i.vencimento <= $2::date
      ${INSTALLMENT_ORDER}`,
    [groupId, lastDate]
  );
  return result.rows;
}

/**
 * Planejamento do cliente: calendário e fluxo de caixa dos vencimentos no período, com os recortes.
 * @param {object} query inicio, fim (AAAA-MM), entity_id, agreement_id, esfera, tributo ("null" = não informado), orgao, uf
 */
export async function getTaxPlanning(query = {}, { now = new Date() } = {}) {
  const groupId = requireTenantContext();
  const today = brazilDate(now);
  const period = parsePeriod(query, today);
  const filters = await parseFilters(query, groupId);
  const rows = await loadPlanningRows(groupId, {
    from: `${period.inicio}-01`,
    to: lastDayOfMonth(period.fim),
    today,
    filters,
  });
  return {
    hoje: today,
    periodo: { inicio: period.inicio, fim: period.fim },
    filtros: filters,
    ...aggregatePlanning(rows, { today, months: period.meses }),
  };
}

// ---------------------------------------------------------------------------
// Dashboard: vencimentos dos tributos ao lado dos bancários
// ---------------------------------------------------------------------------

function newWindow() {
  return { ...newDue(), pago: 0, parcelas_pagas: 0, parcelas_pagas_sem_valor: 0 };
}

// Uma parcela entra na janela uma vez só, por um valor só: o que vale para pagamento (em aberto) ou o pago (paga).
function addToWindow(bucket, item) {
  if (item.conta_em !== "pago") {
    addDue(bucket, item);
    return;
  }
  bucket.parcelas += 1;
  bucket.parcelas_pagas += 1;
  if (item.cents === null) bucket.parcelas_pagas_sem_valor += 1;
  else bucket.pago += item.cents;
}

function presentWindow(bucket) {
  return {
    total: reais(bucket.com_guia + bucket.estimado + bucket.pago),
    com_guia: reais(bucket.com_guia),
    estimado: reais(bucket.estimado),
    pago: reais(bucket.pago),
    parcelas: bucket.parcelas,
    parcelas_com_guia: bucket.parcelas_com_guia,
    parcelas_estimadas: bucket.parcelas_estimadas,
    parcelas_pagas: bucket.parcelas_pagas,
    parcelas_pagas_sem_valor: bucket.parcelas_pagas_sem_valor,
  };
}

/**
 * Janelas de 30/90/180 dias a partir da data-base com a MESMA regra da dívida bancária (dashboardSummary.js): somam o
 * cronograma da janela — toda parcela com vencimento depois da data-base e até o limite, paga ou não. Em aberto vale o
 * valor para pagamento (guia vinculada, senão estimado); paga vale o valor pago (sem valor informado: contada à parte,
 * nunca como zero nem pelo estimado). Cancelada não entra.
 * `vencidas` é outra coisa: a situação de hoje (em aberto com vencimento antes de hoje), à parte e nunca somada às
 * janelas — com data-base no passado, uma parcela pode estar na janela (cronograma) e em vencidas (situação atual).
 */
export function aggregateDueWindows(rows, { dataBase, today }) {
  const limits = Object.fromEntries(Object.entries(DASHBOARD_WINDOWS).map(([key, days]) => [key, addDays(dataBase, days)]));
  const windows = Object.fromEntries(Object.keys(DASHBOARD_WINDOWS).map((key) => [key, newWindow()]));
  const overdue = newDue();
  for (const row of rows) {
    const item = presentPlanningInstallment(row, today);
    if (!item) continue;
    if (item.conta_em === "vencida") addDue(overdue, item);
    if (item.vencimento <= dataBase) continue;
    for (const [key, limit] of Object.entries(limits)) {
      if (item.vencimento <= limit) addToWindow(windows[key], item);
    }
  }
  return {
    ...Object.fromEntries(Object.entries(windows).map(([key, bucket]) => [key, presentWindow(bucket)])),
    vencidas: presentDue(overdue),
  };
}

const DASHBOARD_FAILURE = "Não foi possível carregar os vencimentos dos tributos agora. Os valores dos tributos não estão sendo mostrados; tente de novo em instantes.";

/**
 * Série dos tributos para o Dashboard, nas empresas `entityIds` (quem chama decide quais — accounting/dashboardRoutes.js,
 * taxEntityScope) e só de parcelamentos ativos. Vencidas em aberto entram todas, qualquer que seja a data-base. Falha na
 * leitura nunca vira zero:
 * volta `ok: false` com a mensagem, e o resto do Dashboard continua.
 */
export async function getDashboardTaxDue({ entityIds, dataBase, now = new Date() }) {
  const groupId = requireTenantContext();
  const today = brazilDate(now);
  try {
    const result = entityIds.length
      ? await pool.query(
        `SELECT ${INSTALLMENT_COLUMNS} ${INSTALLMENT_FROM}
          WHERE i.group_id = $1 AND a.situacao = 'ativo' AND i.situacao <> 'cancelada'
            AND a.entity_id = ANY($2::text[])
            AND ((i.vencimento > $5::date AND i.vencimento <= $3::date) OR (i.situacao = 'em_aberto' AND i.vencimento < $4::date))
          ${INSTALLMENT_ORDER}`,
        [groupId, entityIds, addDays(dataBase, DASHBOARD_WINDOWS.d180), today, dataBase]
      )
      : { rows: [] };
    return { ok: true, hoje: today, dataBase, ...aggregateDueWindows(result.rows, { dataBase, today }) };
  } catch (error) {
    logger.error({ err: error, groupId }, "falha ao ler os vencimentos dos tributos para o Dashboard");
    return { ok: false, mensagem: DASHBOARD_FAILURE };
  }
}
