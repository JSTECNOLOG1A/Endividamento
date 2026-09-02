import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { pool } from "../../db/pool.js";
import { config } from "../../config.js";
import { runWithTenant } from "../tenants/access.js";
import * as store from "../entities/store.js";
import { deleteGuaranteedAccount, refreshGuaranteedAccountPayableTitle, cleanupOrphanedPayableTitles, reopenApprovedContractForEditing } from "../payables/generate.js";
import { cleanupOrphanedReceivableTitles } from "../receivables/generate.js";
import { clearCDIRatesByType, clearCurrencyRates } from "../functions/bacen.js";
import { adminEmails } from "../notifications/contractNotifications.js";
import { publicInvitePayload } from "../users/service.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";

function fail(message) {
  throw new Error(message);
}

async function expectStatus(fn, status) {
  try {
    await fn();
    return { threw: false };
  } catch (error) {
    return { threw: true, status: error.status, code: error.code, message: error.message };
  }
}

function as(scope, fn) {
  return runWithTenant(scope, fn);
}

function jsonRequest(server, { method, path, body, token, headers = {} }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body == null ? null : JSON.stringify(body);
    const reqHeaders = {
      host: `127.0.0.1:${address.port}`,
      ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    };
    const req = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path,
      method,
      headers: reqHeaders,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = text; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const suffix = `${Date.now()}`;
  const groupA = `grp_p0_a_${suffix}`;
  const groupB = `grp_p0_b_${suffix}`;
  const entityA = `ent_p0_a_${suffix}`;
  const entityB = `ent_p0_b_${suffix}`;
  const tenantA = `tnt_p0_a_${suffix}`;
  const tenantB = `tnt_p0_b_${suffix}`;
  const contractA = `ctr_p0_a_${suffix}`;
  const contractB = `ctr_p0_b_${suffix}`;
  const titleA = `ttl_p0_a_${suffix}`;
  const titleB = `ttl_p0_b_${suffix}`;
  const recvB = `rcv_p0_b_${suffix}`;
  const moveA = `mov_p0_a_${suffix}`;
  const moveB = `mov_p0_b_${suffix}`;
  const userAdminA = randomUUID();
  const userUserA = randomUUID();
  const userViewA = randomUUID();
  const userAdminB = randomUUID();
  const emailAdminA = `admin-a-${suffix}@p0.test`;
  const emailUserA = `user-a-${suffix}@p0.test`;
  const emailViewA = `view-a-${suffix}@p0.test`;
  const emailAdminB = `admin-b-${suffix}@p0.test`;
  const cdiGlobal = `cdi_p0_g_${suffix}`;
  const cdiB = `cdi_p0_b_${suffix}`;
  const curB = `cur_p0_b_${suffix}`;

  const bank = await pool.query(`SELECT id FROM banks ORDER BY created_date ASC LIMIT 1`);
  if (!bank.rows[0]) fail("precisa de banco cadastrado");

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'P0 A','ativo','teste'), ($2,'P0 B','ativo','teste')`,
      [groupA, groupB]
    );
    await pool.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
       VALUES ($1,$2,'Ent A','00.000.000/0001-81','CNPJ','empresa','81','01','ativa','teste'),
              ($3,$4,'Ent B','00.000.000/0001-82','CNPJ','empresa','82','01','ativa','teste')`,
      [entityA, groupA, entityB, groupB]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'P0 A','STARTER','trial',$5,'teste'),
              ($3,$4,'P0 B','STARTER','trial',$6,'teste')`,
      [tenantA, groupA, tenantB, groupB, emailAdminA, emailAdminB]
    );
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, created_by)
       VALUES ($1,$2,'hash','Admin A','admin','active','teste'),
              ($3,$4,'hash','User A','user','active','teste'),
              ($5,$6,'hash','Viewer A','viewer','active','teste'),
              ($7,$8,'hash','Admin B','admin','active','teste')`,
      [userAdminA, emailAdminA, userUserA, emailUserA, userViewA, emailViewA, userAdminB, emailAdminB]
    );
    await pool.query(
      `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, created_by)
       VALUES ($1,$2,$3,$4,'OWNER','teste'),
              ($5,$2,$3,$6,'ADMIN','teste'),
              ($7,$2,$3,$8,'VIEWER','teste'),
              ($9,$10,$11,$12,'OWNER','teste')`,
      [
        `tu_${suffix}aa`, tenantA, groupA, emailAdminA,
        `tu_${suffix}au`, emailUserA,
        `tu_${suffix}av`, emailViewA,
        `tu_${suffix}bb`, tenantB, groupB, emailAdminB,
      ]
    );
    await pool.query(
      `INSERT INTO loan_contracts (id, group_id, entity_id, bank_id, contract_number, status, calculation_system, created_by)
       VALUES ($1,$2,$3,$4,'P0-A','rascunho','CONTA_GARANTIDA','teste'),
              ($5,$6,$7,$4,'P0-B','rascunho','CONTA_GARANTIDA','teste')`,
      [contractA, groupA, entityA, bank.rows[0].id, contractB, groupB, entityB]
    );
    await pool.query(
      `INSERT INTO payable_titles (id, group_id, entity_id, contract_id, parcela, titulo_numero, valor, saldo, status, created_by)
       VALUES ($1,$2,$3,$4,'001','000000001',10,10,'aberto','teste'),
              ($5,$6,$7,$8,'001','000000002',20,20,'aberto','teste')`,
      [titleA, groupA, entityA, contractA, titleB, groupB, entityB, contractB]
    );
    await pool.query(
      `INSERT INTO receivable_titles (id, group_id, entity_id, contract_id, parcela, titulo_numero, valor, saldo, status, created_by)
       VALUES ($1,$2,$3,$4,'001','000000003',30,30,'aberto','teste')`,
      [recvB, groupB, entityB, contractB]
    );
    await pool.query(
      `INSERT INTO account_movements (id, group_id, contract_id, movement_date, movement_type, amount, created_by)
       VALUES ($1,$2,$3,CURRENT_DATE,'saque',100,'teste'),
              ($4,$5,$6,CURRENT_DATE,'saque',200,'teste')`,
      [moveA, groupA, contractA, moveB, groupB, contractB]
    );
    await pool.query(
      `INSERT INTO cdi_rates (id, rate_date, annual_rate, daily_factor, rate_type, created_by)
       VALUES ($1, DATE '1999-01-01', 10, 1.0001, 'CDI', 'teste')`,
      [cdiGlobal]
    );
    await pool.query(
      `INSERT INTO cdi_rates (id, group_id, rate_date, annual_rate, daily_factor, rate_type, created_by)
       VALUES ($1,$2, DATE '1999-01-01', 11, 1.0002, 'CDI', 'teste')`,
      [cdiB, groupB]
    );
    await pool.query(
      `INSERT INTO currencies (id, group_id, currency_code, currency_name, exchange_rate, rate_date, status, created_by)
       VALUES ($1,$2,'USD','Dólar tenant B',5.1,CURRENT_DATE,'ativa','teste')`,
      [curB, groupB]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  const scopeA = { groupId: groupA, tenantId: tenantA, email: emailAdminA, role: "admin", tenantRole: "OWNER" };
  const scopeUserA = { groupId: groupA, tenantId: tenantA, email: emailUserA, role: "user", tenantRole: "ADMIN" };
  const scopeViewA = { groupId: groupA, tenantId: tenantA, email: emailViewA, role: "viewer", tenantRole: "VIEWER" };
  const scopeB = { groupId: groupB, tenantId: tenantB, email: emailAdminB, role: "admin", tenantRole: "OWNER" };
  const scopeMasterA = { groupId: groupA, tenantId: tenantA, email: "master@p0.test", role: "admin", tenantRole: "PLATFORM", platformAdmin: true };
  const scopeMasterNone = { groupId: null, tenantId: null, email: "master@p0.test", role: "admin", tenantRole: "PLATFORM", platformAdmin: true };

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const listB = await as(scopeB, () => store.list("LoanContract", "", 100));
    if (!listB.some((row) => row.id === contractB)) fail("B deveria ver o próprio contrato");
    if (listB.some((row) => row.id === contractA)) fail("B listou contrato de A");

    const getCross = await expectStatus(() => as(scopeA, () => store.getById("LoanContract", contractB)));
    if (!getCross.threw || getCross.status !== 404) fail("GET A→B deveria 404");

    const patchCross = await expectStatus(() => as(scopeA, () => store.update("LoanContract", contractB, { rejection_comments: "x" })));
    if (!patchCross.threw || patchCross.status !== 404) fail("PATCH A→B deveria 404");

    const deleteCross = await expectStatus(() => as(scopeA, () => store.remove("LoanContract", contractB)));
    if (!deleteCross.threw || ![403, 404].includes(deleteCross.status)) fail("DELETE store A→B deveria 403/404");

    const moveList = await as(scopeA, () => store.list("AccountMovement", "", 100));
    if (moveList.some((row) => row.id === moveB)) fail("A listou movimento de B");
    const moveGet = await expectStatus(() => as(scopeA, () => store.getById("AccountMovement", moveB)));
    if (!moveGet.threw || moveGet.status !== 404) fail("GET movimento B por A deveria 404");

    const delFn = await expectStatus(() => as(scopeA, () => deleteGuaranteedAccount({ contractId: contractB })));
    if (!delFn.threw || delFn.status !== 404) fail("deleteGuaranteedAccount A→B deveria 404");

    const userDel = await expectStatus(() => as(scopeUserA, () => deleteGuaranteedAccount({ contractId: contractA })));
    if (!userDel.threw || userDel.status !== 403) fail("user não pode deleteGuaranteedAccount");

    const viewerWrite = await expectStatus(() => as(scopeViewA, () => store.update("LoanContract", contractA, { rejection_comments: "x" })));
    if (!viewerWrite.threw || viewerWrite.status !== 403) fail("viewer não pode PATCH");

    const refreshCross = await expectStatus(() => as(scopeA, () => refreshGuaranteedAccountPayableTitle({ contractId: contractB })));
    if (!refreshCross.threw || refreshCross.status !== 404) fail("refresh A→B deveria 404");

    const reopenCross = await expectStatus(() => as(scopeA, () => reopenApprovedContractForEditing({ contractId: contractB })));
    if (!reopenCross.threw || reopenCross.status !== 404) fail("reopen A→B deveria 404");

    const cleanupUser = await expectStatus(() => as(scopeA, () => cleanupOrphanedPayableTitles({})));
    if (!cleanupUser.threw || cleanupUser.status !== 403) fail("cleanup por tenant comum deveria 403");

    const cleanupNoTenant = await expectStatus(() => as(scopeMasterNone, () => cleanupOrphanedPayableTitles({})));
    if (!cleanupNoTenant.threw || cleanupNoTenant.status !== 400) fail("cleanup master sem tenant deveria 400");

    await as(scopeMasterA, () => cleanupOrphanedPayableTitles({}));
    const titleBAfter = await pool.query(`SELECT id FROM payable_titles WHERE id = $1`, [titleB]);
    const recvBAfter = await pool.query(`SELECT id FROM receivable_titles WHERE id = $1`, [recvB]);
    if (!titleBAfter.rows[0]) fail("cleanup do tenant A apagou título de B");
    if (!recvBAfter.rows[0]) fail("cleanup do tenant A apagou recebível de B");

    const recvCleanupUser = await expectStatus(() => as(scopeB, () => cleanupOrphanedReceivableTitles()));
    if (!recvCleanupUser.threw || recvCleanupUser.status !== 403) fail("cleanup recebíveis por tenant comum deveria 403");

    await as(scopeA, () => clearCDIRatesByType({ rateType: "CDI" }));
    const globalLeft = await pool.query(`SELECT id FROM cdi_rates WHERE id = $1`, [cdiGlobal]);
    const bLeft = await pool.query(`SELECT id FROM cdi_rates WHERE id = $1`, [cdiB]);
    if (!globalLeft.rows[0]) fail("tenant A apagou CDI global");
    if (!bLeft.rows[0]) fail("tenant A apagou CDI do tenant B");

    await as(scopeA, () => clearCurrencyRates({ currencyCode: "USD" }));
    const curBLeft = await pool.query(`SELECT id FROM currencies WHERE id = $1`, [curB]);
    const sharedUsd = await pool.query(`SELECT id FROM currencies WHERE currency_code = 'USD' AND group_id IS NULL LIMIT 1`);
    if (!curBLeft.rows[0]) fail("tenant A apagou currency de B");
    if (!sharedUsd.rows[0]) fail("tenant A apagou currency global");

    const emails = await as(scopeA, () => adminEmails());
    if (!emails.includes(emailAdminA)) fail("admin A deveria receber notificação do próprio tenant");
    if (emails.includes(emailAdminB)) fail("admin B não pode receber notificação do tenant A");

    const created = await as(scopeA, () => store.create("LoanContract", {
      entity_id: entityA,
      bank_id: bank.rows[0].id,
      contract_number: `P0-CREATE-${suffix}`,
      status: "aprovado",
      approved_by: "invasor",
      approved_date: "2020-01-01",
      exported_to_payables: true,
    }, emailAdminA));
    if (created.status !== "rascunho") fail(`CREATE não pode nascer aprovado (status=${created.status})`);
    if (created.approved_by) fail("CREATE não pode gravar approved_by do cliente");
    if (created.exported_to_payables === true) fail("CREATE não pode marcar exported_to_payables");

    await as(scopeA, () => store.update("LoanContract", contractA, { approved_by: "invasor" }));
    const afterPatch = await as(scopeA, () => store.getById("LoanContract", contractA));
    if (afterPatch.approved_by === "invasor") fail("PATCH approved_by não pode persistir");

    const masterUnscoped = await expectStatus(() => as(scopeMasterNone, () => store.list("LoanContract", "", 10)));
    if (!masterUnscoped.threw || masterUnscoped.status !== 400) fail("master sem tenant não lista contratos de clientes");

    const tokenA = issueAuthResponse(
      { id: userAdminA, email: emailAdminA, full_name: "Admin A", role: "admin", platform_admin: false },
      { id: tenantA, group_id: groupA, tenant_name: "P0 A", tenant_role: "OWNER", billing_status: "trial", plan: "STARTER" }
    ).token;

    const forgotExisting = await jsonRequest(server, {
      method: "POST",
      path: "/api/public/forgot-password",
      body: { email: emailAdminA },
    });
    const forgotMissing = await jsonRequest(server, {
      method: "POST",
      path: "/api/public/forgot-password",
      body: { email: `missing-${suffix}@p0.test` },
    });
    if (forgotExisting.status !== 200 || forgotMissing.status !== 200) fail("forgot-password deve responder 200");
    const keysExisting = Object.keys(forgotExisting.json).sort().join(",");
    const keysMissing = Object.keys(forgotMissing.json).sort().join(",");
    if (keysExisting !== keysMissing) fail("forgot-password não pode diferenciar existência pela forma da resposta");
    if (forgotExisting.json.reset_url || forgotExisting.json.token || forgotExisting.json.reset_token) {
      fail("forgot-password não pode devolver token");
    }
    if (forgotExisting.json.email_sent != null) fail("forgot-password não pode devolver email_sent");

    const billing = await jsonRequest(server, {
      method: "PATCH",
      path: "/api/billing/plan",
      token: tokenA,
      body: { plan: "ENTERPRISE", billing_status: "active" },
    });
    if (billing.status !== 403 || billing.json?.code !== "BILLING_LOCKED") {
      fail(`self-upgrade deveria 403 BILLING_LOCKED, veio ${billing.status} ${billing.json?.code}`);
    }
    const tenantStill = await pool.query(`SELECT plan, billing_status FROM tenants WHERE id = $1`, [tenantA]);
    if (tenantStill.rows[0].plan === "ENTERPRISE" || tenantStill.rows[0].billing_status === "active") {
      fail("plano do tenant A foi alterado pelo PATCH público");
    }

    if (config.env === "production") {
      const leaked = publicInvitePayload(false, "https://app.example/aceitar-convite?token=secret");
      if (leaked.invite_url) fail("production não pode devolver invite_url");
    } else {
      const dev = publicInvitePayload(false, "https://localhost/aceitar-convite?token=secret");
      if (!dev.invite_url) fail("development pode devolver invite_url quando SMTP falha");
      const hidden = publicInvitePayload(true, "https://localhost/aceitar-convite?token=secret");
      if (hidden.invite_url) fail("invite_url não deve aparecer quando o e-mail foi enviado");
    }

    const victim = await pool.query(
      `SELECT
         (SELECT count(*) FROM loan_contracts WHERE id = $1) AS contracts,
         (SELECT count(*) FROM payable_titles WHERE id = $2) AS titles,
         (SELECT count(*) FROM account_movements WHERE id = $3) AS moves,
         (SELECT count(*) FROM receivable_titles WHERE id = $4) AS recvs`,
      [contractB, titleB, moveB, recvB]
    );
    const row = victim.rows[0];
    if (Number(row.contracts) !== 1 || Number(row.titles) !== 1 || Number(row.moves) !== 1 || Number(row.recvs) !== 1) {
      fail("tenant B sofreu alteração após ataques A→B");
    }

    console.log("p0 tenant-isolation + auth + billing + reset ok");
  } finally {
    server.close();
    await pool.query(`DELETE FROM account_movements WHERE id IN ($1,$2)`, [moveA, moveB]);
    await pool.query(`DELETE FROM payable_titles WHERE id IN ($1,$2)`, [titleA, titleB]);
    await pool.query(`DELETE FROM receivable_titles WHERE id = $1`, [recvB]);
    await pool.query(`DELETE FROM loan_contracts WHERE contract_number = $1`, [`P0-CREATE-${suffix}`]);
    await pool.query(`DELETE FROM loan_contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await pool.query(`DELETE FROM cdi_rates WHERE id IN ($1,$2)`, [cdiGlobal, cdiB]);
    await pool.query(`DELETE FROM currencies WHERE id = $1`, [curB]);
    await pool.query(`DELETE FROM tenant_users WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [userAdminA, userUserA, userViewA, userAdminB]);
    await pool.query(`DELETE FROM account_tokens WHERE user_id IN ($1,$2,$3,$4)`, [userAdminA, userUserA, userViewA, userAdminB]);
    await pool.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [tenantA, tenantB]);
    await pool.query(`DELETE FROM company_entities WHERE id IN ($1,$2)`, [entityA, entityB]);
    await pool.query(`DELETE FROM groups WHERE id IN ($1,$2)`, [groupA, groupB]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
