import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { pool } from "../../db/pool.js";
import { config } from "../../config.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { runWithTenant } from "../tenants/access.js";
import * as schedStore from "../schedules/store.js";
import { executeTask } from "../schedules/service.js";
import { TASKS } from "../schedules/tasks.js";

// 3ª onda da auditoria de segurança — isolamento do master no DATA PLANE.
// A1: master sem sessão de suporte não alcança agendamentos (findById/update/listRuns)
//     nem EXECUTA tarefa (executeTask) sem escopo.
// A2: master só baixa anexo do grupo da sessão de suporte ativa, e com rastro —
//     inclusive quando a sessão vem pela QUERY (links <a href>/<iframe>, sem header).
// M1: ninguém baixa arquivo da raiz de uploads (anexo sem dono).
//
// Cada asserção abaixo vira VERMELHA se a guarda correspondente for removida
// (verificado por mutação, uma por vez):
//  - A1 findById: trocar groupIdOrThrow() pelo fallback "só por id" faz
//    master-sem-sessão enxergar o job.
//  - A1 update: tem guarda DUPLA (o findById no topo E o groupIdOrThrow da própria
//    query de UPDATE); cada uma barra sozinha, então só reverter AS DUAS deixa a
//    escrita cruzada passar — e aí a asserção "não alterou o job" grava "hack" no
//    job de A, provando a corrupção real. A asserção não é tautológica.
//  - A1 listRuns: trocar groupIdOrThrow() pelo fallback faz master-sem-sessão ler
//    as execuções.
//  - A1 executeTask: sem o groupIdOrThrow no topo de executeTask, o master sem
//    sessão roda a tarefa (run() é chamado) — a tarefa é stubada e o teste verifica
//    que run() NÃO foi chamado.
//  - A2 (verificado por mutação em app.js, reproduzido): reintroduzir a varredura
//    de todas as pastas faz master-sem-sessão baixar (200) e master em A alcançar B.
//  - M1 (verificado por mutação em app.js, reproduzido): reintroduzir o fallback de
//    raiz faz usuário comum e master-sem-sessão baixarem o legado (200).
//  - A2 via query: remover a fonte "query em /uploads" no tenant.js faz o download
//    por link (sem header de sessão) voltar a 404 para o master com sessão.

process.exitCode = 1;
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

async function expectStatus(fn) {
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

async function waitFor(fn, { tries = 40, delayMs = 50 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

function jsonRequest(server, { method, path: reqPath, body, token, headers = {} }) {
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
      path: reqPath,
      method,
      headers: reqHeaders,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = text; }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const suffix = `${Date.now()}`;
  const groupA = `grp_mdp_a_${suffix}`;
  const groupB = `grp_mdp_b_${suffix}`;
  const tenantA = `tnt_mdp_a_${suffix}`;
  const tenantB = `tnt_mdp_b_${suffix}`;
  const masterId = randomUUID();
  const adminA = randomUUID();
  const adminB = randomUUID();
  const emailMaster = `mdp-master-${suffix}@test.local`;
  const emailA = `mdp-a-${suffix}@test.local`;
  const emailB = `mdp-b-${suffix}@test.local`;
  const jobA = `AGD_mdp_a_${suffix}`;
  const password = "Endividamento!Test1";
  const hash = await bcrypt.hash(password, 4);

  const fileA = `a-${suffix}.pdf`;
  const fileB = `b-${suffix}.pdf`;
  const legacyFile = `legacy-${suffix}.pdf`;

  // uploadDir dedicado ao teste: o handler lê config.uploadDir em tempo de
  // requisição, então a troca abaixo basta (padrão dos testes de storage).
  const previousUploadDir = config.uploadDir;
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdp-uploads-"));
  config.uploadDir = uploadDir;
  fs.mkdirSync(path.join(uploadDir, groupA), { recursive: true });
  fs.mkdirSync(path.join(uploadDir, groupB), { recursive: true });
  fs.writeFileSync(path.join(uploadDir, groupA, fileA), `PDF-A-${suffix}`);
  fs.writeFileSync(path.join(uploadDir, groupB, fileB), `PDF-B-${suffix}`);
  // Arquivo "legado" direto na raiz (sem associação a cliente).
  fs.writeFileSync(path.join(uploadDir, legacyFile), `PDF-LEGACY-${suffix}`);

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'MDP A','ativo','teste'), ($2,'MDP B','ativo','teste')`,
      [groupA, groupB]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, lifecycle_status, owner_email, created_by, onboarding_completed_at)
       VALUES ($1,$2,'Tenant MDP A','STARTER','active','ACTIVE',$3,'teste', now()),
              ($4,$5,'Tenant MDP B','STARTER','active','ACTIVE',$6,'teste', now())`,
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
      [`tu_mdp_a_${suffix}`, tenantA, groupA, emailA, `tu_mdp_b_${suffix}`, tenantB, groupB, emailB]
    );
    await pool.query(
      `INSERT INTO scheduled_jobs (id, nome, tarefa, intervalo_minutos, modo, ativo, group_id, created_by)
       VALUES ($1,'Job A','integrar_titulos_pagar',60,'intervalo',TRUE,$2,'teste')`,
      [jobA, groupA]
    );
    await pool.query(
      `INSERT INTO scheduled_job_runs (job_id, tarefa, origem, ok, mensagem, started_at, finished_at, group_id)
       VALUES ($1,'integrar_titulos_pagar','manual',TRUE,'ok', now(), now(), $2)`,
      [jobA, groupA]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  const sMasterNone = { groupId: null, tenantId: null, email: emailMaster, role: "admin", tenantRole: "PLATFORM", platformAdmin: true };
  const sMasterA = { groupId: groupA, tenantId: tenantA, email: emailMaster, role: "admin", tenantRole: "PLATFORM", platformAdmin: true };
  const sMasterB = { groupId: groupB, tenantId: tenantB, email: emailMaster, role: "admin", tenantRole: "PLATFORM", platformAdmin: true };

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    // ===== A1 — schedules/store (data plane do agendamento) =====
    // Master SEM sessão de suporte: mesmo erro que já recebe em list().
    const findNone = await expectStatus(() => as(sMasterNone, () => schedStore.findById(jobA)));
    check(findNone.threw && findNone.status === 400 && findNone.code === "SUPPORT_SESSION_REQUIRED",
      `A1 findById master sem sessão → 400 SUPPORT_SESSION_REQUIRED: ${JSON.stringify(findNone)}`);

    const updNone = await expectStatus(() => as(sMasterNone, () => schedStore.update(jobA, { nome: "hack" })));
    check(updNone.threw && updNone.status === 400 && updNone.code === "SUPPORT_SESSION_REQUIRED",
      `A1 update master sem sessão → 400 SUPPORT_SESSION_REQUIRED: ${JSON.stringify(updNone)}`);

    const runsNone = await expectStatus(() => as(sMasterNone, () => schedStore.listRuns(jobA)));
    check(runsNone.threw && runsNone.status === 400 && runsNone.code === "SUPPORT_SESSION_REQUIRED",
      `A1 listRuns master sem sessão → 400 SUPPORT_SESSION_REQUIRED: ${JSON.stringify(runsNone)}`);

    // O job de A permaneceu intacto (o update sem sessão não gravou nada).
    const stillA = await pool.query(`SELECT nome FROM scheduled_jobs WHERE id = $1`, [jobA]);
    check(stillA.rows[0]?.nome === "Job A", `A1 update sem sessão não alterou o job: nome=${stillA.rows[0]?.nome}`);

    // Master COM sessão no grupo A (o que attachTenant produz com sessão ativa): alcança o job de A.
    const foundA = await as(sMasterA, () => schedStore.findById(jobA));
    check(foundA?.id === jobA, `A1 findById master atendendo A alcança o job de A: ${JSON.stringify(foundA?.id)}`);
    const listRunsA = await as(sMasterA, () => schedStore.listRuns(jobA));
    check(Array.isArray(listRunsA) && listRunsA.length >= 1, `A1 listRuns master atendendo A vê execuções: ${listRunsA?.length}`);
    const updatedA = await as(sMasterA, () => schedStore.update(jobA, { nome: "Job A (suporte)" }));
    check(updatedA?.nome === "Job A (suporte)", `A1 update master atendendo A grava: ${updatedA?.nome}`);

    // Master atendendo B NÃO enxerga o job de A (escopo restrito ao grupo da sessão).
    const crossFind = await as(sMasterB, () => schedStore.findById(jobA));
    check(crossFind === null, `A1 master atendendo B não enxerga o job de A: ${JSON.stringify(crossFind?.id)}`);

    // ===== A1 — executeTask não roda sem escopo (POST /run-task) =====
    // Tarefa de catálogo compartilhado (BACEN) não tem groupIdOrThrow interno: é a
    // que expõe o buraco. Stubamos o run() para não tocar a rede e para observar se
    // chegou a rodar. Sem o groupIdOrThrow no topo de executeTask, o master sem
    // sessão rodaria run() antes de falhar no registro.
    const realPtaxRun = TASKS.atualizar_ptax_bacen.run;
    try {
      let ranNoSession = false;
      TASKS.atualizar_ptax_bacen.run = async () => { ranNoSession = true; return { ok: true, message: "stub" }; };
      const execNone = await expectStatus(() => as(sMasterNone, () => executeTask("atualizar_ptax_bacen", "manual")));
      check(execNone.threw && execNone.code === "SUPPORT_SESSION_REQUIRED",
        `A1 executeTask master sem sessão → bloqueado: ${JSON.stringify(execNone)}`);
      check(ranNoSession === false, "A1 executeTask master sem sessão NÃO chegou a rodar a tarefa (sem efeito)");

      // Com escopo (grupo atendido) a tarefa roda normalmente.
      let ranScoped = false;
      TASKS.atualizar_ptax_bacen.run = async () => { ranScoped = true; return { ok: true, message: "stub" }; };
      const execScoped = await as(sMasterA, () => executeTask("atualizar_ptax_bacen", "manual"));
      check(ranScoped === true && execScoped?.ok === true, `A1 executeTask com escopo roda a tarefa: ${JSON.stringify(execScoped?.ok)}`);
    } finally {
      TASKS.atualizar_ptax_bacen.run = realPtaxRun;
    }

    // ===== A2 / M1 — download de anexos =====
    const tenantRowA = { id: tenantA, group_id: groupA, tenant_name: "Tenant MDP A" };
    const tenantRowB = { id: tenantB, group_id: groupB, tenant_name: "Tenant MDP B" };
    const masterToken = issueAuthResponse(
      { id: masterId, email: emailMaster, full_name: "Platform Master", role: "admin", platform_admin: true },
      null
    ).token;
    const tokenA = issueAuthResponse(
      { id: adminA, email: emailA, full_name: "Admin A", role: "admin", platform_admin: false },
      tenantRowA
    ).token;
    const tokenB = issueAuthResponse(
      { id: adminB, email: emailB, full_name: "Admin B", role: "admin", platform_admin: false },
      tenantRowB
    ).token;

    // Usuário comum A baixa o próprio anexo.
    const ownFile = await jsonRequest(server, { method: "GET", path: `/uploads/${fileA}`, token: tokenA });
    check(ownFile.status === 200 && ownFile.text.includes(`PDF-A-${suffix}`), `usuário A baixa o próprio anexo: ${ownFile.status}`);

    // M1 — usuário comum NÃO baixa arquivo da raiz (anexo sem dono).
    const legacyByUser = await jsonRequest(server, { method: "GET", path: `/uploads/${legacyFile}`, token: tokenA });
    check(legacyByUser.status === 404, `M1 usuário comum não baixa arquivo de raiz: ${legacyByUser.status}`);

    // Usuário comum A NÃO baixa anexo de outro grupo.
    const crossByUser = await jsonRequest(server, { method: "GET", path: `/uploads/${fileB}`, token: tokenA });
    check(crossByUser.status === 404, `usuário A não baixa anexo do grupo B: ${crossByUser.status}`);
    void tokenB;

    // A2 — master SEM sessão de suporte não baixa anexo de cliente nenhum.
    const masterNoSession = await jsonRequest(server, { method: "GET", path: `/uploads/${fileA}`, token: masterToken });
    check(masterNoSession.status === 404, `A2 master sem sessão não baixa anexo de cliente: ${masterNoSession.status}`);
    // E também não baixa da raiz.
    const masterRoot = await jsonRequest(server, { method: "GET", path: `/uploads/${legacyFile}`, token: masterToken });
    check(masterRoot.status === 404, `A2/M1 master sem sessão não baixa arquivo de raiz: ${masterRoot.status}`);

    // Abre sessão de suporte real no tenant A (step-up + support-session, como na tela).
    const stepUp = await jsonRequest(server, { method: "POST", path: "/api/platform/step-up", token: masterToken, body: { password } });
    check(stepUp.status === 200, `step-up do master: ${stepUp.status} ${JSON.stringify(stepUp.json)}`);
    const support = await jsonRequest(server, {
      method: "POST",
      path: `/api/platform/tenants/${tenantA}/support-session`,
      token: masterToken,
      body: { reason: "Auditoria da terceira onda de segurança", duration_minutes: 15 },
    });
    check(support.status === 201 && support.json?.id, `abertura da sessão de suporte: ${support.status} ${JSON.stringify(support.json)}`);
    const sessionId = support.json?.id;
    const supportHeaders = { "x-support-session-id": sessionId, "x-tenant-id": tenantA };

    // A2 — master COM sessão baixa o anexo do grupo atendido E gera rastro.
    const masterWithSession = await jsonRequest(server, { method: "GET", path: `/uploads/${fileA}`, token: masterToken, headers: supportHeaders });
    check(masterWithSession.status === 200 && masterWithSession.text.includes(`PDF-A-${suffix}`),
      `A2 master com sessão baixa anexo do grupo atendido: ${masterWithSession.status}`);

    const logged = await waitFor(async () => {
      const r = await pool.query(
        `SELECT 1 FROM platform_access_log
         WHERE action = 'TENANT_FILE_READ' AND group_id = $1 AND support_session_id = $2::uuid AND actor_id = $3`,
        [groupA, sessionId, masterId]
      );
      return r.rows[0] || null;
    });
    check(Boolean(logged), "A2 leitura de anexo pelo master gerou registro de acesso (TENANT_FILE_READ)");

    // A2 — master com sessão em A NÃO alcança anexo do grupo B.
    const masterCrossGroup = await jsonRequest(server, { method: "GET", path: `/uploads/${fileB}`, token: masterToken, headers: supportHeaders });
    check(masterCrossGroup.status === 404, `A2 master com sessão em A não baixa anexo de B: ${masterCrossGroup.status}`);

    // A2 (regressão corrigida) — download por LINK: a sessão vem na QUERY STRING
    // (sem header, como <a href>/<iframe src>), junto do ?token=. Só vale em /uploads.
    const countFileReads = async () => {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM platform_access_log
         WHERE action = 'TENANT_FILE_READ' AND group_id = $1 AND support_session_id = $2::uuid AND actor_id = $3`,
        [groupA, sessionId, masterId]
      );
      return r.rows[0].n;
    };
    const beforeQueryRead = await countFileReads();
    const viaQuery = await jsonRequest(server, {
      method: "GET",
      path: `/uploads/${fileA}?token=${encodeURIComponent(masterToken)}&support_session_id=${encodeURIComponent(sessionId)}`,
    });
    check(viaQuery.status === 200 && viaQuery.text.includes(`PDF-A-${suffix}`),
      `A2 master baixa anexo com sessão pela query (link): ${viaQuery.status}`);
    const grewLog = await waitFor(async () => (await countFileReads()) > beforeQueryRead);
    check(Boolean(grewLog), "A2 download por link (sessão na query) também gera registro de acesso");

    // E sem sessão na query, o link continua 404 (só token, sem support_session_id).
    const viaQueryNoSession = await jsonRequest(server, {
      method: "GET",
      path: `/uploads/${fileA}?token=${encodeURIComponent(masterToken)}`,
    });
    check(viaQueryNoSession.status === 404, `A2 link do master sem sessão na query → 404: ${viaQueryNoSession.status}`);
  } finally {
    server.close();
    try {
      await pool.query(`DELETE FROM platform_access_log WHERE group_id = ANY($1::text[])`, [[groupA, groupB]]);
      await pool.query(`UPDATE support_sessions SET status = 'ended', ended_at = now() WHERE master_user_id = $1`, [masterId]);
      await pool.query(`DELETE FROM support_sessions WHERE master_user_id = $1`, [masterId]);
      await pool.query(`DELETE FROM scheduled_job_runs WHERE group_id = ANY($1::text[])`, [[groupA, groupB]]);
      await pool.query(`DELETE FROM scheduled_jobs WHERE group_id = ANY($1::text[])`, [[groupA, groupB]]);
      await pool.query(`DELETE FROM tenant_users WHERE group_id = ANY($1::text[])`, [[groupA, groupB]]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[masterId, adminA, adminB]]);
      await pool.query(`DELETE FROM tenants WHERE id = ANY($1::text[])`, [[tenantA, tenantB]]);
      // audit_events.group_id tem ON DELETE SET NULL; os eventos de suporte ficam como resíduo.
      await pool.query(`DELETE FROM groups WHERE id = ANY($1::text[])`, [[groupA, groupB]]).catch(() => {});
    } catch (cleanupError) {
      console.warn("cleanup:", cleanupError.message);
    }
    config.uploadDir = previousUploadDir;
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`master data-plane: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log("master data-plane ok: A1 agendamentos, A2 anexos com sessão+rastro, M1 raiz bloqueada");
  await pool.end();
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  for (const message of failures) console.error(` - ${message}`);
  pool.end().finally(() => process.exit(1));
});
