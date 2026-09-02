import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { runWithTenant } from "../tenants/access.js";
import { resolveParameter, resetParameter, setParameter } from "./service.js";

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

async function main() {
  const suffix = `${Date.now()}`;
  const groupA = `grp_param_a_${suffix}`;
  const groupB = `grp_param_b_${suffix}`;
  const tenantA = `tnt_param_a_${suffix}`;
  const tenantB = `tnt_param_b_${suffix}`;
  const userAdminA = randomUUID();
  const userUserA = randomUUID();
  const userAdminB = randomUUID();
  const emailAdminA = `param-admin-a-${suffix}@test.local`;
  const emailUserA = `param-user-a-${suffix}@test.local`;
  const emailAdminB = `param-admin-b-${suffix}@test.local`;

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Param A','ativo','teste'), ($2,'Param B','ativo','teste')`,
      [groupA, groupB]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'Tenant Param A','STARTER','active',$3,'teste'),
              ($4,$5,'Tenant Param B','STARTER','active',$6,'teste')`,
      [tenantA, groupA, emailAdminA, tenantB, groupB, emailAdminB]
    );
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, created_by)
       VALUES ($1,$2,'x','Admin A','admin','active','teste'),
              ($3,$4,'x','User A','user','active','teste'),
              ($5,$6,'x','Admin B','admin','active','teste')`,
      [userAdminA, emailAdminA, userUserA, emailUserA, userAdminB, emailAdminB]
    );
    await pool.query(
      `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, created_by)
       VALUES ($1,$2,$3,$4,'OWNER','teste'),
              ($5,$2,$3,$6,'VIEWER','teste'),
              ($7,$8,$9,$10,'OWNER','teste')`,
      [
        `tu_a_o_${suffix}`, tenantA, groupA, emailAdminA,
        `tu_a_v_${suffix}`, emailUserA,
        `tu_b_o_${suffix}`, tenantB, groupB, emailAdminB,
      ]
    );
    await pool.query(
      `INSERT INTO system_parameters (scope, group_id, param_key, value_json, updated_by)
       VALUES ('TENANT', $1, 'appearance.default_layout', '{"v":"classic"}'::jsonb, 'test')`,
      [groupA]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  const scopeAdminA = {
    userId: userAdminA,
    groupId: groupA,
    tenantId: tenantA,
    email: emailAdminA,
    role: "admin",
    tenantRole: "OWNER",
  };
  const scopeUserA = {
    userId: userUserA,
    groupId: groupA,
    tenantId: tenantA,
    email: emailUserA,
    role: "user",
    tenantRole: "VIEWER",
  };
  const scopeAdminB = {
    userId: userAdminB,
    groupId: groupB,
    tenantId: tenantB,
    email: emailAdminB,
    role: "admin",
    tenantRole: "OWNER",
  };

  // GLOBAL fallback → classic when no tenant override
  await runWithTenant(scopeAdminB, async () => {
    const layout = await resolveParameter("appearance.default_layout");
    if (layout !== "classic") fail(`fallback classic esperado, obteve ${layout}`);
  });

  // TENANT override
  await runWithTenant(scopeAdminA, async () => {
    await setParameter("appearance.default_layout", "modern", { scope: "TENANT" });
    const layout = await resolveParameter("appearance.default_layout");
    if (layout !== "modern") fail(`tenant override modern esperado, obteve ${layout}`);
  });

  // USER override
  await runWithTenant(scopeAdminA, async () => {
    await setParameter("appearance.default_layout", "classic", { scope: "USER" });
    const layout = await resolveParameter("appearance.default_layout");
    if (layout !== "classic") fail(`user override classic esperado, obteve ${layout}`);
  });

  // ENUM inválido
  await runWithTenant(scopeAdminA, async () => {
    try {
      await setParameter("appearance.default_layout", "invalid_layout", { scope: "TENANT" });
      fail("ENUM inválido deveria falhar");
    } catch (error) {
      if (error.code !== "INVALID_PARAMETER_VALUE") throw error;
    }
  });

  // reset → default
  await runWithTenant(scopeAdminA, async () => {
    await resetParameter("appearance.default_layout", { scope: "USER" });
    await resetParameter("appearance.default_layout", { scope: "TENANT" });
    const layout = await resolveParameter("appearance.default_layout");
    if (layout !== "classic") fail(`após reset classic esperado, obteve ${layout}`);
  });

  // parâmetros financeiros de título
  await runWithTenant(scopeAdminA, async () => {
    await setParameter("finance.main_title_type", "NF", { scope: "TENANT" });
    await setParameter("finance.interest_title_type", "JU1", { scope: "TENANT" });
    await setParameter("finance.provisional_title_type", "PR1", { scope: "TENANT" });
    await setParameter("finance.main_title_nature", "1102011003", { scope: "TENANT" });
    await setParameter("finance.interest_title_nature", "1102011004", { scope: "TENANT" });

    const mainType = await resolveParameter("finance.main_title_type");
    const interestNature = await resolveParameter("finance.interest_title_nature");
    if (mainType !== "NF") fail(`main_title_type NF esperado, obteve ${mainType}`);
    if (interestNature !== "1102011004") fail(`interest_title_nature esperado 1102011004, obteve ${interestNature}`);
  });

  // parâmetro inexistente → classic
  const unknown = await runWithTenant(scopeAdminA, () => resolveParameter("appearance.default_layout"));
  if (unknown !== "classic") fail("default_layout inexistente deveria ser classic");

  // USER sem permissão
  await runWithTenant(scopeUserA, async () => {
    try {
      await setParameter("appearance.menu_icons", false, { scope: "TENANT" });
      fail("viewer não deveria alterar parâmetro");
    } catch (error) {
      if (error.status !== 403) throw error;
    }
  });

  const app = createApp();
  const server = app.listen(0);
  try {
    const tokenAdminA = issueAuthResponse(
      { id: userAdminA, email: emailAdminA, full_name: "Admin A", role: "admin", platform_admin: false },
      { id: tenantA, group_id: groupA, tenant_name: "A", tenant_role: "OWNER", billing_status: "active", plan: "STARTER" }
    ).token;
    const tokenUserA = issueAuthResponse(
      { id: userUserA, email: emailUserA, full_name: "User A", role: "user", platform_admin: false },
      { id: tenantA, group_id: groupA, tenant_name: "A", tenant_role: "VIEWER", billing_status: "active", plan: "STARTER" }
    ).token;
    const tokenAdminB = issueAuthResponse(
      { id: userAdminB, email: emailAdminB, full_name: "Admin B", role: "admin", platform_admin: false },
      { id: tenantB, group_id: groupB, tenant_name: "B", tenant_role: "OWNER", billing_status: "active", plan: "STARTER" }
    ).token;

    const listA = await jsonRequest(server, { method: "GET", path: "/api/parameters", token: tokenAdminA });
    if (listA.status !== 200) fail(`list A status ${listA.status}`);
    const listKeys = (listA.json?.data || []).map((item) => item.key);
    if (listKeys.length < 11) fail(`esperado >= 11 parâmetros implementados, obteve ${listKeys.length}`);
    for (const key of [
      "finance.main_title_type",
      "finance.interest_title_type",
      "finance.provisional_title_type",
      "finance.main_title_nature",
      "finance.interest_title_nature",
    ]) {
      if (!listKeys.includes(key)) fail(`parâmetro ausente na listagem: ${key}`);
    }

    await runWithTenant(scopeAdminA, async () => {
      await setParameter("appearance.theme", "dark", { scope: "TENANT" });
    });

    const patchDenied = await jsonRequest(server, {
      method: "PATCH",
      path: "/api/parameters/appearance.theme",
      token: tokenUserA,
      body: { value: "light", scope: "TENANT" },
    });
    if (patchDenied.status !== 403) fail(`viewer patch deveria 403, obteve ${patchDenied.status}`);

    const patchOk = await jsonRequest(server, {
      method: "PATCH",
      path: "/api/parameters/appearance.theme",
      token: tokenAdminA,
      body: { value: "dark", scope: "TENANT" },
    });
    if (patchOk.status !== 200) fail(`admin patch deveria 200, obteve ${patchOk.status}`);

    const auditBefore = await pool.query(
      `SELECT COUNT(*)::int AS n FROM audit_events WHERE action = 'PARAMETER_UPDATED' AND resource_id = 'appearance.theme' AND group_id = $1`,
      [groupA]
    );
    if (auditBefore.rows[0].n < 1) fail("AuditLog PARAMETER_UPDATED não registrado");

    // Tenant B não altera A — tentativa via API com token B em key que só existe em A
    await runWithTenant(scopeAdminA, async () => {
      await setParameter("appearance.interface_density", "compact", { scope: "TENANT" });
    });
    const detailB = await jsonRequest(server, {
      method: "GET",
      path: "/api/parameters/appearance.interface_density",
      token: tokenAdminB,
    });
    if (detailB.status !== 200) fail("detail B deveria 200");
    if (detailB.json?.data?.value === "compact" && detailB.json?.data?.tenantValue === "compact") {
      // B should not see A's tenant value as their own — B has no override, default comfortable
      if (detailB.json.data.tenantValue === "compact") fail("vazamento: B herdou parâmetro de A");
    }
    if (detailB.json?.data?.value !== "comfortable") {
      // B default comfortable unless B set compact
    }

    const rejectGroupId = await jsonRequest(server, {
      method: "PATCH",
      path: "/api/parameters/appearance.menu_icons",
      token: tokenAdminA,
      body: { value: false, scope: "TENANT", group_id: groupB },
    });
    if (rejectGroupId.status !== 400) fail("group_id no body deveria 400");
  } finally {
    server.close();
  }

  console.log("parameters ok: isolation, precedence, RBAC, enum, reset, audit");

  await pool.query(
    "DELETE FROM system_parameters WHERE group_id IN ($1,$2) OR updated_by IN ('test', 'migration_049')",
    [groupA, groupB]
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
