import { randomUUID } from "node:crypto";
import { pool } from "./pool.js";
import { DELETE_ORDER } from "./cleanupOrder.js";

// A limpeza do ambiente local apaga um grupo com dados da Gestão Tributária (parcelamento, parcela, guia, envio e
// título de tributo). Tudo numa transação desfeita no fim: nada fica apagado nem criado.

process.exitCode = 1;
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const TAX_TABLES = ["tax_guide_sends", "tax_payable_titles", "tax_installment_guides", "tax_installments", "tax_agreements"];

async function seed(client, groupId) {
  const entityId = `ent_clean_${randomUUID()}`;
  const agreementId = randomUUID();
  const installmentId = randomUUID();
  const guideId = randomUUID();
  const line = "836400000011331201380002812884627116080136181551";
  const barcode = "83640000001331201380008128846271108013618155";
  await client.query(`INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Limpeza','ativo','teste')`, [groupId]);
  await client.query(
    `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
     VALUES ($1,$2,'Empresa limpeza','00.000.000/0001-55','CNPJ','empresa','55','01','ativa','teste')`,
    [entityId, groupId]
  );
  await client.query(
    `INSERT INTO tax_agreements (id, group_id, entity_id, esfera, orgao, modalidade, codigo_parcelamento, created_by)
     VALUES ($1,$2,$3,'federal','PGFN','Transação','LIMP-1','teste')`,
    [agreementId, groupId, entityId]
  );
  await client.query(
    `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor, created_by) VALUES ($1,$2,$3,1,'2026-03-31',10,'teste')`,
    [installmentId, groupId, agreementId]
  );
  await client.query(
    `INSERT INTO tax_installment_guides (id, group_id, installment_id, origem, linha_fonte, linha_digitavel, codigo_barras, valor_guia, situacao, motivos)
     VALUES ($1,$2,$3,'digitada','digitada',$4,$5,133.12,'vinculada','[]')`,
    [guideId, groupId, installmentId, line, barcode]
  );
  await client.query(
    `INSERT INTO tax_guide_sends (id, group_id, guide_id, installment_id, destinatarios, assunto, com_anexo, resultado)
     VALUES ($1,$2,$3,$4,ARRAY['x@teste.local'],'teste',false,'enviado')`,
    [randomUUID(), groupId, guideId, installmentId]
  );
  await client.query(
    `INSERT INTO tax_payable_titles (id, group_id, installment_id, numero_e2, situacao, guide_id)
     VALUES ($1,$2,$3,lpad(nextval('tax_payable_title_number_seq')::text, 9, '0'),'estornado',$4)`,
    [randomUUID(), groupId, installmentId, guideId]
  );
}

async function cleanup(client, groupId, order) {
  await client.query("ALTER TABLE audit_events DISABLE TRIGGER ALL");
  await client.query("ALTER TABLE calculation_snapshots DISABLE TRIGGER ALL");
  for (const table of order) await client.query(`DELETE FROM ${table} WHERE group_id = $1`, [groupId]);
  await client.query("DELETE FROM groups WHERE id = $1", [groupId]);
}

async function attempt(order) {
  const client = await pool.connect();
  const groupId = `grp_clean_${randomUUID()}`;
  try {
    await client.query("BEGIN");
    await seed(client, groupId);
    try {
      await cleanup(client, groupId, order);
      const left = await client.query(`SELECT count(*)::int AS n FROM groups WHERE id = $1`, [groupId]);
      return { ok: left.rows[0].n === 0 };
    } catch (error) {
      return { ok: false, error };
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

async function main() {
  check(TAX_TABLES.every((table) => DELETE_ORDER.includes(table)), "tabelas da Gestão Tributária na ordem de limpeza");
  const position = (table) => DELETE_ORDER.indexOf(table);
  check(TAX_TABLES.every((table, i) => i === 0 || position(TAX_TABLES[i - 1]) < position(table)), "dependentes antes do parcelamento");
  check(position("tax_agreements") < position("company_entities"), "parcelamento antes da empresa");
  const withTax = await attempt(DELETE_ORDER);
  check(withTax.ok, `limpeza apaga grupo com dados da Gestão Tributária: ${withTax.error?.message}`);
  // Sem as tabelas da Gestão Tributária, a mesma limpeza falha (era o defeito).
  const withoutTax = await attempt(DELETE_ORDER.filter((table) => !TAX_TABLES.includes(table)));
  check(!withoutTax.ok && withoutTax.error?.code === "23503", `sem elas a limpeza falharia: ${withoutTax.error?.code}`);
  if (failures.length) {
    console.error(`limpeza local: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log("limpeza local ok: grupo com dados da Gestão Tributária é apagado");
  await pool.end();
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  for (const message of failures) console.error(` - ${message}`);
  pool.end().finally(() => process.exit(1));
});
