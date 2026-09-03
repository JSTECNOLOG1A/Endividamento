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
import {
  calculateClosingReconciliation,
  buildJournalEntries,
  canApproveClosing,
} from "./closingEngine.js";

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function currentCompetencia(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { year, month, start, end };
}

// Agrupa títulos a pagar já baixados no ERP (erp_status = 'baixado') por
// parcela do contrato e traduz o valor efetivamente baixado (valor - saldo)
// em principal/juros, usando a mesma convenção de prefixo do gerador de
// títulos (FIN/EMP = principal, JUR = juros — ver
// backend/src/modules/payables/generate.js). Prefixos fora dessa convenção
// (ex.: IOF, já contabilizado à parte no evento automático de IOF na
// liberação) caem em other_amount, só pra fechar a soma de caixa da baixa —
// não geram lançamento próprio.
async function deriveSettlementsFromErp(entityId, groupId, competencia, closingId) {
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
       AND erp_status = 'baixado'
       AND vencimento >= $3::date AND vencimento <= $4::date`,
    [contractIds, groupId, competencia.start, competencia.end]
  );

  const byKey = new Map();
  for (const title of titlesResult.rows) {
    const key = `${title.contract_id}::${title.parcela}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        contract_id: title.contract_id,
        parcela: title.parcela,
        vencimento: title.vencimento,
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

    const paymentDate = dateOnly(bucket.vencimento);
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
      observacao: "Gerado automaticamente a partir da baixa no ERP",
    }, "sistema");
    created += 1;
  }
  return { created };
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

  const settlementsResult = await pool.query(
    `SELECT * FROM contract_settlements WHERE closing_id = $1 AND group_id = $2`,
    [closing.id, groupId]
  );

  const settlementsByContract = new Map();
  for (const s of settlementsResult.rows) {
    if (!settlementsByContract.has(s.contract_id)) settlementsByContract.set(s.contract_id, []);
    settlementsByContract.get(s.contract_id).push(s);
  }

  const reconciliation = calculateClosingReconciliation(
    contracts, settlementsByContract, competencia.year, competencia.month, competencia.end
  );

  const mappingsResult = await pool.query(
    `SELECT * FROM accounting_event_mappings WHERE entity_id = $1 AND group_id = $2 AND status = 'ativo'`,
    [entity.id, groupId]
  );

  const journalResult = buildJournalEntries(reconciliation, mappingsResult.rows, competencia.end);

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
    if (journalResult.entries.length) {
      await store.bulkCreate(
        "AccountingJournalEntry",
        journalResult.entries.map((e) => ({
          closing_id: closing.id,
          contract_id: e.contract_id,
          event_type: e.event_type,
          entry_date: e.entry_date,
          account_id: e.account_id,
          side: e.side,
          amount: e.amount,
          historico: e.historico,
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
  };
}

export async function runAutomaticClosingForGroup() {
  const groupId = groupIdOrThrow();
  const competencia = currentCompetencia();
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
    detalhes: { competencia: competencia.start, entidades: entitiesResult.rows.length, resultados: results },
  };
}
