import { pool } from "../../db/pool.js";
import { runWithTenant } from "./access.js";
import * as store from "../entities/store.js";

function fail(message) {
  throw new Error(message);
}

async function main() {
  const suffix = `${Date.now()}`;
  const groupA = `grp_iso_a_${suffix}`;
  const groupB = `grp_iso_b_${suffix}`;
  const entityA = `ent_iso_a_${suffix}`;
  const entityB = `ent_iso_b_${suffix}`;
  const tenantA = `tnt_iso_a_${suffix}`;
  const tenantB = `tnt_iso_b_${suffix}`;
  const contractA = `ctr_iso_a_${suffix}`;

  const bank = await pool.query(`SELECT id FROM banks ORDER BY created_date ASC LIMIT 1`);
  if (!bank.rows[0]) fail("É preciso ao menos um banco cadastrado para o teste de isolamento");

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Isolamento A','ativo','teste'), ($2,'Isolamento B','ativo','teste')`,
      [groupA, groupB]
    );
    await pool.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
       VALUES ($1,$2,'Entidade A','00.000.000/0001-91','CNPJ','empresa','91','01','ativa','teste'),
              ($3,$4,'Entidade B','00.000.000/0001-92','CNPJ','empresa','92','01','ativa','teste')`,
      [entityA, groupA, entityB, groupB]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'Tenant Iso A','STARTER','trial','iso-a@test.local','teste'),
              ($3,$4,'Tenant Iso B','STARTER','trial','iso-b@test.local','teste')`,
      [tenantA, groupA, tenantB, groupB]
    );
    await pool.query(
      `INSERT INTO loan_contracts (id, group_id, entity_id, bank_id, contract_number, status, created_by)
       VALUES ($1,$2,$3,$4,'ISO-A','rascunho','teste')`,
      [contractA, groupA, entityA, bank.rows[0].id]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  try {
    const listA = await runWithTenant({
      groupId: groupA,
      tenantId: tenantA,
      email: "iso-a@test.local",
      role: "admin",
      tenantRole: "OWNER",
    }, () => store.list("LoanContract", "", 100));
    const listB = await runWithTenant({
      groupId: groupB,
      tenantId: tenantB,
      email: "iso-b@test.local",
      role: "admin",
      tenantRole: "OWNER",
    }, () => store.list("LoanContract", "", 100));

    if (!listA.some((item) => item.id === contractA)) {
      fail("Tenant A deveria ver o próprio contrato");
    }
    if (listB.some((item) => item.id === contractA)) {
      fail("Vazamento: tenant B listou o contrato do tenant A");
    }

    let leaked = false;
    try {
      await runWithTenant({
        groupId: groupB,
        tenantId: tenantB,
        email: "iso-b@test.local",
        role: "admin",
        tenantRole: "OWNER",
      }, () => store.getById("LoanContract", contractA));
      leaked = true;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (leaked) fail("Vazamento: tenant B leu o contrato do tenant A por id");

    console.log("isolamento ok: A não é visível para B");
  } finally {
    await pool.query("DELETE FROM loan_contracts WHERE id = $1", [contractA]);
    await pool.query("DELETE FROM company_entities WHERE id IN ($1,$2)", [entityA, entityB]);
    await pool.query("DELETE FROM tenants WHERE id IN ($1,$2)", [tenantA, tenantB]);
    await pool.query("DELETE FROM groups WHERE id IN ($1,$2)", [groupA, groupB]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
