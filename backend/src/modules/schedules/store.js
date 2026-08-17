import { pool } from "../../db/pool.js";
import { taskMeta } from "./tasks.js";

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
    intervaloMinutos: row.intervalo_minutos,
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
  const result = await pool.query(
    `SELECT * FROM scheduled_jobs ORDER BY created_date DESC`
  );
  return result.rows.map(toPublic);
}

export async function findById(id) {
  const result = await pool.query(`SELECT * FROM scheduled_jobs WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function findByTarefa(tarefa) {
  const result = await pool.query(`SELECT * FROM scheduled_jobs WHERE tarefa = $1`, [tarefa]);
  return result.rows[0] || null;
}

export async function create(row) {
  try {
    const result = await pool.query(
      `INSERT INTO scheduled_jobs (
         id, nome, tarefa, intervalo_minutos, ativo, proxima_execucao_em, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        row.id,
        row.nome,
        row.tarefa,
        row.intervaloMinutos,
        row.ativo,
        row.proximaExecucaoEm,
        row.createdBy,
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
  try {
    const result = await pool.query(
      `UPDATE scheduled_jobs SET
         nome = COALESCE($2, nome),
         tarefa = COALESCE($3, tarefa),
         intervalo_minutos = COALESCE($4, intervalo_minutos),
         ativo = COALESCE($5, ativo),
         proxima_execucao_em = COALESCE($6, proxima_execucao_em),
         updated_date = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.nome ?? null,
        patch.tarefa ?? null,
        patch.intervaloMinutos ?? null,
        patch.ativo ?? null,
        patch.proximaExecucaoEm ?? null,
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

export async function remove(id) {
  const result = await pool.query(
    `DELETE FROM scheduled_jobs WHERE id = $1 RETURNING *`,
    [id]
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

export async function finishRun(id, { ok, message, intervaloMinutos }) {
  const minutes = Math.max(Number(intervaloMinutos) || 1, 1);
  const result = await pool.query(
    `UPDATE scheduled_jobs SET
       executando = FALSE,
       ultima_execucao_em = now(),
       ultima_execucao_ok = $2,
       ultima_mensagem = $3,
       proxima_execucao_em = now() + ($4::int * interval '1 minute'),
       updated_date = now()
     WHERE id = $1
     RETURNING *`,
    [id, ok, message ?? null, minutes]
  );
  return result.rows[0];
}

export async function insertRun(row) {
  await pool.query(
    `INSERT INTO scheduled_job_runs (job_id, tarefa, origem, ok, mensagem, detalhes, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.jobId || null,
      row.tarefa,
      row.origem,
      row.ok,
      row.mensagem ?? null,
      row.detalhes ? JSON.stringify(row.detalhes) : null,
      row.startedAt,
      row.finishedAt,
    ]
  );
}

export async function listRuns(jobId, limit = 10) {
  const result = await pool.query(
    `SELECT * FROM scheduled_job_runs
     WHERE job_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
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
