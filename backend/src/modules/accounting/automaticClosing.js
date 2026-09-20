// Fechamento contábil automático — só para empresas em accounting_mode =
// 'api' (Governança > Entidades). Roda via tarefa agendada no último dia do
// mês (ver backend/src/modules/schedules/tasks.js, chave
// "fechamento_contabil_automatico").
//
// A baixa das parcelas não é inventada aqui: vem do mesmo caminho que já
// existe pra ERP com API — a tarefa consultar_titulos_pagar (rodando de hora
// em hora, ver backend/src/modules/payables/erpIntegrate.js) já traz o
// status de baixa do Protheus pra payable_titles.erp_status = 'baixado'.
// deriveSettlementsFromErp faz a ponte que faltava: transforma esses títulos
// baixados em linhas de contract_settlements, que é o que o motor de
// fechamento (closingEngine.js) realmente lê — mesmo Step 1 que a baixa
// manual preenche em FechamentoContabil.jsx, só que automático.
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import * as store from "../entities/store.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { resolveSettlementRule, findContractsWithoutTitles } from "./settlementRule.js";
import { loadLiveSchedules } from "./liveSchedule.js";
import { todayInSaoPaulo, competenciaEmSaoPaulo } from "./saoPaulo.js";
import { syncPtaxToCurrencies, syncRatesToCdiRates } from "../functions/bacen.js";
import {
  calculateClosingReconciliation,
  buildOpeningEntries,
  deploymentOpeningFromConfigs,
  buildJournalEntries,
  canApproveClosing,
} from "./closingEngine.js";

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// Competência do momento pelo fuso de São Paulo (o servidor roda em UTC).
function currentCompetencia(now = new Date()) {
  return competenciaEmSaoPaulo(now);
}

// Agrupa títulos a pagar já baixados no ERP (erp_status = 'baixado') por
// parcela do contrato e traduz o valor efetivamente baixado (valor - saldo)
// em principal/juros, usando a mesma convenção de prefixo do gerador de
// títulos (FIN/EMP = principal, JUR = juros — ver
// backend/src/modules/payables/generate.js). Prefixos fora dessa convenção
// (ex.: IOF, já contabilizado à parte no evento automático de IOF na
// liberação) caem em other_amount, só pra fechar a soma de caixa da baixa —
// não geram lançamento próprio.
export async function deriveSettlementsFromErp(entityId, groupId, competencia, closingId) {
  const contractsResult = await pool.query(
    `SELECT id FROM loan_contracts WHERE entity_id = $1 AND group_id = $2 AND status = 'aprovado'`,
    [entityId, groupId]
  );
  const contractIds = contractsResult.rows.map((r) => r.id);
  if (!contractIds.length) return { created: 0 };

  const titlesResult = await pool.query(
    `SELECT * FROM payable_titles
     WHERE contract_id = ANY($1::text[])
       AND group_id = $2
       AND status <> 'ignorado_implantacao'
       AND (erp_status = 'baixado' OR baixa_origem = 'manual')
       -- Parcela paga em atraso (vencimento em mês anterior) também entra; quem já virou baixa não repete
       -- (a checagem por contrato+parcela abaixo). A data da baixa decide o mês do pagamento.
       AND COALESCE(baixa_data, vencimento) <= $3::date`,
    [contractIds, groupId, competencia.end]
  );

  const byKey = new Map();
  for (const title of titlesResult.rows) {
    const key = `${title.contract_id}::${title.parcela}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        contract_id: title.contract_id,
        parcela: title.parcela,
        vencimento: title.vencimento,
        baixa_data: title.baixa_data || null,
        principal_paid: 0,
        interest_paid: 0,
        other_amount: 0,
      });
    }
    const bucket = byKey.get(key);
    const paid = r2(Number(title.valor || 0) - Number(title.saldo || 0));
    if (paid <= 0) continue;
    const prefixo = String(title.prefixo || "").toUpperCase();
    if (prefixo === "JUR") bucket.interest_paid = r2(bucket.interest_paid + paid);
    else if (prefixo === "FIN" || prefixo === "EMP") bucket.principal_paid = r2(bucket.principal_paid + paid);
    else bucket.other_amount = r2(bucket.other_amount + paid);
  }

  let created = 0;
  for (const bucket of byKey.values()) {
    const totalPaid = r2(bucket.principal_paid + bucket.interest_paid + bucket.other_amount);
    if (totalPaid <= 0) continue;

    const existing = await pool.query(
      `SELECT id FROM contract_settlements
       WHERE contract_id = $1 AND parcela = $2 AND group_id = $3 AND status <> 'estornado'`,
      [bucket.contract_id, bucket.parcela, groupId]
    );
    if (existing.rows.length) continue;

    // Data do pagamento: a da baixa; sem ela, o vencimento. Baixa anterior à competência (detectada agora)
    // é lançada no primeiro dia desta competência, com a data real na observação, para não se perder num mês já fechado.
    const realDate = dateOnly(bucket.baixa_data || bucket.vencimento);
    const paymentDate = realDate < competencia.start ? competencia.start : realDate;
    await store.create("ContractSettlement", {
      contract_id: bucket.contract_id,
      closing_id: closingId,
      parcela: bucket.parcela,
      scheduled_date: paymentDate,
      actual_payment_date: paymentDate,
      scheduled_amount: totalPaid,
      principal_paid: bucket.principal_paid,
      interest_paid: bucket.interest_paid,
      other_amount: bucket.other_amount,
      total_paid: totalPaid,
      status: "baixado",
      observacao: realDate < competencia.start
        ? `Gerado automaticamente a partir da baixa no ERP (pagamento real em ${realDate})`
        : "Gerado automaticamente a partir da baixa no ERP",
    }, "sistema");
    created += 1;
  }
  return { created };
}

// Cotações (PTAX de venda do BACEN, tabela de Moedas) de cada moeda dos contratos, em ordem crescente de data:
// { [currency_id]: [{rate_date, rate}] }. Cotação do grupo vale sobre a global da mesma data.
export async function loadFxRates(contracts, groupId) {
  const ids = [...new Set(contracts.map((c) => c.currency_id).filter(Boolean))];
  if (!ids.length) return {};
  const rows = (await pool.query(
    `SELECT c.id AS currency_id, r.rate_date, r.exchange_rate, (r.group_id IS NOT NULL) AS own
       FROM currencies c
       JOIN currencies r ON r.currency_code = c.currency_code AND (r.group_id = $1 OR r.group_id IS NULL)
      WHERE c.id = ANY($2::text[]) AND r.exchange_rate IS NOT NULL
      ORDER BY r.rate_date ASC`,
    [groupId, ids]
  )).rows;
  const byCurrency = {};
  for (const r of rows) {
    const key = r.currency_id;
    const date = dateOnly(r.rate_date);
    const list = (byCurrency[key] = byCurrency[key] || []);
    const last = list[list.length - 1];
    if (last && last.rate_date === date) { if (r.own) last.rate = Number(r.exchange_rate); continue; }
    list.push({ rate_date: date, rate: Number(r.exchange_rate) });
  }
  return byCurrency;
}

// Saldos lançados no fechamento anterior (principal e juros a pagar por contrato): base do ajuste de provisão de
// juros dos contratos indexados. Gravados em accounting_closings.extra_json.balances a cada cálculo.
export async function loadLedgerPrev(entityId, groupId, competenciaStart) {
  const prev = (await pool.query(
    `SELECT extra_json FROM accounting_closings
      WHERE entity_id = $1 AND group_id = $2 AND competencia < $3::date
      ORDER BY competencia DESC LIMIT 1`,
    [entityId, groupId, competenciaStart]
  )).rows[0];
  const extra = typeof prev?.extra_json === "string" ? JSON.parse(prev.extra_json) : prev?.extra_json;
  return extra?.balances || {};
}

export async function saveClosingBalances(closingId, groupId, balances) {
  await pool.query(
    `UPDATE accounting_closings SET extra_json = COALESCE(extra_json, '{}'::jsonb) || $3::jsonb WHERE id = $1 AND group_id = $2`,
    [closingId, groupId, JSON.stringify({ balances })]
  );
}

// Feriados (do grupo e globais) para achar o último dia útil da PTAX de fechamento.
export async function loadHolidayDates(groupId) {
  const rows = (await pool.query(`SELECT holiday_date FROM holidays WHERE group_id = $1 OR group_id IS NULL`, [groupId])).rows;
  return rows.map((h) => dateOnly(h.holiday_date));
}

// Atualiza PTAX e índices no início do fechamento: a PTAX do último dia útil (publicada ~13h) só entra na tabela pela
// atualização diária, que pode rodar depois do fechamento. Falha não derruba o fechamento; o gate acusa a cotação faltante.
async function syncMarketData() {
  if (process.env.CLOSING_SKIP_MARKET_SYNC === "1") return { skipped: true };
  const out = {};
  for (const [key, fn] of [["ptax", syncPtaxToCurrencies], ["indices", syncRatesToCdiRates]]) {
    try {
      const r = await fn();
      out[key] = { ok: r.ok !== false, message: r.message || null };
    } catch (error) {
      logger.warn({ err: error }, "atualização de " + key + " antes do fechamento falhou");
      out[key] = { ok: false, message: error.message };
    }
  }
  return out;
}

// Contratos com o cronograma recalculado pelas taxas publicadas (indexados) e as entradas do ajuste de provisão.
async function prepareLiveInputs(entityId, groupId, contracts, competencia) {
  // Taxas conhecidas na data de fechamento: até o fim da competência (ou hoje, se ela ainda está em andamento).
  const todayIso = todayInSaoPaulo();
  const asOf = competencia.end < todayIso ? competencia.end : todayIso;
  const { schedules, failed } = await loadLiveSchedules(contracts, groupId, asOf);
  const liveContracts = contracts.map((c) => (schedules[c.id] ? { ...c, schedule_data: JSON.stringify({ schedule: schedules[c.id] }) } : c));
  const trueUpContracts = Object.fromEntries(Object.keys(schedules).map((id) => [id, true]));
  const ledgerPrev = Object.keys(schedules).length ? await loadLedgerPrev(entityId, groupId, competencia.start) : {};
  return { schedules, failed, liveContracts, trueUpContracts, ledgerPrev };
}

// Baixas (não estornadas) dos contratos, de todos os fechamentos. Na mesma parcela vale a mais recente.
export async function loadEntitySettlements(contractIds, groupId) {
  if (!contractIds.length) return { rows: [] };
  return pool.query(
    `SELECT * FROM contract_settlements
      WHERE group_id = $1 AND contract_id = ANY($2::text[]) AND status <> 'estornado'
      ORDER BY created_date ASC`,
    [groupId, contractIds]
  );
}

function competenciaFromDate(value) {
  const start = dateOnly(value).slice(0, 8) + "01";
  const [year, month] = start.split("-").map(Number);
  const end = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  return { year, month, start, end };
}

/**
 * Sincroniza as baixas do fechamento com o Contas a Pagar (baixa manual ou retorno do ERP) e devolve a regra
 * vigente, as baixas dos contratos da empresa e os avisos. Usada pelo fechamento manual: a baixa da parcela
 * vem do Contas a Pagar, não é mais digitada na tela do fechamento. Fechamento aprovado não recebe baixas novas.
 */
export async function syncClosingSettlements(payload = {}) {
  const { closingId } = payload;
  const groupId = groupIdOrThrow();
  const bad = (status, message) => Object.assign(new Error(message), { status });

  let entityId = payload.entityId;
  let competencia;
  let closingRow = null;
  if (closingId) {
    closingRow = (await pool.query(`SELECT * FROM accounting_closings WHERE id = $1 AND group_id = $2`, [closingId, groupId])).rows[0];
    if (!closingRow) throw bad(404, "Fechamento não encontrado");
    entityId = closingRow.entity_id;
    competencia = competenciaFromDate(closingRow.competencia);
  } else {
    if (!entityId || !/^\d{4}-\d{2}/.test(String(payload.competencia || ""))) throw bad(400, "Informe closingId ou entityId e competencia");
    competencia = competenciaFromDate(payload.competencia);
  }

  const rule = await resolveSettlementRule({ groupId, entityId });
  // Só deriva baixas para um fechamento existente e ainda não aprovado.
  const derived = closingRow && closingRow.status !== "aprovado"
    ? await deriveSettlementsFromErp(entityId, groupId, competencia, closingRow.id)
    : { created: 0 };
  const contracts = (await pool.query(
    `SELECT id FROM loan_contracts WHERE entity_id = $1 AND group_id = $2 AND status = 'aprovado'`,
    [entityId, groupId]
  )).rows;
  const settlements = (await loadEntitySettlements(contracts.map((c) => c.id), groupId)).rows;
  const contratosSemTitulos = await findContractsWithoutTitles({ entityId, groupId, from: rule.from, endIso: competencia.end });
  // Contratos indexados: cronograma recalculado com as taxas publicadas e o saldo lançado no fechamento anterior.
  const fullContracts = (await pool.query(
    `SELECT * FROM loan_contracts WHERE entity_id = $1 AND group_id = $2 AND status = 'aprovado'`,
    [entityId, groupId]
  )).rows;
  // O recálculo (motor por contrato) só roda quando pedido: ao calcular o fechamento, não a cada abertura da tela.
  const live = payload.withLive ? await prepareLiveInputs(entityId, groupId, fullContracts, competencia) : { schedules: {}, failed: [], ledgerPrev: {} };
  return { rule, created: derived.created, settlements, contratosSemTitulos, liveSchedules: live.schedules, liveFailed: live.failed, ledgerPrev: live.ledgerPrev };
}

async function ensureClosing(entity, competencia) {
  const existing = await pool.query(
    `SELECT * FROM accounting_closings WHERE entity_id = $1 AND competencia = $2::date AND group_id = $3`,
    [entity.id, competencia.start, entity.group_id]
  );
  if (existing.rows[0]) return existing.rows[0];

  const previousResult = await pool.query(
    `SELECT id, status FROM accounting_closings
     WHERE entity_id = $1 AND competencia < $2::date AND group_id = $3
     ORDER BY competencia DESC LIMIT 1`,
    [entity.id, competencia.start, entity.group_id]
  );
  const previous = previousResult.rows[0] || null;

  const created = await store.create("AccountingClosing", {
    entity_id: entity.id,
    competencia: competencia.start,
    data_base: competencia.end,
    previous_closing_id: previous?.id || null,
    status: "rascunho",
  }, "sistema");
  return created;
}

async function closeEntityForCompetencia(entity, competencia) {
  const groupId = entity.group_id;
  const closing = await ensureClosing(entity, competencia);
  if (closing.status === "aprovado") {
    return { entityId: entity.id, entityName: entity.entity_name, skipped: true, reason: "Competência já aprovada" };
  }

  const derived = await deriveSettlementsFromErp(entity.id, groupId, competencia, closing.id);

  const contractsResult = await pool.query(
    `SELECT * FROM loan_contracts WHERE entity_id = $1 AND group_id = $2 AND status = 'aprovado'`,
    [entity.id, groupId]
  );
  const contracts = contractsResult.rows;

  // Baixas de todos os fechamentos do contrato: a parcela paga num mês continua paga nos meses seguintes
  // (o pagamento em si só gera lançamento no mês da data da baixa).
  const settlementsResult = await loadEntitySettlements(contracts.map((c) => c.id), groupId);

  const settlementsByContract = new Map();
  for (const s of settlementsResult.rows) {
    if (!settlementsByContract.has(s.contract_id)) settlementsByContract.set(s.contract_id, []);
    settlementsByContract.get(s.contract_id).push(s);
  }

  // Baixa efetiva: pagamento só existe se a parcela foi baixada (Contas a Pagar, manual ou retorno do ERP).
  const rule = await resolveSettlementRule({ groupId, entityId: entity.id });
  const requireSettlementFrom = rule.from;

  // Abertura da implantação de saldos: configuração aplicada cuja virada cai nesta competência.
  const deployResult = await pool.query(
    `SELECT * FROM balance_deployment_configs
      WHERE entity_id = $1 AND group_id = $2 AND status = 'aplicada' AND data_virada >= $3::date AND data_virada <= $4::date`,
    [entity.id, groupId, competencia.start, competencia.end]
  );
  // Moeda estrangeira: o passivo é remensurado pela PTAX de fechamento a partir da mesma data da regra de baixa efetiva.
  const fxRates = await loadFxRates(contracts, groupId);
  // Contratos indexados: cronograma recalculado com as taxas publicadas; a diferença da provisão entra no mês corrente.
  const live = await prepareLiveInputs(entity.id, groupId, contracts, competencia);
  const reconciliation = calculateClosingReconciliation(
    live.liveContracts, settlementsByContract, competencia.year, competencia.month, competencia.end,
    {
      requireSettlementFrom, deploymentOpening: deploymentOpeningFromConfigs(deployResult.rows), fxRates, fxRemeasureFrom: rule.from,
      trueUpContracts: live.trueUpContracts, ledgerPrev: live.ledgerPrev,
      today: todayInSaoPaulo(), holidays: await loadHolidayDates(groupId),
    }
  );

  // Avisos (não bloqueiam): parcelas vencidas sem baixa e contratos sem títulos no Contas a Pagar.
  const contratosSemTitulos = await findContractsWithoutTitles({ entityId: entity.id, groupId, from: rule.from, endIso: competencia.end });
  const avisos = {
    regraBaixa: rule,
    parcelasSemBaixa: (reconciliation.pendingUnsettled || []).length,
    cambio: (reconciliation.fxIssues || []).filter((f) => f.type.startsWith("ptax")),
    cronogramaVivo: { recalculados: Object.keys(live.schedules).length, falhas: live.failed, principalRecalculado: (reconciliation.fxIssues || []).filter((f) => f.type === "principal_recalculado") },
    contratosSemTitulos,
  };
  await pool.query(
    `UPDATE accounting_closings SET extra_json = COALESCE(extra_json, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [closing.id, JSON.stringify({ avisos, balances: Object.fromEntries(reconciliation.perContract.map((c) => [c.contractId, { principal: c.closing.principal, interest: c.closing.interest }])) })]
  );

  const mappingsResult = await pool.query(
    `SELECT * FROM accounting_event_mappings WHERE entity_id = $1 AND group_id = $2 AND status = 'ativo'`,
    [entity.id, groupId]
  );

  // Conta bancária específica na liberação/pagamento (se cadastrada com
  // conta contábil vinculada) — quando ausente, buildJournalEntries cai no
  // fallback da matriz sozinho.
  const bankAccountsResult = await pool.query(
    `SELECT * FROM bank_accounts WHERE entity_id = $1 AND group_id = $2`,
    [entity.id, groupId]
  );
  const bankAccountsById = new Map(bankAccountsResult.rows.map((a) => [a.id, a]));

  const openingEntries = deployResult.rows.flatMap((cfg) => {
    let snap = cfg.position_snapshot;
    if (typeof snap === "string") { try { snap = JSON.parse(snap); } catch { snap = null; } }
    const dv = cfg.data_virada instanceof Date
      ? `${cfg.data_virada.getFullYear()}-${String(cfg.data_virada.getMonth() + 1).padStart(2, "0")}-${String(cfg.data_virada.getDate()).padStart(2, "0")}`
      : String(cfg.data_virada).slice(0, 10);
    return buildOpeningEntries({ ...cfg, data_virada: dv }, snap);
  });

  const journalResult = buildJournalEntries(reconciliation, mappingsResult.rows, competencia.end, bankAccountsById, openingEntries);

  const previousResult = closing.previous_closing_id
    ? await pool.query(`SELECT status FROM accounting_closings WHERE id = $1`, [closing.previous_closing_id])
    : { rows: [] };
  const previousClosingApproved = previousResult.rows[0] ? previousResult.rows[0].status === "aprovado" : true;

  const gate = canApproveClosing({
    journalResult,
    reconciliation,
    previousClosingApproved,
    hasUnresolvedSettlementBlockers: false,
  });

  const calculatedStatus = gate.canApprove ? "calculado" : "divergencia";
  await store.update("AccountingClosing", closing.id, {
    status: calculatedStatus,
    opening_snapshot: JSON.stringify(reconciliation.opening),
    events_snapshot: JSON.stringify(reconciliation.aggregatedEvents),
    journal_snapshot: JSON.stringify(journalResult.entries),
    engine_version: "auto-1.0",
    total_debito: journalResult.totalDebito,
    total_credito: journalResult.totalCredito,
    calculated_by: "sistema",
    calculated_at: new Date().toISOString(),
  });

  let posted = false;
  if (entity.posting_approval === "automatic" && gate.canApprove) {
    // Idempotência: uma chave de evento já lançada neste fechamento não é lançada de novo.
    const already = await pool.query(
      `SELECT extra_json->>'event_key' AS k, side FROM accounting_journal_entries WHERE closing_id = $1 AND group_id = $2`,
      [closing.id, groupId]
    );
    const postedKeys = new Set(already.rows.filter((r) => r.k).map((r) => `${r.k}|${r.side}`));
    const entriesToPost = journalResult.entries.filter((e) => !e.event_key || !postedKeys.has(`${e.event_key}|${e.side}`));
    if (entriesToPost.length) {
      await store.bulkCreate(
        "AccountingJournalEntry",
        entriesToPost.map((e) => ({
          closing_id: closing.id,
          contract_id: e.contract_id,
          event_type: e.event_type,
          entry_date: e.entry_date,
          account_id: e.account_id,
          side: e.side,
          amount: e.amount,
          historico: e.historico,
          // campo fora do catálogo: a API grava em extra_json.event_key (chave de idempotência)
          event_key: e.event_key || undefined,
        })),
        "sistema"
      );
    }
    await store.update("AccountingClosing", closing.id, {
      status: "aprovado",
      approved_by: "sistema",
      approved_at: new Date().toISOString(),
    });
    posted = true;
  }

  return {
    entityId: entity.id,
    entityName: entity.entity_name,
    skipped: false,
    settlementsDerivadas: derived.created,
    status: posted ? "aprovado" : calculatedStatus,
    posted,
    balanced: journalResult.balanced,
    missingMappings: journalResult.missingMappings.length,
    reasons: gate.reasons,
    avisos,
  };
}

export async function runAutomaticClosingForGroup() {
  const groupId = groupIdOrThrow();
  const competencia = currentCompetencia();
  const mercado = await syncMarketData();
  const entitiesResult = await pool.query(
    `SELECT * FROM company_entities
     WHERE group_id = $1 AND accounting_mode = 'api' AND status = 'ativa'`,
    [groupId]
  );

  const results = [];
  for (const entity of entitiesResult.rows) {
    try {
      results.push(await closeEntityForCompetencia(entity, competencia));
    } catch (error) {
      logger.error({ err: error, entityId: entity.id }, "falha no fechamento contábil automático");
      results.push({ entityId: entity.id, entityName: entity.entity_name, ok: false, message: error.message });
    }
  }

  const approved = results.filter((r) => r.posted).length;
  const calculated = results.filter((r) => !r.posted && !r.skipped && r.status !== "divergencia").length;
  const divergent = results.filter((r) => r.status === "divergencia").length;
  const failed = results.filter((r) => r.ok === false).length;

  return {
    ok: failed === 0,
    message: entitiesResult.rows.length === 0
      ? "Nenhuma empresa em modo API para fechamento automático"
      : `${approved} aprovado(s) · ${calculated} calculado(s) aguardando aprovação · ${divergent} com divergência · ${failed} com erro`,
    detalhes: { competencia: competencia.start, entidades: entitiesResult.rows.length, resultados: results, mercado },
  };
}
