import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { runWithTenant } from "../tenants/access.js";
import * as service from "./service.js";
import { encryptSecret } from "./crypto.js";

// C3: numa conexão salva (com `code`), o host chamado é SEMPRE o host salvo —
// um baseUrl malicioso no corpo é ignorado, e a credencial salva só vai ao host
// salvo. Teste de integração contra o banco (grupo descartável, limpo no fim).

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

async function main() {
  const suffix = `${Date.now()}`;
  const groupId = `grp_c3_${suffix}`;
  const integrationId = randomUUID();
  const code = `INT-C3-${suffix}`;
  const savedBaseUrl = "https://erp-salvo.exemplo.com";
  const savedSecret = "credencial-super-secreta";

  await pool.query("BEGIN");
  try {
    await pool.query(`INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'C3','ativo','teste')`, [groupId]);
    await pool.query(
      `INSERT INTO integrations (id, code, nome, base_url, auth_type, credential_encrypted, timeout_seconds, status, created_by, group_id)
       VALUES ($1,$2,'Conexão C3',$3,'bearer',$4,30,'ativo','teste',$5)`,
      [integrationId, code, savedBaseUrl, encryptSecret(savedSecret), groupId]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  try {
    const captured = {};
    const probe = async (params) => {
      captured.baseUrl = params.baseUrl;
      captured.credential = params.credential;
      return { ok: true, reached: true, statusCode: 200, message: "ok" };
    };

    await runWithTenant(
      { groupId, tenantId: `tnt_c3_${suffix}`, email: "c3@test.local", role: "admin", tenantRole: "OWNER" },
      () => service.testConnection(
        { code, baseUrl: "http://169.254.169.254", path: "/rest/x" },
        { probe }
      )
    );

    check(captured.baseUrl === savedBaseUrl, `host chamado deve ser o salvo (veio ${captured.baseUrl})`);
    check(captured.baseUrl !== "http://169.254.169.254", "baseUrl malicioso do corpo foi ignorado");
    check(captured.credential === savedSecret, "credencial salva foi decifrada e usada (para o host salvo)");

    const ctx = { groupId, tenantId: `tnt_c3_${suffix}`, email: "c3@test.local", role: "admin", tenantRole: "OWNER" };
    const credOf = async () => {
      const r = await pool.query("SELECT credential_encrypted FROM integrations WHERE id = $1", [integrationId]);
      return r.rows[0]?.credential_encrypted ?? null;
    };

    // Sugestão 2: mudar só o caminho (mesma origem) PRESERVA a credencial.
    await runWithTenant(ctx, () => service.updateByCode(code, { baseUrl: `${savedBaseUrl}/api` }));
    check((await credOf()) !== null, "mudar só o caminho (mesma origem) preserva a credencial salva");

    // Sugestão 2: mudar a ORIGEM sem recredenciar APAGA a credencial salva.
    await runWithTenant(ctx, () => service.updateByCode(code, { baseUrl: "https://outro-host.exemplo.com" }));
    check((await credOf()) === null, "trocar a origem do baseUrl apaga a credencial salva (NULL)");
  } finally {
    await pool.query("DELETE FROM integrations WHERE id = $1", [integrationId]).catch(() => {});
    await pool.query("DELETE FROM groups WHERE id = $1", [groupId]).catch(() => {});
  }

  if (failures.length) {
    console.error(`C3 integrações: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log("C3 ok: com code, o host é o salvo e a credencial salva nunca vai para baseUrl do corpo");
  await pool.end();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
