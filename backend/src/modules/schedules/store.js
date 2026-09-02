import { pool } from "../../db/pool.js";
import { taskMeta } from "./tasks.js";
import { formatHoraExecucao } from "./nextRun.js";
import { getTenantScope, groupIdOrThrow, scopedGroupSql } from "../tenants/access.js";

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

export function toPublic(row) {
  if (!row) return null;
  const meta = taskMeta(row.tarefa);
  return {
    id: row.id,
    nome: row.nome,
    tarefa: row.tarefa,
    tarefaLabel: meta?.label || row.tarefa,
    rotina: meta?.rotina || "",
    modo: row.modo || "intervalo",
    intervaloMinutos: row.intervalo_minutos,
    diaMes: row.dia_mes ?? null,
    horaExecucao: formatHoraExecucao(row.hora_execucao),
    ativo: Boolean(row.ativo),
    executando: Boolean(row.executando),
    ultimaExecucaoEm: row.ultima_execucao_em,
    ultimaExecucaoOk: row.ultima_execucao_ok,
    ultimaMensagem: row.ultima_mensagem,
    proximaExecucaoEm: row.proxima_execucao_em,
    createdAt: row.created_date,
    updatedAt: row.updated_date,
    createdBy: row.created_by,
  };
}

export async function list() {
  const scope = scopedGroupSql("group_id");
  const result = await pool.query(
    `SELECT * FROM scheduled_jobs WHERE ${scope.sql} ORDER BY created_date DESC`,
    scope.params
  );
  return result.rows.map(toPublic);
}

export async function listRaw() {
  const result = await pool.query(`SELECT * FROM scheduled_jobs`);
  return result.rows;
}

export async function findById(id) {
  const groupId = getTenantScope()?.groupId;
  if (groupId) {
    const result = await pool.query(
      `SELECT * FROM scheduled_jobs WHERE id = $1 AND group_id = $2`,
      [id, groupId]
    );
    return result.rows[0] || null;
  }
  const result = await pool.query(`SELECT * FROM scheduled_jobs WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function findByTarefa(tarefa) {
  const result = await pool.query(
    `SELECT * FROM scheduled_jobs WHERE tarefa = $1 AND group_id = $2`,
    [tarefa, groupIdOrThrow()]
  );
  return result.rows[0] || null;
}

export async function create(row) {
  try {
    const result = await pool.query(
      `INSERT INTO scheduled_jobs (
         id, nome, tarefa, intervalo_minutos, modo, dia_mes, hora_execucao,
         ativo, proxima_execucao_em, created_by, group_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        row.id,
        row.nome,
        row.tarefa,
        row.intervaloMinutos,
        row.modo || "intervalo",
        row.diaMes ?? null,
        row.horaExecucao || null,
        row.ativo,
        row.proximaExecucaoEm,
        row.createdBy,
        groupIdOrThrow(),
      ]
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw httpError(409, "Já existe um agendamento para esta tarefa");
    }
    throw error;
  }
}

export async function update(id, patch) {
  const current = await findById(id);
  if (!current) throw httpError(404, "Agendamento não encontrado");
  const next = {
    nome: patch.nome ?? current.nome,
    tarefa: patch.tarefa ?? current.tarefa,
    intervaloMinutos: patch.intervaloMinutos ?? current.intervalo_minutos,
    modo: patch.modo ?? current.modo ?? "intervalo",
    diaMes: patch.diaMes === undefined ? current.dia_mes : patch.diaMes,
    horaExecucao: patch.horaExecucao === undefined ? current.hora_execucao : patch.horaExecucao,
    ativo: patch.ativo ?? current.ativo,
    proximaExecucaoEm: patch.proximaExecucaoEm === undefined ? current.proxima_execucao_em : patch.proximaExecucaoEm,
  };
  try {
    const groupId = getTenantScope()?.groupId;
    const params = [
      id,
      next.nome,
      next.tarefa,
      next.intervaloMinutos,
      next.modo,
      next.diaMes,
      next.horaExecucao,
      next.ativo,
      next.proximaExecucaoEm,
    ];
    const tenantSql = groupId ? "AND group_id = $10" : "";
    if (groupId) params.push(groupId);
    const result = await pool.query(
      `UPDATE scheduled_jobs SET
         nome = $2,
         tarefa = $3,
         intervalo_minutos = $4,
         modo = $5,
         dia_mes = $6,
         hora_execucao = $7,
         ativo = $8,
         proxima_execucao_em = $9,
         updated_date = now()
       WHERE id = $1 ${tenantSql}
       RETURNING *`,
      params
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw httpError(409, "Já existe um agendamento para esta tarefa");
    }
    throw error;
  }
}

export async function remove(id) {
  const result = await pool.query(
    `DELETE FROM scheduled_jobs WHERE id = $1 AND group_id = $2 RETURNING *`,
    [id, groupIdOrThrow()]
  );
  if (!result.rows[0]) throw httpError(404, "Agendamento não encontrado");
  return result.rows[0];
}

export async function claimDueJobs() {
  const result = await pool.query(
    `WITH due AS (
       SELECT id FROM scheduled_jobs
       WHERE ativo IS TRUE
         AND executando IS NOT TRUE
         AND (proxima_execucao_em IS NULL OR proxima_execucao_em <= now())
       ORDER BY proxima_execucao_em ASC NULLS FIRST
       FOR UPDATE SKIP LOCKED
     )
     UPDATE scheduled_jobs AS job
     SET executando = TRUE, updated_date = now()
     FROM due
     WHERE job.id = due.id
     RETURNING job.*`
  );
  return result.rows;
}

export async function releaseStuckJobs() {
  await pool.query(
    `UPDATE scheduled_jobs
     SET executando = FALSE, updated_date = now()
     WHERE executando IS TRUE`
  );
}

export async function finishRun(id, { ok, message, nextAt }) {
  const result = await pool.query(
    `UPDATE scheduled_jobs SET
       executando = FALSE,
       ultima_execucao_em = now(),
       ultima_execucao_ok = $2,
       ultima_mensagem = $3,
       proxima_execucao_em = $4,
       updated_date = now()
     WHERE id = $1
     RETURNING *`,
    [id, ok, message ?? null, nextAt ?? null]
  );
  return result.rows[0];
}

export async function insertRun(row) {
  await pool.query(
    `INSERT INTO scheduled_job_runs (job_id, tarefa, origem, ok, mensagem, detalhes, started_at, finished_at, group_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.jobId || null,
      row.tarefa,
      row.origem,
      row.ok,
      row.mensagem ?? null,
      row.detalhes ? JSON.stringify(row.detalhes) : null,
      row.startedAt,
      row.finishedAt,
      getTenantScope()?.groupId || row.groupId || null,
    ]
  );
}

export async function listRuns(jobId, limit = 10) {
  const groupId = getTenantScope()?.groupId;
  const result = groupId
    ? await pool.query(
      `SELECT * FROM scheduled_job_runs WHERE job_id = $1 AND group_id = $2 ORDER BY started_at DESC LIMIT $3`,
      [jobId, groupId, limit]
    )
    : await pool.query(
      `SELECT * FROM scheduled_job_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT $2`,
      [jobId, limit]
    );
  return result.rows.map((row) => ({
    id: row.id,
    origem: row.origem,
    ok: row.ok,
    mensagem: row.mensagem,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}
