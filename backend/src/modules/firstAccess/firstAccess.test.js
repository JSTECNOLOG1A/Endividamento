import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import {
  CURRENT_ONBOARDING_VERSION,
} from "./constants.js";

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
  const groupA = `grp_fa_a_${suffix}`;
  const groupB = `grp_fa_b_${suffix}`;
  const tenantA = `tnt_fa_a_${suffix}`;
  const tenantB = `tnt_fa_b_${suffix}`;
  const userNew = randomUUID();
  const userShown = randomUUID();
  const userSkipped = randomUUID();
  const userB = randomUUID();
  const emailNew = `fa-new-${suffix}@test.local`;
  const emailShown = `fa-shown-${suffix}@test.local`;
  const emailSkipped = `fa-skipped-${suffix}@test.local`;
  const emailB = `fa-b-${suffix}@test.local`;

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'FA A','ativo','teste'), ($2,'FA B','ativo','teste')`,
      [groupA, groupB]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by, onboarding_completed_at)
       VALUES ($1,$2,'Tenant FA A','STARTER','active',$3,'teste', now()),
              ($4,$5,'Tenant FA B','STARTER','active',$6,'teste', now())`,
      [tenantA, groupA, emailNew, tenantB, groupB, emailB]
    );
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, created_by,
         first_login_at, onboarding_shown_at, onboarding_completed_at, onboarding_skipped_at, onboarding_version)
       VALUES
         ($1,$2,'x','New User','admin','active','teste', NULL, NULL, NULL, NULL, NULL),
         ($3,$4,'x','Shown User','admin','active','teste', now(), now(), NULL, NULL, '1.0'),
         ($5,$6,'x','Skipped User','admin','active','teste', now(), now(), NULL, now(), '1.0'),
         ($7,$8,'x','Tenant B','admin','active','teste', now(), now(), now(), NULL, '1.0')`,
      [userNew, emailNew, userShown, emailShown, userSkipped, emailSkipped, userB, emailB]
    );
    await pool.query(
      `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, created_by)
       VALUES
         ($1,$2,$3,$4,'OWNER','teste'),
         ($5,$2,$3,$6,'OWNER','teste'),
         ($7,$2,$3,$8,'OWNER','teste'),
         ($9,$10,$11,$12,'OWNER','teste')`,
      [
        `tu_fa_new_${suffix}`, tenantA, groupA, emailNew,
        `tu_fa_shown_${suffix}`, emailShown,
        `tu_fa_skip_${suffix}`, emailSkipped,
        `tu_fa_b_${suffix}`, tenantB, groupB, emailB,
      ]
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

  const tenantRowA = { id: tenantA, group_id: groupA, tenant_name: "Tenant FA A" };
  const tenantRowB = { id: tenantB, group_id: groupB, tenant_name: "Tenant FA B" };

  try {
    // --- CENÁRIO 1: usuário nunca acessou → legal pendente + tour ---
    {
      const token = tokenFor(
        { id: userNew, email: emailNew, full_name: "New User", role: "admin", platform_admin: false },
        tenantRowA
      );
      const state = await jsonRequest(server, { method: "GET", path: "/api/me/onboarding", token });
      if (state.status !== 200) fail(`C1 status ${state.status}`);
      if (!state.json.gate.needsLegal) fail("C1: deveria precisar de LGPD");
      if (!state.json.tour.shouldAutoStart) fail("C1: tour deveria autoiniciar após legal");

      const deny = await jsonRequest(server, {
        method: "POST",
        path: "/api/legal/acceptances",
        token,
        body: { privacyAcknowledged: true, termsAccepted: false, marketingConsent: false },
      });
      if (deny.status !== 400) fail("C1: termos obrigatórios devem falhar");

      const accept = await jsonRequest(server, {
        method: "POST",
        path: "/api/legal/acceptances",
        token,
        body: { privacyAcknowledged: true, termsAccepted: true, marketingConsent: false },
      });
      if (accept.status !== 200) fail(`C1 accept ${accept.status} ${JSON.stringify(accept.json)}`);
      if (accept.json.legal.marketing.consent !== false) fail("C7: marketing deve permanecer false");
      if (accept.json.gate.needsLegal) fail("C1: legal deveria estar ok");
      if (!accept.json.gate.needsTour) fail("C1: deveria precisar de tour");

      const start = await jsonRequest(server, { method: "POST", path: "/api/me/onboarding/start", token });
      if (start.status !== 200) fail("C1 start falhou");
      if (!start.json.tour.shown) fail("C1: shown deve ser true");

      const start2 = await jsonRequest(server, { method: "POST", path: "/api/me/onboarding/start", token });
      if (start2.status !== 200) fail("C1 start idempotente falhou");

      const complete = await jsonRequest(server, { method: "POST", path: "/api/me/onboarding/complete", token });
      if (complete.status !== 200) fail("C1 complete falhou");
      if (!complete.json.tour.completed) fail("C1: completed");
      if (complete.json.tour.version !== CURRENT_ONBOARDING_VERSION) fail("C1 version");

      const after = await jsonRequest(server, { method: "GET", path: "/api/me/onboarding", token });
      if (after.json.gate.needsTour || after.json.gate.needsLegal) fail("C1: gate deveria estar ready");
      if (!after.json.gate.ready) fail("C1: ready");
    }

    // --- CENÁRIO 2 / 3 / 4: já viu tour → dashboard (sem auto tour), independente de cookies ---
    {
      const token = tokenFor(
        { id: userShown, email: emailShown, full_name: "Shown User", role: "admin", platform_admin: false },
        tenantRowA
      );
      // Aceita legal para isolar o teste do tour
      await jsonRequest(server, {
        method: "POST",
        path: "/api/legal/acceptances",
        token,
        body: { privacyAcknowledged: true, termsAccepted: true, marketingConsent: false },
      });
      const state = await jsonRequest(server, { method: "GET", path: "/api/me/onboarding", token });
      if (state.json.tour.shouldAutoStart) fail("C2/C3/C4: não deve autoiniciar tour");
      if (state.json.gate.needsTour) fail("C2: needsTour false");
    }

    // --- CENÁRIO 5: pulou tour ---
    {
      const token = tokenFor(
        { id: userSkipped, email: emailSkipped, full_name: "Skipped User", role: "admin", platform_admin: false },
        tenantRowA
      );
      await jsonRequest(server, {
        method: "POST",
        path: "/api/legal/acceptances",
        token,
        body: { privacyAcknowledged: true, termsAccepted: true },
      });
      const state = await jsonRequest(server, { method: "GET", path: "/api/me/onboarding", token });
      if (state.json.tour.shouldAutoStart) fail("C5: skip não deve reabrir tour automático");
      if (!state.json.tour.skipped) fail("C5: skipped flag");
    }

    // --- CENÁRIO 6: rever tour (manual) não apaga histórico ---
    {
      const token = tokenFor(
        { id: userShown, email: emailShown, full_name: "Shown User", role: "admin", platform_admin: false },
        tenantRowA
      );
      const before = await pool.query(
        `SELECT onboarding_shown_at, onboarding_completed_at, onboarding_skipped_at FROM users WHERE id = $1`,
        [userShown]
      );
      // start idempotente não limpa shown
      await jsonRequest(server, { method: "POST", path: "/api/me/onboarding/start", token });
      const after = await pool.query(
        `SELECT onboarding_shown_at, onboarding_completed_at, onboarding_skipped_at FROM users WHERE id = $1`,
        [userShown]
      );
      if (String(before.rows[0].onboarding_shown_at) !== String(after.rows[0].onboarding_shown_at)) {
        fail("C6: shown_at não deve mudar em replay");
      }
    }

    // --- CENÁRIO 8: revogar marketing ---
    {
      const token = tokenFor(
        { id: userNew, email: emailNew, full_name: "New User", role: "admin", platform_admin: false },
        tenantRowA
      );
      const grant = await jsonRequest(server, {
        method: "POST",
        path: "/api/me/consents",
        token,
        body: { marketing: true },
      });
      if (grant.status !== 200 || grant.json.marketing.consent !== true) fail("C8 grant");
      const revoke = await jsonRequest(server, {
        method: "POST",
        path: "/api/me/consents/revoke",
        token,
      });
      if (revoke.status !== 200 || revoke.json.marketing.consent !== false) fail("C8 revoke");

      const audits = await pool.query(
        `SELECT action FROM audit_events
         WHERE actor_id = $1 AND action IN ('MARKETING_CONSENT_GRANTED','MARKETING_CONSENT_REVOKED')
         ORDER BY occurred_at`,
        [userNew]
      );
      const actions = audits.rows.map((r) => r.action);
      if (!actions.includes("MARKETING_CONSENT_GRANTED") || !actions.includes("MARKETING_CONSENT_REVOKED")) {
        fail(`C8 audit ${actions.join(",")}`);
      }
    }

    // --- CENÁRIO 9: nova versão obrigatória de termos ---
    {
      await pool.query(
        `UPDATE legal_documents SET is_active = false WHERE document_type = 'TERMS_OF_USE'`
      );
      await pool.query(
        `INSERT INTO legal_documents (
           document_type, version, title, content, is_active,
           requires_acknowledgement, requires_acceptance, legal_basis
         ) VALUES (
           'TERMS_OF_USE', '2.0', 'Termos de Uso 2.0', 'Conteúdo v2', true,
           false, true, 'CONTRACT'
         )
         ON CONFLICT (document_type, version) DO UPDATE
         SET is_active = true, requires_acceptance = true`
      );
      // Desativa outras ativas de terms que não sejam 2.0
      await pool.query(
        `UPDATE legal_documents SET is_active = false
         WHERE document_type = 'TERMS_OF_USE' AND version <> '2.0'`
      );

      const token = tokenFor(
        { id: userNew, email: emailNew, full_name: "New User", role: "admin", platform_admin: false },
        tenantRowA
      );
      const state = await jsonRequest(server, { method: "GET", path: "/api/me/onboarding", token });
      if (!state.json.legal.terms.pending) fail("C9: termos 2.0 devem ficar pendentes");
      if (!state.json.gate.needsLegal) fail("C9: needsLegal");

      // restaura 1.0 ativa para não poluir ambiente
      await pool.query(
        `UPDATE legal_documents SET is_active = false WHERE document_type = 'TERMS_OF_USE' AND version = '2.0'`
      );
      await pool.query(
        `UPDATE legal_documents SET is_active = true WHERE document_type = 'TERMS_OF_USE' AND version = '1.0'`
      );
    }

    // --- CENÁRIO 10: isolamento tenant ---
    {
      const tokenA = tokenFor(
        { id: userNew, email: emailNew, full_name: "New User", role: "admin", platform_admin: false },
        tenantRowA
      );
      const tokenB = tokenFor(
        { id: userB, email: emailB, full_name: "Tenant B", role: "admin", platform_admin: false },
        tenantRowB
      );
      await jsonRequest(server, {
        method: "POST",
        path: "/api/legal/acceptances",
        token: tokenA,
        body: { privacyAcknowledged: true, termsAccepted: true, marketingConsent: true },
      });
      const listA = await jsonRequest(server, { method: "GET", path: "/api/legal/acceptances", token: tokenA });
      const listB = await jsonRequest(server, { method: "GET", path: "/api/legal/acceptances", token: tokenB });
      if (listA.status !== 200 || listB.status !== 200) fail("C10 list status");
      const leak = (listB.json || []).some((row) => row.user_id === userNew || row.group_id === groupA);
      if (leak) fail("C10: tenant B viu aceites do tenant A");
      const own = (listA.json || []).some((row) => row.group_id === groupA && row.user_id === userNew);
      if (!own) fail("C10: tenant A deveria ver próprios aceites");
    }

    console.log("firstAccess ok: legal, tour once, skip, replay, marketing, version, tenant isolation");
  } finally {
    server.close();
    try {
      await pool.query(
        `DELETE FROM privacy_requests WHERE user_id = ANY($1::uuid[])`,
        [[userNew, userShown, userSkipped, userB]]
      );
      await pool.query(
        `DELETE FROM legal_acceptances WHERE user_id = ANY($1::uuid[])`,
        [[userNew, userShown, userSkipped, userB]]
      );
      await pool.query(`DELETE FROM tenant_users WHERE group_id = ANY($1::text[])`, [[groupA, groupB]]);
      // Não apagar groups/tenants/users com trilha em audit_events (append-only + FK).
      await pool.query(
        `UPDATE users SET status = 'disabled', email = email || '.retired.' || id::text
         WHERE id = ANY($1::uuid[])`,
        [[userNew, userShown, userSkipped, userB]]
      );
      await pool.query(
        `DELETE FROM legal_documents WHERE document_type = 'TERMS_OF_USE' AND version = '2.0'`
      );
    } catch (cleanupError) {
      console.warn("cleanup parcial:", cleanupError.message);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
