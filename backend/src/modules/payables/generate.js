import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { se2FilialFromSm0 } from "../integrations/protheusScope.js";

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

function todayIsoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function interestTipo(vencimento) {
  const due = dateOnly(vencimento);
  if (!due) return "PR";
  return due.slice(0, 7) <= todayIsoDate().slice(0, 7) ? "TX" : "PR";
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
  if (category === "financiamentos") return { prefixo: "FIN", tipo: "NP" };
  return { prefixo: "EMP", tipo: "NP" };
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

export function buildPayableTitles(contract, bank = null, entity = null) {
  if (!contract?.id || !contract.entity_id) return [];
  const amort = prefixAndType(contract);
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
        tipo: amort.tipo,
        prefixo: amort.prefixo,
        valor: amortValor,
        saldo: amortValor,
        historico: `Amortização parcela ${parcela} do contrato ${contractNumber}`,
      });
    }

    const jurosValor = totJurosAmount(row);
    if (jurosValor > 0) {
      titles.push({
        ...base,
        tipo: interestTipo(vencimento),
        prefixo: "JUR",
        valor: jurosValor,
        saldo: jurosValor,
        historico: `Juros parcela ${parcela} do contrato ${contractNumber}`,
      });
    }
  }
  return titles;
}

export async function generatePayableTitlesForContract(contract, createdBy = "system") {
  if (!contract?.id || contract.status !== "aprovado") {
    return { created: 0, skipped: true };
  }

  const existing = await pool.query(
    `SELECT * FROM payable_titles WHERE contract_id = $1`,
    [contract.id]
  );
  const existingKeys = new Set(
    existing.rows.map((row) => `${String(row.prefixo || "")}::${String(row.parcela || "")}`)
  );
  const template = existing.rows.find((row) => String(row.fornecedor || "").trim()) || existing.rows[0] || null;

  let bank = null;
  if (contract.bank_id) {
    const bankResult = await pool.query(`SELECT * FROM banks WHERE id = $1`, [contract.bank_id]);
    bank = bankResult.rows[0] || null;
  }

  const entityResult = await pool.query(
    `SELECT codigo_empresa, codigo_filial FROM company_entities WHERE id = $1`,
    [contract.entity_id]
  );
  const titles = buildPayableTitles(contract, bank, entityResult.rows[0] || null)
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
           fornecedor, fornecedor_loja, fornecedor_nome, filial, filial_origem, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (contract_id, prefixo, parcela) DO NOTHING
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
        ]
      );
      if (inserted.rows[0]) createdRows.push(inserted.rows[0]);
    }
    await client.query(
      `UPDATE loan_contracts SET exported_to_payables = true, updated_date = now() WHERE id = $1`,
      [contract.id]
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
       AND (COALESCE(t.fornecedor, '') = '' OR COALESCE(t.fornecedor_nome, '') = '')`
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
       AND COALESCE(e.codigo_empresa, '') <> ''
       AND COALESCE(e.codigo_filial, '') <> ''
       AND (
         COALESCE(t.filial, '') = ''
         OR COALESCE(t.filial_origem, '') = ''
         OR length(regexp_replace(COALESCE(t.filial_origem, ''), '[^0-9]', '', 'g')) <= 2
       )`
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

  let sql = `
    SELECT t.id, t.contract_id, t.parcela, t.prefixo, t.valor, c.schedule_data
    FROM payable_titles t
    JOIN loan_contracts c ON c.id = t.contract_id
    WHERE t.status = 'aberto'
      AND COALESCE(t.integrado_erp, false) = false
      AND c.currency_id IS NOT NULL
  `;
  const params = [];
  if (ids?.length) {
    params.push(ids);
    sql += ` AND t.id = ANY($1::text[])`;
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
      `UPDATE payable_titles SET valor = $2, saldo = $2, updated_date = now() WHERE id = $1`,
      [title.id, valorNovo]
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
    `SELECT * FROM loan_contracts WHERE status = 'aprovado'`
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
