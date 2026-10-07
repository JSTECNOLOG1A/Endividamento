import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { TASK_KEYS } from "./tasks.js";

// Agendamentos pela API: toda tarefa do catálogo (tasks.js) pode ser agendada e executada na hora — inclusive as da
// Gestão Tributária — e tarefa fora do catálogo é recusada.

process.exitCode = 1;
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

function jsonRequest(server, { method, path, body, token }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const payload = body == null ? null : JSON.stringify(body);
    const req = httpRequest({
      hostname: "127.0.0.1", port, path, method,
      headers: {
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
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
  const groupId = `grp_sched_${suffix}`;
  const tenantId = `tnt_sched_${suffix}`;
  const user = { id: randomUUID(), email: `sched-owner-${suffix}@test.local` };
  await pool.query("BEGIN");
  try {
    await pool.query(`INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Agendamentos','ativo','teste')`, [groupId]);
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by) VALUES ($1,$2,'Agendamentos','STARTER','active',$3,'teste')`,
      [tenantId, groupId, user.email]
    );
    await pool.query(`INSERT INTO users (id, email, password_hash, full_name, role, status, created_by) VALUES ($1,$2,'x',$2,'admin','active','teste')`, [user.id, user.email]);
    await pool.query(
      `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,'OWNER',$5,'teste')`,
      [`tu_${user.id}`, tenantId, groupId, user.email, { tax: true }]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
  const token = issueAuthResponse(
    { id: user.id, email: user.email, full_name: user.email, role: "admin", platform_admin: false },
    { id: tenantId, group_id: groupId, tenant_name: "Teste", tenant_role: "OWNER", billing_status: "active", plan: "STARTER" }
  ).token;
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const call = (method, path, body) => jsonRequest(server, { method, path, body, token });

  try {
    const catalog = await call("GET", "/api/schedules/tasks");
    const keys = (catalog.json || []).map((task) => task.key);
    check(keys.join() === TASK_KEYS.join(), `catálogo da tela = tarefas cadastradas: ${keys.join()}`);
    for (const key of ["integrar_titulos_tributos", "consultar_titulos_tributos"]) {
      check(keys.includes(key), `catálogo traz ${key}`);
    }

    // Toda tarefa do catálogo pode ser agendada (inativa: o agendador do servidor não a executa durante o teste).
    for (const tarefa of TASK_KEYS) {
      const created = await call("POST", "/api/schedules", { nome: `Teste ${tarefa}`, tarefa, modo: "intervalo", intervaloMinutos: 60, ativo: false });
      check(created.status === 201 && created.json?.tarefa === tarefa, `agendar ${tarefa}: ${created.status} ${JSON.stringify(created.json?.details || created.json?.error)}`);
    }

    // Executar agora: as duas tarefas da Gestão Tributária e duas antigas.
    for (const tarefa of ["integrar_titulos_tributos", "consultar_titulos_tributos", "integrar_titulos_pagar", "integrar_titulos_receber"]) {
      const run = await call("POST", "/api/schedules/run-task", { tarefa });
      check(run.status === 200 && run.json?.tarefa === tarefa && typeof run.json?.message === "string", `executar agora ${tarefa}: ${run.status} ${JSON.stringify(run.json)?.slice(0, 200)}`);
    }

    const unknown = await call("POST", "/api/schedules/run-task", { tarefa: "tarefa_inexistente" });
    check(unknown.status === 400 && unknown.json?.code === "VALIDATION", `tarefa fora do catálogo recusada: ${unknown.status}`);
    const unknownCreate = await call("POST", "/api/schedules", { nome: "Inexistente", tarefa: "tarefa_inexistente", intervaloMinutos: 60 });
    check(unknownCreate.status === 400 && unknownCreate.json?.code === "VALIDATION", `agendar tarefa fora do catálogo recusado: ${unknownCreate.status}`);
  } finally {
    server.close();
    await pool.query(`DELETE FROM scheduled_job_runs WHERE group_id = $1 OR job_id IN (SELECT id FROM scheduled_jobs WHERE group_id = $1)`, [groupId]);
    await pool.query(`DELETE FROM scheduled_jobs WHERE group_id = $1`, [groupId]);
    await pool.query(`DELETE FROM tenant_users WHERE group_id = $1`, [groupId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    // A auditoria é só-inclusão: o grupo com eventos auditados fica como resíduo de teste.
    await pool.query(`DELETE FROM groups WHERE id = $1`, [groupId]).catch(() => {});
  }

  if (failures.length) {
    console.error(`agendamentos: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log("agendamentos ok: todas as tarefas do catálogo são aceitas, inclusive as da Gestão Tributária");
  await pool.end();
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  for (const message of failures) console.error(` - ${message}`);
  pool.end().finally(() => process.exit(1));
});
