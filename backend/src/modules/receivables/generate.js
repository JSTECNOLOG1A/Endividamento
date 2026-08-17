import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { se2FilialFromSm0 } from "../integrations/protheusScope.js";
import {
  parseContractSchedule,
  parcelaCode,
  prefixAndType,
  supplierFromBank,
  titleNumberFromContract,
} from "../payables/generate.js";

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

export function buildReceivableTitles(contract, bank = null, entity = null) {
  if (!contract?.id || !contract.entity_id) return [];
  const row = firstScheduleRowWithSdIni(contract);
  if (!row) return [];

  const { prefixo, tipo } = prefixAndType(contract);
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
    tipo,
    prefixo,
    emissao: dateOnly(contract.operation_date),
    vencimento: dateOnly(row.dataVencimento) || dateOnly(contract.operation_date),
    valor,
    saldo: valor,
    natureza: "",
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

  const existing = await pool.query(
    `SELECT id, erp_status, integrado_erp
       FROM receivable_titles
      WHERE contract_id = $1
      ORDER BY parcela ASC`,
    [contract.id]
  );
  const locked = existing.rows.some((row) => (
    row.integrado_erp === true || ["integrado", "baixado"].includes(String(row.erp_status || ""))
  ));
  if (existing.rows.length === 1) {
    return { created: 0, skipped: true };
  }
  if (existing.rows.length > 1 && locked) {
    logger.warn({ contractId: contract.id, count: existing.rows.length }, "contas a receber com várias parcelas já integradas; não regrava");
    return { created: 0, skipped: true };
  }

  let bank = null;
  if (contract.bank_id) {
    const bankResult = await pool.query(`SELECT * FROM banks WHERE id = $1`, [contract.bank_id]);
    bank = bankResult.rows[0] || null;
  }

  const entityResult = await pool.query(
    `SELECT codigo_empresa, codigo_filial FROM company_entities WHERE id = $1`,
    [contract.entity_id]
  );
  const titles = buildReceivableTitles(contract, bank, entityResult.rows[0] || null);
  if (!titles.length) {
    logger.warn({ contractId: contract.id }, "contrato aprovado sem parcelas para contas a receber");
    return { created: 0, skipped: false };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (existing.rows.length > 1) {
      await client.query(`DELETE FROM receivable_titles WHERE contract_id = $1`, [contract.id]);
    }
    for (const title of titles) {
      await client.query(
        `INSERT INTO receivable_titles (
           id, entity_id, contract_id, parcela, titulo_numero, tipo, prefixo,
           emissao, vencimento, valor, saldo, natureza, historico, status, origem,
           cliente, cliente_loja, cliente_nome, filial, filial_origem, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
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
        ]
      );
    }
    await client.query(
      `UPDATE loan_contracts SET exported_to_receivables = true, updated_date = now() WHERE id = $1`,
      [contract.id]
    );
    await client.query("COMMIT");
    return { created: titles.length, skipped: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function syncReceivableTitlesFromApprovedContracts() {
  const result = await pool.query(
    `SELECT * FROM loan_contracts
     WHERE status = 'aprovado'
       AND (
         exported_to_receivables IS NOT TRUE
         OR NOT EXISTS (SELECT 1 FROM receivable_titles r WHERE r.contract_id = loan_contracts.id)
         OR (
           SELECT COUNT(*) FROM receivable_titles r WHERE r.contract_id = loan_contracts.id
         ) > 1
       )`
  );
  let created = 0;
  let contracts = 0;
  for (const row of result.rows) {
    const generated = await generateReceivableTitlesForContract(row, row.created_by || "system");
    if (generated.created > 0) {
      created += generated.created;
      contracts += 1;
    }
  }
  return { created, contracts, scanned: result.rows.length };
}
