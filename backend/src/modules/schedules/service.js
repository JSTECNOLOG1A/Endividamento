import { z } from "zod";
import { generateCode } from "../integrations/crypto.js";
import { TASKS, taskCatalog, taskMeta } from "./tasks.js";
import * as store from "./store.js";

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

const TAREFA_ENUM = ["consultar_titulos_pagar", "consultar_titulos_receber"];

export const createSchema = z.object({
  nome: z.string().trim().min(3).max(255),
  tarefa: z.enum(TAREFA_ENUM),
  intervaloMinutos: z.coerce.number().int().min(1).max(1440),
  ativo: z.boolean().optional().default(true),
});

export const updateSchema = z.object({
  nome: z.string().trim().min(3).max(255).optional(),
  tarefa: z.enum(TAREFA_ENUM).optional(),
  intervaloMinutos: z.coerce.number().int().min(1).max(1440).optional(),
  ativo: z.boolean().optional(),
});

export const statusSchema = z.object({
  ativo: z.boolean(),
});

export const runTaskSchema = z.object({
  tarefa: z.enum(TAREFA_ENUM),
});

export function listTasks() {
  return taskCatalog();
}

export async function list() {
  return store.list();
}

export async function getById(id) {
  const row = await store.findById(id);
  if (!row) throw httpError(404, "Agendamento não encontrado");
  const runs = await store.listRuns(id, 10);
  return { ...store.toPublic(row), runs };
}

export async function create(data, createdBy) {
  const existing = await store.findByTarefa(data.tarefa);
  if (existing) throw httpError(409, "Já existe um agendamento para esta tarefa");
  const row = await store.create({
    id: generateCode("AGD"),
    nome: data.nome,
    tarefa: data.tarefa,
    intervaloMinutos: data.intervaloMinutos,
    ativo: data.ativo !== false,
    proximaExecucaoEm: data.ativo === false ? null : new Date(),
    createdBy,
  });
  return store.toPublic(row);
}

export async function updateById(id, data) {
  const current = await store.findById(id);
  if (!current) throw httpError(404, "Agendamento não encontrado");
  const patch = {
    nome: data.nome,
    tarefa: data.tarefa,
    intervaloMinutos: data.intervaloMinutos,
    ativo: data.ativo,
  };
  if (data.ativo === false) {
    patch.proximaExecucaoEm = null;
  } else if (data.ativo === true || data.intervaloMinutos) {
    patch.proximaExecucaoEm = new Date();
  }
  const row = await store.update(id, patch);
  return store.toPublic(row);
}

export async function updateStatusById(id, ativo) {
  return updateById(id, { ativo });
}

export async function removeById(id) {
  const row = await store.remove(id);
  return store.toPublic(row);
}

export async function executeTask(tarefa, origem = "manual") {
  const meta = taskMeta(tarefa);
  if (!meta) throw httpError(400, "Tarefa desconhecida");
  const startedAt = new Date();
  let result;
  try {
    result = await TASKS[tarefa].run();
  } catch (error) {
    result = { ok: false, message: error.message || "Falha ao executar a tarefa" };
  }
  const finishedAt = new Date();
  const job = await store.findByTarefa(tarefa);
  if (job) {
    await store.finishRun(job.id, {
      ok: Boolean(result.ok),
      message: result.message,
      intervaloMinutos: job.intervalo_minutos,
    });
  }
  await store.insertRun({
    jobId: job?.id || null,
    tarefa,
    origem,
    ok: Boolean(result.ok),
    mensagem: result.message,
    detalhes: result.detalhes || null,
    startedAt,
    finishedAt,
  });
  return {
    ok: Boolean(result.ok),
    message: result.message,
    tarefa,
    origem,
    detalhes: result.detalhes || null,
  };
}

export async function runJob(id, origem = "manual") {
  const job = await store.findById(id);
  if (!job) throw httpError(404, "Agendamento não encontrado");
  return executeTask(job.tarefa, origem);
}

export async function runDueJobs() {
  const due = await store.claimDueJobs();
  const results = [];
  for (const job of due) {
    try {
      results.push(await executeTask(job.tarefa, "automatico"));
    } catch (error) {
      await store.finishRun(job.id, {
        ok: false,
        message: error.message || "Falha no agendamento",
        intervaloMinutos: job.intervalo_minutos,
      });
      results.push({ ok: false, tarefa: job.tarefa, message: error.message });
    }
  }
  return results;
}
