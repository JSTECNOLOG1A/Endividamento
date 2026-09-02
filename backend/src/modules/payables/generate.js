import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { se2FilialFromSm0 } from "../integrations/protheusScope.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { assertContractInTenant, requireTenantContext } from "../tenants/scope.js";
import { assertPlatformAdminWithTenant, assertTenantAdmin, resolveContractReopen } from "../tenants/policy.js";
import { writeAudit } from "../../middleware/audit.js";
import * as store from "../entities/store.js";
import { calculateGuaranteedAccountStatement } from "../functions/guaranteedAccount.js";
import { cleanupOrphanedReceivableTitles as cleanupOrphanedReceivableTitlesImpl } from "../receivables/generate.js";
import { reversePayableTitles } from "./erpIntegrate.js";
import { reverseReceivableTitles } from "../receivables/erpIntegrate.js";
import { resolveParameter } from "../parameters/service.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function titleNumberFromContract(contractNumber) {
  const digits = String(contractNumber || "").replace(/\D/g, "");
  if (!digits) return "000000001";
  return digits.slice(-9).padStart(9, "0");
}

export function parcelaCode(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.slice(-3).padStart(3, "0");
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

export function amortBrlAmount(row) {
  return money(row?.amortizacao_BRL_fxAtual || row?.amortizacao);
}

export function totJurosAmount(row) {
  const fx = money(row?.jurosTotal_BRL_fxAtual);
  if (fx > 0) return fx;
  return money((row?.jurosFixosMes || 0) + (row?.jurosVariaveisMes || 0));
}

// Só populado no cronograma sintético de conta garantida (ver
// scheduleContractForGeneration) — outros sistemas cobram IOF como valor
// fixo no momento zero da operação (campo iof_value do contrato), não por
// parcela, então esse campo fica ausente e iofAmount() retorna 0 para eles.
export function iofAmount(row) {
  return money(row?.iofValor);
}

function todayIsoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function interestTipo(vencimento, financeParams = null) {
  const provisional = String(financeParams?.provisionalTitleType || "PR").trim() || "PR";
  const interest = String(financeParams?.interestTitleType || "JUR").trim() || "JUR";
  const due = dateOnly(vencimento);
  if (!due) return provisional;
  return due.slice(0, 7) <= todayIsoDate().slice(0, 7) ? interest : provisional;
}

export function normalizeFinanceTitleParams(raw = {}) {
  return {
    mainTitleType: String(raw.mainTitleType ?? raw.main_title_type ?? "").trim(),
    interestTitleType: String(raw.interestTitleType ?? raw.interest_title_type ?? "JUR").trim() || "JUR",
    provisionalTitleType: String(raw.provisionalTitleType ?? raw.provisional_title_type ?? "PR").trim() || "PR",
    mainTitleNature: String(raw.mainTitleNature ?? raw.main_title_nature ?? "").trim(),
    interestTitleNature: String(raw.interestTitleNature ?? raw.interest_title_nature ?? "").trim(),
  };
}

export async function loadFinanceTitleParams(groupId) {
  const [
    mainTitleType,
    interestTitleType,
    provisionalTitleType,
    mainTitleNature,
    interestTitleNature,
  ] = await Promise.all([
    resolveParameter("finance.main_title_type", { groupId }),
    resolveParameter("finance.interest_title_type", { groupId }),
    resolveParameter("finance.provisional_title_type", { groupId }),
    resolveParameter("finance.main_title_nature", { groupId }),
    resolveParameter("finance.interest_title_nature", { groupId }),
  ]);
  return normalizeFinanceTitleParams({
    mainTitleType,
    interestTitleType,
    provisionalTitleType,
    mainTitleNature,
    interestTitleNature,
  });
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 10);
}

export function parseContractSchedule(contract) {
  const raw = contract?.schedule_data;
  if (!raw) return [];
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.schedule)) return data.schedule;
    return [];
  } catch {
    return [];
  }
}

function prefixAndType(contract) {
  const category = String(contract?.operation_category || "").toLowerCase();
  if (category === "financiamentos") return { prefixo: "FIN", tipo: "DEF" };
  return { prefixo: "EMP", tipo: "DEF" };
}

export { prefixAndType };

export function supplierFromBank(bank) {
  const digits = String(bank?.bank_code || "").replace(/\D/g, "");
  return {
    fornecedor: digits ? digits.padStart(6, "0").slice(-6) : "",
    fornecedor_loja: "01",
    fornecedor_nome: String(bank?.bank_name || "").trim(),
  };
}

export function buildPayableTitles(contract, bank = null, entity = null, financeParams = null) {
  if (!contract?.id || !contract.entity_id) return [];
  const finance = normalizeFinanceTitleParams(financeParams);
  const amort = prefixAndType(contract);
  const mainTipo = finance.mainTitleType || amort.tipo;
  const tituloNumero = titleNumberFromContract(contract.contract_number);
  const emissao = dateOnly(contract.operation_date);
  const contractNumber = String(contract.contract_number || tituloNumero).trim();
  const supplier = supplierFromBank(bank);
  const se2 = se2FilialFromSm0(null, entity);

  const titles = [];
  const seen = new Set();
  for (const row of parseContractSchedule(contract)) {
    const parcela = parcelaCode(row?.parcela);
    if (!parcela || parcela === "000") continue;
    if (seen.has(parcela)) continue;
    seen.add(parcela);

    const vencimento = dateOnly(row.dataVencimento);
    const base = {
      entity_id: contract.entity_id,
      contract_id: contract.id,
      parcela,
      titulo_numero: tituloNumero,
      emissao,
      vencimento,
      natureza: "",
      status: "aberto",
      origem: "contrato",
      fornecedor: supplier.fornecedor,
      fornecedor_loja: supplier.fornecedor_loja,
      fornecedor_nome: supplier.fornecedor_nome,
      filial: se2?.filial || "",
      filial_origem: se2?.filialOrigem || "",
    };

    const amortValor = amortBrlAmount(row);
    if (amortValor > 0) {
      titles.push({
        ...base,
        tipo: mainTipo,
        prefixo: amort.prefixo,
        valor: amortValor,
        saldo: amortValor,
        natureza: finance.mainTitleNature,
        historico: `Amortização parcela ${parcela} do contrato ${contractNumber}`,
      });
    }

    const jurosValor = totJurosAmount(row);
    if (jurosValor > 0) {
      titles.push({
        ...base,
        tipo: interestTipo(vencimento, finance),
        prefixo: "JUR",
        valor: jurosValor,
        saldo: jurosValor,
        natureza: finance.interestTitleNature,
        historico: `Juros parcela ${parcela} do contrato ${contractNumber}`,
      });
    }

    const iofValor = iofAmount(row);
    if (iofValor > 0) {
      titles.push({
        ...base,
        tipo: interestTipo(vencimento, finance),
        prefixo: "IOF",
        valor: iofValor,
        saldo: iofValor,
        natureza: finance.interestTitleNature,
        historico: `IOF parcela ${parcela} do contrato ${contractNumber}`,
      });
    }
  }
  return titles;
}

function parseStatusHistory(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function titleIsIntegrated(title) {
  return title.integrado_erp === true || ["integrado", "baixado"].includes(String(title.erp_status || ""));
}

// Reabre um contrato aprovado pra edição (ajustes no cálculo). Como o
// cronograma vai mudar, os títulos a pagar já gerados pra ele deixam de
// corresponder ao que vai ser reaprovado — por isso são estornados
// (removidos) aqui, pra serem regerados do zero quando o contrato for
// reaprovado (generatePayableTitlesForContract roda de novo nesse
// momento, ver syncPayableTitlesFromApprovedContracts).
//
// Título já integrado ao Protheus NÃO é tocado aqui — apagar/mudar
// silenciosamente um título que o ERP já conhece deixaria as duas pontas
// dessincronizadas. Nesse caso a reabertura é bloqueada: primeiro alguém
// precisa estornar esse título manualmente em Contas a Pagar (mesmo fluxo
// que já existe pra estornar título integrado, ver reversePayableTitles
// em erpIntegrate.js), só depois o contrato pode ser reaberto.
// Limpeza retroativa: cobre títulos que ficaram órfãos ANTES de
// reopenApprovedContractForEditing existir (ou por qualquer outra falha —
// ex.: front-end desatualizado batendo direto no PATCH de LoanContract em
// vez de passar pela função de reabertura). Encontra título cujo contrato
// NÃO está mais "aprovado" e estorna (remove) os que ainda não foram ao
// ERP — mesma regra e mesma trilha de auditoria de reopenApprovedContractForEditing,
// só que varrendo a base inteira em vez de um contrato só.
export async function cleanupOrphanedPayableTitles(payload = {}, req = null) {
  await assertPlatformAdminWithTenant();
  const groupId = requireTenantContext();
  const result = await pool.query(
    `SELECT t.* FROM payable_titles t
       JOIN loan_contracts c ON c.id = t.contract_id
      WHERE c.status != 'aprovado'
        AND t.group_id = $1
        AND c.group_id = $1`,
    [groupId]
  );

  const integrated = result.rows.filter(titleIsIntegrated);
  const toDelete = result.rows.filter((t) => !titleIsIntegrated(t));

  const byContract = new Map();
  for (const t of toDelete) {
    if (!byContract.has(t.contract_id)) byContract.set(t.contract_id, []);
    byContract.get(t.contract_id).push(t);
  }

  if (toDelete.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM payable_titles WHERE id = ANY($1::text[]) AND group_id = $2`,
        [toDelete.map((t) => t.id), groupId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (req) {
      for (const [contractId, rows] of byContract) {
        await writeAudit({
          req,
          action: "REVERSE",
          resourceType: "PayableTitle",
          resourceId: contractId,
          rotina: "Contas a pagar",
          registro: `${rows.length} título(s) órfão(s) estornado(s) — limpeza retroativa (contrato fora de 'aprovado')`,
          before: { titulos: rows },
          after: { contractId },
          payload: { contractId, titulosEstornados: rows.length },
        });
      }
    }
  }

  // Mesma varredura do lado de contas a receber — ver
  // reverseNonIntegratedReceivableTitles/cleanupOrphanedReceivableTitles em
  // backend/src/modules/receivables/generate.js.
  const receivableCleanup = await cleanupOrphanedReceivableTitlesImpl(req);

  return {
    ok: true,
    titulosEstornados: toDelete.length,
    contratosAfetados: byContract.size,
    titulosIntegradosPendentes: integrated.length,
    detalhesIntegrados: integrated.map((t) => ({
      id: t.id, contractId: t.contract_id, parcela: t.parcela, prefixo: t.prefixo, valor: t.valor,
    })),
    titulosReceberEstornados: receivableCleanup.titulosEstornados,
    contratosReceberAfetados: receivableCleanup.contratosAfetados,
    titulosReceberIntegradosPendentes: receivableCleanup.titulosIntegradosPendentes,
    detalhesReceberIntegrados: receivableCleanup.detalhesIntegrados,
  };
}

export async function reopenApprovedContractForEditing(payload = {}, req = null) {
  const contractId = String(payload?.contractId || "").trim();
  if (!contractId) throw httpError(400, "contractId é obrigatório");

  const contract = await assertContractInTenant(contractId);
  if (contract.status !== "aprovado") {
    throw httpError(400, "Só é possível reabrir contratos aprovados");
  }
  const decision = await resolveContractReopen(contract);
  if (decision.action === "request") {
    await store.update("LoanContract", contractId, {
      reopen_requested_by: decision.requestedBy,
      reopen_requested_at: new Date().toISOString(),
    });
    return {
      ok: true,
      requested: true,
      contractId,
      status: "aprovado",
      titulosEstornados: 0,
      titulosReceberEstornados: 0,
      titulosEstornadosNoErp: 0,
    };
  }

  const groupId = requireTenantContext();
  let titlesResult = await pool.query(
    `SELECT * FROM payable_titles WHERE contract_id = $1 AND group_id = $2`,
    [contractId, groupId]
  );
  let integrated = titlesResult.rows.filter(titleIsIntegrated);
  let receivableResult = await pool.query(
    `SELECT * FROM receivable_titles WHERE contract_id = $1 AND group_id = $2`,
    [contractId, groupId]
  );
  let receivableIntegrated = receivableResult.rows.filter(titleIsIntegrated);

  let erpReversalAttempt = null;
  if ((integrated.length || receivableIntegrated.length) && payload.confirmErpReversal) {
    // Usuário confirmou explicitamente que quer estornar esses títulos NO
    // ERP também (não só localmente) — chama as mesmas funções que "Estornar
    // no ERP" usa em Contas a Pagar/Receber (ver reversePayableTitles /
    // reverseReceivableTitles). Reconsulta depois: a chamada pode falhar
    // pra alguns títulos (ex.: já baixado no ERP, movimentação pendente),
    // então o que continuar bloqueado é decidido pelo estado real, não pela
    // resposta em si.
    const payableResult = integrated.length
      ? await reversePayableTitles({ ids: integrated.map((t) => t.id) })
      : null;
    const receivableErpResult = receivableIntegrated.length
      ? await reverseReceivableTitles({ ids: receivableIntegrated.map((t) => t.id) })
      : null;
    erpReversalAttempt = { payable: payableResult, receivable: receivableErpResult };

    titlesResult = await pool.query(
      `SELECT * FROM payable_titles WHERE contract_id = $1 AND group_id = $2`,
      [contractId, groupId]
    );
    integrated = titlesResult.rows.filter(titleIsIntegrated);
    receivableResult = await pool.query(
      `SELECT * FROM receivable_titles WHERE contract_id = $1 AND group_id = $2`,
      [contractId, groupId]
    );
    receivableIntegrated = receivableResult.rows.filter(titleIsIntegrated);
  }

  if (integrated.length || receivableIntegrated.length) {
    const total = integrated.length + receivableIntegrated.length;
    const err = new Error(
      erpReversalAttempt
        ? `O ERP não aceitou o estorno de ${total} título(s) — veja o motivo em cada um e resolva manualmente antes de reabrir o contrato.`
        : `Este contrato tem ${total} título(s) já integrado(s) ao ERP` +
          `${integrated.length && receivableIntegrated.length ? ` (${integrated.length} a pagar, ${receivableIntegrated.length} a receber)` : ""}. ` +
          `Deseja estornar no ERP e reabrir o contrato?`
    );
    err.status = 409;
    err.code = erpReversalAttempt ? "ESTORNO_ERP_FALHOU" : "TITULOS_INTEGRADOS_PENDENTES";
    err.details = {
      titulos: integrated.map((t) => ({ id: t.id, parcela: t.parcela, prefixo: t.prefixo, valor: t.valor, erp_mensagem: t.erp_mensagem })),
      titulosReceber: receivableIntegrated.map((t) => ({ id: t.id, parcela: t.parcela, prefixo: t.prefixo, valor: t.valor, erp_mensagem: t.erp_mensagem })),
      erpReversalAttempt,
    };
    throw err;
  }

  const toReverse = titlesResult.rows.filter((t) => t.status === "aberto");
  const toReverseReceivable = receivableResult.rows.filter((t) => t.status === "aberto");
  const actorEmail = req?.user?.email || "system";

  if (toReverse.length) {
    await pool.query(
      `DELETE FROM payable_titles WHERE id = ANY($1::text[]) AND group_id = $2`,
      [toReverse.map((t) => t.id), groupId]
    );
  }
  if (toReverseReceivable.length) {
    await pool.query(
      `DELETE FROM receivable_titles WHERE id = ANY($1::text[]) AND group_id = $2`,
      [toReverseReceivable.map((t) => t.id), groupId]
    );
  }

  const erpReversedCount = erpReversalAttempt
    ? (erpReversalAttempt.payable?.reversed || 0) + (erpReversalAttempt.receivable?.reversed || 0)
    : 0;

  const history = parseStatusHistory(contract.status_history);
  history.push({
    from: contract.status,
    to: "rascunho",
    by: actorEmail,
    at: new Date().toISOString(),
    comments: payload.comments || (
      `Reaberto para edição — ${toReverse.length} título(s) a pagar e ${toReverseReceivable.length} a receber estornado(s)` +
      (erpReversalAttempt ? ` (${erpReversedCount} estornado(s) também no ERP)` : "")
    ),
  });

  // store.update (não SQL cru) — assim campos não-coluna vindos em
  // extraFields (ex.: recalculation_flag, usado pelo "Reabrir para
  // recálculo" do Fechamento Contábil) vão pro extra_json automaticamente,
  // igual qualquer update feito pela rota genérica de entidades.
  await store.update("LoanContract", contractId, {
    status: "rascunho",
    exported_to_payables: false,
    exported_to_receivables: false,
    status_history: JSON.stringify(history),
    ...(payload.extraFields && typeof payload.extraFields === "object" ? payload.extraFields : {}),
  });

  if (req) {
    await writeAudit({
      req,
      action: "REVERSE",
      resourceType: "PayableTitle",
      resourceId: contractId,
      rotina: "Contas a pagar",
      registro: `${toReverse.length} título(s) a pagar e ${toReverseReceivable.length} a receber estornado(s) — reabertura do contrato ${contract.contract_number}`,
      before: { titulos: toReverse, titulosReceber: toReverseReceivable },
      after: { contractId, novoStatus: "rascunho" },
      payload: { contractId, titulosEstornados: toReverse.length, titulosReceberEstornados: toReverseReceivable.length },
    });
  }

  return {
    ok: true,
    contractId,
    titulosEstornados: toReverse.length,
    titulosReceberEstornados: toReverseReceivable.length,
    titulosEstornadosNoErp: erpReversedCount,
  };
}

// Conta garantida não passa pelo motor de cálculo (não tem cronograma fixo —
// ver backend/src/modules/functions/guaranteedAccount.js), então
// contract.schedule_data nunca é preenchido e buildPayableTitles (que só lê
// schedule_data) nunca gera nada pra ela. Aqui montamos um "cronograma"
// sintético de UMA parcela, projetando o saldo da conta garantida até o
// vencimento (mesma lógica do extrato) e reaproveitando o pipeline normal de
// buildPayableTitles/generatePayableTitlesForContract a partir daí — o título
// representa a obrigação total (principal + juros acumulados) na data de
// vencimento, do jeito que um Bullet também vira um título só na última
// parcela.
async function scheduleContractForGeneration(contract) {
  if (contract.calculation_system !== "CONTA_GARANTIDA") return contract;
  // calculateGuaranteedAccountStatement lê datas via store.js (sempre string
  // "YYYY-MM-DD") e compara asOfDate com elas via operadores de string — como
  // aqui o contrato vem de um pool.query cru (não passa por store.js), a
  // coluna DATE chega como objeto Date do node-postgres; sem normalizar com
  // dateOnly(), a comparação de tipos mistos quebra silenciosamente e o
  // período final de juros (do último lançamento até o vencimento) nunca é
  // somado.
  const asOfDate = dateOnly(contract.final_maturity_date) || todayIsoDate();
  const statement = await calculateGuaranteedAccountStatement({ contractId: contract.id, asOfDate });
  const jurosValor = money(statement.total_juros_acumulado);
  const iofValor = money(statement.total_iof);
  const amortValor = Math.max(0, money(statement.saldo_atual - jurosValor));
  if (amortValor <= 0 && jurosValor <= 0 && iofValor <= 0) return contract;
  const row = {
    parcela: "1",
    dataVencimento: asOfDate,
    amortizacao: amortValor,
    jurosFixosMes: jurosValor,
    jurosVariaveisMes: 0,
    iofValor,
  };
  return { ...contract, schedule_data: JSON.stringify({ schedule: [row] }) };
}

export async function generatePayableTitlesForContract(contract, createdBy = "system") {
  if (!contract?.id || contract.status !== "aprovado") {
    return { created: 0, skipped: true };
  }

  await assertContractInTenant(contract.id);
  const groupId = groupIdOrThrow();
  const existing = await pool.query(
    `SELECT * FROM payable_titles WHERE contract_id = $1 AND group_id = $2`,
    [contract.id, groupId]
  );
  const active = existing.rows.filter((row) => row.status === "aberto");
  const existingKeys = new Set(
    active.map((row) => `${String(row.prefixo || "")}::${String(row.parcela || "")}`)
  );
  const template = existing.rows.find((row) => String(row.fornecedor || "").trim()) || existing.rows[0] || null;

  let bank = null;
  if (contract.bank_id) {
    const bankResult = await pool.query(`SELECT * FROM banks WHERE id = $1`, [contract.bank_id]);
    bank = bankResult.rows[0] || null;
  }

  const entityResult = await pool.query(
    `SELECT codigo_empresa, codigo_filial FROM company_entities WHERE id = $1 AND group_id = $2`,
    [contract.entity_id, groupId]
  );
  const scheduleContract = await scheduleContractForGeneration(contract);
  const financeParams = await loadFinanceTitleParams(groupId);
  const titles = buildPayableTitles(scheduleContract, bank, entityResult.rows[0] || null, financeParams)
    .filter((title) => !existingKeys.has(`${title.prefixo}::${title.parcela}`));
  if (!titles.length) {
    if (!existing.rows.length) {
      logger.warn({ contractId: contract.id }, "contrato aprovado sem parcelas para contas a pagar");
    }
    return { created: 0, skipped: true };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const createdRows = [];
    for (const title of titles) {
      const fornecedor = title.fornecedor || template?.fornecedor || "";
      const fornecedorLoja = title.fornecedor_loja || template?.fornecedor_loja || "01";
      const fornecedorNome = title.fornecedor_nome || template?.fornecedor_nome || "";
      const natureza = title.natureza || "";
      const filial = title.filial || template?.filial || "";
      const filialOrigem = title.filial_origem || template?.filial_origem || "";
      const inserted = await client.query(
        `INSERT INTO payable_titles (
           id, entity_id, contract_id, parcela, titulo_numero, tipo, prefixo,
           emissao, vencimento, valor, saldo, natureza, historico, status, origem,
           fornecedor, fornecedor_loja, fornecedor_nome, filial, filial_origem, created_by, group_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (contract_id, prefixo, parcela) WHERE status = 'aberto' DO NOTHING
         RETURNING id, prefixo, titulo_numero, parcela, tipo, contract_id`,
        [
          randomUUID(),
          title.entity_id,
          title.contract_id,
          title.parcela,
          title.titulo_numero,
          title.tipo,
          title.prefixo,
          title.emissao,
          title.vencimento,
          title.valor,
          title.saldo,
          natureza,
          title.historico,
          title.status,
          title.origem,
          fornecedor,
          fornecedorLoja,
          fornecedorNome,
          filial,
          filialOrigem,
          createdBy,
          groupId,
        ]
      );
      if (inserted.rows[0]) createdRows.push(inserted.rows[0]);
    }
    await client.query(
      `UPDATE loan_contracts SET exported_to_payables = true, updated_date = now() WHERE id = $1 AND group_id = $2`,
      [contract.id, groupId]
    );
    await client.query("COMMIT");
    return { created: createdRows.length, skipped: false, titulos: createdRows };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Recalcula o título da conta garantida depois de qualquer mudança que
// afete o saldo projetado (lançamento novo/editado/excluído, edição da taxa
// ou do vencimento do contrato). Título já integrado ao ERP fica intocado —
// mesma regra de reopenApprovedContractForEditing: se já foi pro Protheus,
// só um estorno manual em Contas a Pagar libera a regeneração.
export async function refreshGuaranteedAccountPayableTitle(payload = {}) {
  const contractId = String(payload?.contractId || "").trim();
  if (!contractId) throw httpError(400, "contractId é obrigatório");

  const contract = await assertContractInTenant(contractId);
  if (contract.calculation_system !== "CONTA_GARANTIDA") {
    throw httpError(400, "Contrato não encontrado ou não é uma conta garantida");
  }
  if (contract.status !== "aprovado") {
    return { ok: true, skipped: true, reason: "Contrato não está aprovado" };
  }

  const groupId = requireTenantContext();
  const client = await pool.connect();
  let nonIntegrated = [];
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM payable_titles WHERE contract_id = $1 AND group_id = $2`,
      [contractId, groupId]
    );
    nonIntegrated = existing.rows.filter((t) => !titleIsIntegrated(t));
    if (nonIntegrated.length) {
      await client.query(
        `DELETE FROM payable_titles WHERE id = ANY($1::text[]) AND group_id = $2`,
        [nonIntegrated.map((t) => t.id), groupId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const generated = await generatePayableTitlesForContract(contract, "system");
  return { ok: true, titulosRemovidos: nonIntegrated.length, ...generated };
}

// Exclui uma conta garantida por completo: título(s) a pagar + lançamentos +
// o próprio contrato. Precisa ser feito nessa ordem porque payable_titles e
// account_movements têm FK ON DELETE RESTRICT pra loan_contracts (ver
// migrations 011 e 036) — apagar o contrato primeiro simplesmente falharia.
// Bloqueia (não apaga nada) se algum título já foi integrado ao ERP, mesma
// regra usada em reopenApprovedContractForEditing.
export async function deleteGuaranteedAccount(payload = {}, req = null) {
  await assertTenantAdmin("Apenas administradores podem excluir uma conta garantida.");
  const contractId = String(payload?.contractId || "").trim();
  if (!contractId) throw httpError(400, "contractId é obrigatório");

  const contract = await assertContractInTenant(contractId);
  if (contract.calculation_system !== "CONTA_GARANTIDA") {
    throw httpError(400, "Esta função só pode ser usada para contas garantidas");
  }

  const groupId = requireTenantContext();
  const titlesResult = await pool.query(
    `SELECT * FROM payable_titles WHERE contract_id = $1 AND group_id = $2`,
    [contractId, groupId]
  );
  const integrated = titlesResult.rows.filter(titleIsIntegrated);
  if (integrated.length) {
    const err = new Error(
      `Este contrato tem ${integrated.length} título(s) já integrado(s) ao ERP. ` +
      `Estorne-o(s) manualmente em Contas a Pagar antes de excluir a conta garantida.`
    );
    err.status = 409;
    err.code = "TITULOS_INTEGRADOS_PENDENTES";
    err.details = { titulos: integrated.map((t) => ({ id: t.id, parcela: t.parcela, prefixo: t.prefixo, valor: t.valor })) };
    throw err;
  }

  const movementsResult = await pool.query(
    `SELECT * FROM account_movements WHERE contract_id = $1 AND group_id = $2`,
    [contractId, groupId]
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (titlesResult.rows.length) {
      await client.query(
        `DELETE FROM payable_titles WHERE contract_id = $1 AND group_id = $2`,
        [contractId, groupId]
      );
    }
    if (movementsResult.rows.length) {
      await client.query(
        `DELETE FROM account_movements WHERE contract_id = $1 AND group_id = $2`,
        [contractId, groupId]
      );
    }
    await client.query(
      `DELETE FROM loan_contracts WHERE id = $1 AND group_id = $2`,
      [contractId, groupId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (req) {
    await writeAudit({
      req,
      action: "DELETE",
      resourceType: "LoanContract",
      resourceId: contractId,
      rotina: "Contas Garantidas",
      registro: `Conta garantida ${contract.contract_number} excluída — ${movementsResult.rows.length} lançamento(s) e ${titlesResult.rows.length} título(s) removidos junto`,
      before: { contract, movimentos: movementsResult.rows, titulos: titlesResult.rows },
      payload: { contractId },
    });
  }

  return { ok: true, contractId, movimentosRemovidos: movementsResult.rows.length, titulosRemovidos: titlesResult.rows.length };
}

export async function backfillPayableSuppliers() {
  await pool.query(
    `UPDATE payable_titles t
     SET
       fornecedor = CASE
         WHEN COALESCE(t.fornecedor, '') <> '' THEN t.fornecedor
         WHEN COALESCE(b.bank_code, '') <> '' THEN lpad(regexp_replace(b.bank_code, '[^0-9]', '', 'g'), 6, '0')
         ELSE t.fornecedor
       END,
       fornecedor_nome = CASE
         WHEN COALESCE(t.fornecedor_nome, '') <> '' THEN t.fornecedor_nome
         ELSE COALESCE(b.bank_name, t.fornecedor_nome, '')
       END,
       fornecedor_loja = CASE
         WHEN COALESCE(t.fornecedor_loja, '') <> '' THEN t.fornecedor_loja
         ELSE '01'
       END,
       updated_date = now()
     FROM loan_contracts c
     LEFT JOIN banks b ON b.id = c.bank_id
     WHERE t.contract_id = c.id
       AND t.group_id = $1
       AND (COALESCE(t.fornecedor, '') = '' OR COALESCE(t.fornecedor_nome, '') = '')`,
    [groupIdOrThrow()]
  );
}

export async function backfillPayableFiliais() {
  await pool.query(
    `UPDATE payable_titles t
     SET
       filial = lpad(regexp_replace(COALESCE(e.codigo_empresa, ''), '[^0-9]', '', 'g'), 2, '0'),
       filial_origem = lpad(regexp_replace(COALESCE(e.codigo_empresa, ''), '[^0-9]', '', 'g'), 2, '0')
         || lpad(regexp_replace(COALESCE(e.codigo_filial, ''), '[^0-9]', '', 'g'), 2, '0'),
       updated_date = now()
     FROM company_entities e
     WHERE t.entity_id = e.id
       AND t.group_id = $1
       AND COALESCE(e.codigo_empresa, '') <> ''
       AND COALESCE(e.codigo_filial, '') <> ''
       AND (
         COALESCE(t.filial, '') = ''
         OR COALESCE(t.filial_origem, '') = ''
         OR length(regexp_replace(COALESCE(t.filial_origem, ''), '[^0-9]', '', 'g')) <= 2
       )`,
    [groupIdOrThrow()]
  );
}

// Reconverte pela PTAX mais recente o valor em BRL dos títulos A PAGAR ainda
// abertos de contratos em moeda estrangeira. Por quê isso existe: o valor de
// cada título é fixado (em BRL) no momento em que o cronograma foi calculado
// e o título gerado — se o câmbio mudar depois disso e antes do vencimento,
// nada atualiza esse valor sozinho (diferente da variação cambial por
// competência do Fechamento Contábil, que já reavalia o saldo devedor a cada
// fechamento mensal — ver src/lib/accountingClosing.js). Isso aqui é o lado
// "quanto eu realmente pago hoje se for liquidar esse título" do problema.
//
// Escopo deliberadamente restrito a títulos 'aberto' e NÃO integrados ao
// Protheus (integrado_erp = true fica intocado — mexer no valor local depois
// de exportado geraria divergência com o que já está no ERP; mesma regra já
// aplicada em titleAlteredInErp/erpIntegrate.js).
export async function refreshPayableTitlesFxValue(payload = {}) {
  const ids = Array.isArray(payload.ids) ? payload.ids.filter(Boolean) : null;

  const ptaxResult = await pool.query(
    `SELECT exchange_rate, rate_date FROM currencies WHERE currency_code = 'USD' ORDER BY rate_date DESC LIMIT 1`
  );
  const latestPtax = ptaxResult.rows[0];
  if (!latestPtax || !(Number(latestPtax.exchange_rate) > 0)) {
    return { updated: 0, scanned: 0, skipped: true, message: "Nenhuma cotação PTAX cadastrada em Moedas" };
  }
  const freshRate = Number(latestPtax.exchange_rate);

  const groupId = groupIdOrThrow();
  let sql = `
    SELECT t.id, t.contract_id, t.parcela, t.prefixo, t.valor, c.schedule_data
    FROM payable_titles t
    JOIN loan_contracts c ON c.id = t.contract_id
    WHERE t.status = 'aberto'
      AND COALESCE(t.integrado_erp, false) = false
      AND c.currency_id IS NOT NULL
      AND t.group_id = $1
      AND c.group_id = $1
  `;
  const params = [groupId];
  if (ids?.length) {
    params.push(ids);
    sql += ` AND t.id = ANY($2::text[])`;
  }
  const { rows } = await pool.query(sql, params);

  let updated = 0;
  const titulos = [];
  for (const title of rows) {
    const schedule = parseContractSchedule({ schedule_data: title.schedule_data });
    const row = schedule.find((r) => parcelaCode(r?.parcela) === title.parcela);
    if (!row) continue;

    const isJuros = title.prefixo === "JUR";
    const usdAmount = Number(isJuros ? row.jurosTotal_USD : row.amortizacao_USD);
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) continue;

    const valorNovo = money(usdAmount * freshRate);
    const valorAnterior = money(title.valor);
    if (Math.abs(valorNovo - valorAnterior) < 0.01) continue;

    await pool.query(
      `UPDATE payable_titles SET valor = $2, saldo = $2, updated_date = now() WHERE id = $1 AND group_id = $3`,
      [title.id, valorNovo, groupId]
    );
    updated += 1;
    titulos.push({
      id: title.id,
      contract_id: title.contract_id,
      parcela: title.parcela,
      prefixo: title.prefixo,
      valor_anterior: valorAnterior,
      valor_novo: valorNovo,
    });
  }

  return {
    updated,
    scanned: rows.length,
    skipped: false,
    ptax_usada: freshRate,
    ptax_data: dateOnly(latestPtax.rate_date),
    titulos,
  };
}

export async function syncPayableTitlesFromApprovedContracts() {
  await backfillPayableSuppliers();
  await backfillPayableFiliais();
  const result = await pool.query(
    `SELECT * FROM loan_contracts WHERE status = 'aprovado' AND group_id = $1`,
    [groupIdOrThrow()]
  );
  let created = 0;
  let contracts = 0;
  const titulos = [];
  for (const row of result.rows) {
    const generated = await generatePayableTitlesForContract(row, row.created_by || "system");
    if (generated.created > 0) {
      created += generated.created;
      contracts += 1;
      if (Array.isArray(generated.titulos)) titulos.push(...generated.titulos);
    }
  }
  return { created, contracts, scanned: result.rows.length, titulos };
}
