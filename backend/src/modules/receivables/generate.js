import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { se2FilialFromSm0 } from "../integrations/protheusScope.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { assertContractInTenant, requireTenantContext } from "../tenants/scope.js";
import { assertPlatformAdminWithTenant } from "../tenants/policy.js";
import { writeAudit } from "../../middleware/audit.js";
import {
  parseContractSchedule,
  parcelaCode,
  prefixAndType,
  supplierFromBank,
  titleNumberFromContract,
  loadFinanceTitleParams,
  normalizeFinanceTitleParams,
} from "../payables/generate.js";

function titleIsIntegrated(title) {
  return title.integrado_erp === true || ["integrado", "baixado"].includes(String(title.erp_status || ""));
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
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

export function sdIniBrlFromRow(row) {
  const amount = money(row?.sdInicial);
  if (amount > 0) return amount;
  return money(row?.blocoContabil?.valorAberturaBRL || row?.sdInicial_BRL_fxAtual);
}

export function firstScheduleRowWithSdIni(contract) {
  for (const row of parseContractSchedule(contract)) {
    const parcela = parcelaCode(row?.parcela);
    if (!parcela || parcela === "000") continue;
    if (sdIniBrlFromRow(row) <= 0) continue;
    return row;
  }
  return null;
}

export function buildReceivableTitles(contract, bank = null, entity = null, financeParams = null) {
  if (!contract?.id || !contract.entity_id) return [];
  const row = firstScheduleRowWithSdIni(contract);
  if (!row) return [];

  const finance = normalizeFinanceTitleParams(financeParams);
  const { prefixo, tipo } = prefixAndType(contract);
  const mainTipo = finance.mainTitleType || tipo;
  const tituloNumero = titleNumberFromContract(contract.contract_number);
  const contractNumber = String(contract.contract_number || tituloNumero).trim();
  const party = supplierFromBank(bank);
  const se1 = se2FilialFromSm0(null, entity);
  const valor = sdIniBrlFromRow(row);

  return [{
    entity_id: contract.entity_id,
    contract_id: contract.id,
    parcela: "001",
    titulo_numero: tituloNumero,
    tipo: mainTipo,
    prefixo,
    emissao: dateOnly(contract.operation_date),
    vencimento: dateOnly(row.dataVencimento) || dateOnly(contract.operation_date),
    valor,
    saldo: valor,
    natureza: finance.mainTitleNature,
    historico: `SD Ini BRL do contrato ${contractNumber}`,
    status: "aberto",
    origem: "contrato",
    cliente: party.fornecedor,
    cliente_loja: party.fornecedor_loja,
    cliente_nome: party.fornecedor_nome,
    filial: se1?.filial || "",
    filial_origem: se1?.filialOrigem || "",
  }];
}

export async function generateReceivableTitlesForContract(contract, createdBy = "system") {
  if (!contract?.id || contract.status !== "aprovado") {
    return { created: 0, skipped: true };
  }

  await assertContractInTenant(contract.id);
  const groupId = groupIdOrThrow();
  const existing = await pool.query(
    `SELECT id, status, erp_status, integrado_erp
       FROM receivable_titles
      WHERE contract_id = $1 AND group_id = $2
      ORDER BY parcela ASC`,
    [contract.id, groupId]
  );
  const active = existing.rows.filter((row) => row.status === "aberto");
  const locked = active.some((row) => (
    row.integrado_erp === true || ["integrado", "baixado"].includes(String(row.erp_status || ""))
  ));
  if (active.length === 1) {
    return { created: 0, skipped: true };
  }
  if (active.length > 1 && locked) {
    logger.warn({ contractId: contract.id, count: active.length }, "contas a receber com várias parcelas já integradas; não regrava");
    return { created: 0, skipped: true };
  }

  let bank = null;
  if (contract.bank_id) {
    const bankResult = await pool.query(`SELECT * FROM banks WHERE id = $1`, [contract.bank_id]);
    bank = bankResult.rows[0] || null;
  }

  const entityResult = await pool.query(
    `SELECT codigo_empresa, codigo_filial FROM company_entities WHERE id = $1 AND group_id = $2`,
    [contract.entity_id, groupId]
  );
  const financeParams = await loadFinanceTitleParams(groupId);
  const titles = buildReceivableTitles(contract, bank, entityResult.rows[0] || null, financeParams);
  if (!titles.length) {
    logger.warn({ contractId: contract.id }, "contrato aprovado sem parcelas para contas a receber");
    return { created: 0, skipped: false };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (active.length > 1) {
      await client.query(`DELETE FROM receivable_titles WHERE contract_id = $1 AND status = 'aberto' AND group_id = $2`, [contract.id, groupId]);
    }
    const createdRows = [];
    for (const title of titles) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO receivable_titles (
           id, entity_id, contract_id, parcela, titulo_numero, tipo, prefixo,
           emissao, vencimento, valor, saldo, natureza, historico, status, origem,
           cliente, cliente_loja, cliente_nome, filial, filial_origem, created_by, group_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          id,
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
          title.natureza,
          title.historico,
          title.status,
          title.origem,
          title.cliente,
          title.cliente_loja,
          title.cliente_nome,
          title.filial,
          title.filial_origem,
          createdBy,
          groupId,
        ]
      );
      createdRows.push({
        id,
        prefixo: title.prefixo,
        titulo_numero: title.titulo_numero,
        parcela: title.parcela,
        tipo: title.tipo,
        contract_id: title.contract_id,
      });
    }
    await client.query(
      `UPDATE loan_contracts SET exported_to_receivables = true, updated_date = now() WHERE id = $1 AND group_id = $2`,
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

// Espelha reversePayableTitles/cleanupOrphanedPayableTitles do lado de
// contas a pagar (ver backend/src/modules/payables/generate.js) — mesmo bug,
// mesmo fix: título a receber gerado num contrato aprovado também fica
// órfão se o contrato for reaberto pra edição (só é regerado quando volta a
// 'aprovado' — ver syncReceivableTitlesFromApprovedContracts). Título já
// integrado ao ERP não é tocado aqui.
export async function reverseNonIntegratedReceivableTitles(contractId) {
  await assertContractInTenant(contractId);
  const groupId = requireTenantContext();
  const result = await pool.query(
    `SELECT * FROM receivable_titles WHERE contract_id = $1 AND group_id = $2`,
    [contractId, groupId]
  );
  const integrated = result.rows.filter(titleIsIntegrated);
  const toReverse = result.rows.filter((t) => !titleIsIntegrated(t));
  if (toReverse.length) {
    await pool.query(
      `DELETE FROM receivable_titles WHERE id = ANY($1::text[]) AND group_id = $2`,
      [toReverse.map((t) => t.id), groupId]
    );
  }
  return { reversed: toReverse, integrated };
}

// Limpeza retroativa: cobre títulos a receber que já ficaram órfãos ANTES
// desse fix existir (contrato saiu de 'aprovado' sem que reopenApprovedContractForEditing
// tivesse a parte de contas a receber) — mesmo padrão de cleanupOrphanedPayableTitles.
export async function cleanupOrphanedReceivableTitles(req = null) {
  await assertPlatformAdminWithTenant();
  const groupId = requireTenantContext();
  const result = await pool.query(
    `SELECT t.* FROM receivable_titles t
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
    await pool.query(
      `DELETE FROM receivable_titles WHERE id = ANY($1::text[]) AND group_id = $2`,
      [toDelete.map((t) => t.id), groupId]
    );

    if (req) {
      for (const [contractId, rows] of byContract) {
        await writeAudit({
          req,
          action: "REVERSE",
          resourceType: "ReceivableTitle",
          resourceId: contractId,
          rotina: "Contas a receber",
          registro: `${rows.length} título(s) órfão(s) estornado(s) — limpeza retroativa (contrato fora de 'aprovado')`,
          before: { titulos: rows },
          after: { contractId },
          payload: { contractId, titulosEstornados: rows.length },
        });
      }
    }
  }

  return {
    ok: true,
    titulosEstornados: toDelete.length,
    contratosAfetados: byContract.size,
    titulosIntegradosPendentes: integrated.length,
    detalhesIntegrados: integrated.map((t) => ({
      id: t.id, contractId: t.contract_id, parcela: t.parcela, prefixo: t.prefixo, valor: t.valor,
    })),
  };
}

export async function syncReceivableTitlesFromApprovedContracts() {
  const result = await pool.query(
    `SELECT * FROM loan_contracts
     WHERE status = 'aprovado' AND group_id = $1
       AND (
         exported_to_receivables IS NOT TRUE
         OR NOT EXISTS (SELECT 1 FROM receivable_titles r WHERE r.contract_id = loan_contracts.id)
         OR (
           SELECT COUNT(*) FROM receivable_titles r WHERE r.contract_id = loan_contracts.id
         ) > 1
       )`,
    [groupIdOrThrow()]
  );
  let created = 0;
  let contracts = 0;
  const titulos = [];
  for (const row of result.rows) {
    const generated = await generateReceivableTitlesForContract(row, row.created_by || "system");
    if (generated.created > 0) {
      created += generated.created;
      contracts += 1;
      if (Array.isArray(generated.titulos)) titulos.push(...generated.titulos);
    }
  }
  return { created, contracts, scanned: result.rows.length, titulos };
}
