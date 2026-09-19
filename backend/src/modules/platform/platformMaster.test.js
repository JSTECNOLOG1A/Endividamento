import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import bcrypt from "bcryptjs";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";

function fail(message) {
  throw new Error(message);
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

function tokenFor(user, tenant) {
  return issueAuthResponse(user, tenant).token;
}

async function main() {
  const suffix = `${Date.now()}`;
  const groupA = `grp_pm_a_${suffix}`;
  const groupB = `grp_pm_b_${suffix}`;
  const tenantA = `tnt_pm_a_${suffix}`;
  const tenantB = `tnt_pm_b_${suffix}`;
  const masterId = randomUUID();
  const adminA = randomUUID();
  const adminB = randomUUID();
  const emailMaster = `pm-master-${suffix}@test.local`;
  const emailA = `pm-a-${suffix}@test.local`;
  const emailB = `pm-b-${suffix}@test.local`;
  const password = "Endividamento!Test1";
  const hash = await bcrypt.hash(password, 4);

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'PM A','ativo','teste'), ($2,'PM B','ativo','teste')`,
      [groupA, groupB]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, lifecycle_status, owner_email, created_by, onboarding_completed_at)
       VALUES ($1,$2,'Tenant PM A','STARTER','active','ACTIVE',$3,'teste', now()),
              ($4,$5,'Tenant PM B','STARTER','active','ACTIVE',$6,'teste', now())`,
      [tenantA, groupA, emailA, tenantB, groupB, emailB]
    );
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, platform_admin, created_by)
       VALUES ($1,$2,$3,'Platform Master','admin','active', true,'teste'),
              ($4,$5,$3,'Admin A','admin','active', false,'teste'),
              ($6,$7,$3,'Admin B','admin','active', false,'teste')`,
      [masterId, emailMaster, hash, adminA, emailA, adminB, emailB]
    );
    await pool.query(
      `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, created_by)
       VALUES ($1,$2,$3,$4,'OWNER','teste'), ($5,$6,$7,$8,'OWNER','teste')`,
      [`tu_pm_a_${suffix}`, tenantA, groupA, emailA, `tu_pm_b_${suffix}`, tenantB, groupB, emailB]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  const tenantRowA = { id: tenantA, group_id: groupA, tenant_name: "Tenant PM A" };
  const tenantRowB = { id: tenantB, group_id: groupB, tenant_name: "Tenant PM B" };
  const masterToken = tokenFor(
    { id: masterId, email: emailMaster, full_name: "Platform Master", role: "admin", platform_admin: true },
    null
  );
  const tokenA = tokenFor(
    { id: adminA, email: emailA, full_name: "Admin A", role: "admin", platform_admin: false },
    tenantRowA
  );
  const tokenB = tokenFor(
    { id: adminB, email: emailB, full_name: "Admin B", role: "admin", platform_admin: false },
    tenantRowB
  );

  try {
    // Tenant admin → /platform = 403
    const forbidden = await jsonRequest(server, { method: "GET", path: "/api/platform/tenants", token: tokenA });
    if (forbidden.status !== 403) fail(`tenant admin platform: ${forbidden.status}`);

    // User comum (viewer-like) — mesmo 403
    const forbiddenB = await jsonRequest(server, { method: "GET", path: "/api/platform/overview", token: tokenB });
    if (forbiddenB.status !== 403) fail(`user B platform overview: ${forbiddenB.status}`);

    // Master lista tenants
    const list = await jsonRequest(server, { method: "GET", path: "/api/platform/tenants", token: masterToken });
    if (list.status !== 200) fail(`master list ${list.status}`);
    if (!Array.isArray(list.json) || !list.json.some((t) => t.id === tenantA)) fail("master não vê tenant A");

    // IDOR: tenant A não lê tenant B via platform
    const idor = await jsonRequest(server, {
      method: "GET",
      path: `/api/platform/tenants/${tenantB}`,
      token: tokenA,
    });
    if (idor.status !== 403) fail(`IDOR platform detail: ${idor.status}`);

    // Step-up + suspend
    const step = await jsonRequest(server, {
      method: "POST",
      path: "/api/platform/step-up",
      token: masterToken,
      body: { password },
    });
    if (step.status !== 200) fail(`step-up ${step.status} ${JSON.stringify(step.json)}`);

    const suspend = await jsonRequest(server, {
      method: "POST",
      path: `/api/platform/tenants/${tenantA}/suspend`,
      token: masterToken,
      body: { reason: "MANUTENCAO_ADMINISTRATIVA" },
    });
    if (suspend.status !== 200) fail(`suspend ${suspend.status} ${JSON.stringify(suspend.json)}`);
    if (suspend.json.lifecycle_status !== "SUSPENDED") fail("lifecycle SUSPENDED");

    // Login do usuário do tenant suspenso
    const loginSuspended = await jsonRequest(server, {
      method: "POST",
      path: "/api/auth/login",
      body: { email: emailA, password },
    });
    if (loginSuspended.status !== 403 || loginSuspended.json?.code !== "TENANT_SUSPENDED") {
      fail(`login suspenso: ${loginSuspended.status} ${JSON.stringify(loginSuspended.json)}`);
    }

    // Reativar
    await jsonRequest(server, {
      method: "POST",
      path: "/api/platform/step-up",
      token: masterToken,
      body: { password },
    });
    const reactivate = await jsonRequest(server, {
      method: "POST",
      path: `/api/platform/tenants/${tenantA}/reactivate`,
      token: masterToken,
      body: { reason: "Teste" },
    });
    if (reactivate.status !== 200 || reactivate.json.lifecycle_status !== "ACTIVE") {
      fail(`reactivate ${reactivate.status}`);
    }

    // Support session sem motivo → 400
    const badSupport = await jsonRequest(server, {
      method: "POST",
      path: `/api/platform/tenants/${tenantA}/support-session`,
      token: masterToken,
      body: { reason: "curto", duration_minutes: 30 },
    });
    if (badSupport.status !== 400) fail(`support curto ${badSupport.status}`);

    // Support session OK
    const support = await jsonRequest(server, {
      method: "POST",
      path: `/api/platform/tenants/${tenantA}/support-session`,
      token: masterToken,
      body: { reason: "Investigação do chamado SUP-TEST-001", duration_minutes: 15, ticket_reference: "SUP-TEST-001" },
    });
    if (support.status !== 201 || !support.json?.id) fail(`support start ${support.status}`);

    // Data plane com support header
    const withSupport = await jsonRequest(server, {
      method: "GET",
      path: "/api/contracts",
      token: masterToken,
      headers: {
        "x-support-session-id": support.json.id,
        "x-tenant-id": tenantA,
      },
    });
    if (withSupport.status !== 200) fail(`contracts com support ${withSupport.status}`);

    // Data plane sem support → TENANT_CONTEXT / SUPPORT_SESSION_REQUIRED
    const noSupport = await jsonRequest(server, {
      method: "GET",
      path: "/api/contracts",
      token: masterToken,
      headers: { "x-tenant-id": tenantA },
    });
    if (noSupport.status === 200) fail("master não deveria ler contracts só com X-Tenant-Id");

    // Encerrar suporte
    const ended = await jsonRequest(server, {
      method: "DELETE",
      path: `/api/platform/support-sessions/${support.json.id}`,
      token: masterToken,
    });
    if (ended.status !== 200) fail(`end support ${ended.status}`);

    // Após encerrar, data plane bloqueado
    const afterEnd = await jsonRequest(server, {
      method: "GET",
      path: "/api/contracts",
      token: masterToken,
      headers: {
        "x-support-session-id": support.json.id,
        "x-tenant-id": tenantA,
      },
    });
    if (afterEnd.status === 200) fail("sessão encerrada ainda permite data plane");

    // Cross-tenant: A não lista contracts de B (escopo próprio)
    const cross = await jsonRequest(server, {
      method: "GET",
      path: "/api/contracts",
      token: tokenA,
      headers: { "x-tenant-id": tenantB },
    });
    // attachTenant ignora X-Tenant-Id para não-master — deve usar tenant A
    if (cross.status !== 200) fail(`tenant A contracts ${cross.status}`);

    console.log("platformMaster ok: rbac, suspend, support session, data-plane isolation");
  } finally {
    server.close();
    try {
      await pool.query(`UPDATE support_sessions SET status = 'ended', ended_at = now() WHERE master_user_id = $1`, [masterId]);
      await pool.query(`DELETE FROM tenant_users WHERE group_id = ANY($1::text[])`, [[groupA, groupB]]);
      await pool.query(
        `UPDATE users SET status = 'disabled', email = email || '.retired.' || id::text
         WHERE id = ANY($1::uuid[])`,
        [[masterId, adminA, adminB]]
      );
    } catch (cleanupError) {
      console.warn("cleanup:", cleanupError.message);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
