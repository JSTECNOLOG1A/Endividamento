import { z } from "zod";
import { generateCode } from "../integrations/crypto.js";
import { writeAudit } from "../../middleware/audit.js";
import { snapshotForAudit } from "../audit/records.js";
import { TASKS, taskCatalog, taskMeta } from "./tasks.js";
import * as store from "./store.js";
import { initialRunAt, nextRunAt, formatHoraExecucao } from "./nextRun.js";
import { loadTenantByGroupId, runWithTenant } from "../tenants/access.js";

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

const TAREFA_ENUM = [
  "integrar_titulos_pagar",
  "integrar_titulos_receber",
  "consultar_titulos_pagar",
  "consultar_titulos_receber",
  "converter_titulos_pr_tx",
  "atualizar_ptax_bacen",
  "atualizar_indices_bacen",
  "fechamento_contabil_automatico",
];
const MODO_ENUM = ["intervalo", "mensal"];

function normalizeSchedule(data = {}) {
  const modo = data.modo || (data.diaMes ? "mensal" : "intervalo");
  if (modo === "mensal") {
    return {
      modo,
      intervaloMinutos: 1440,
      diaMes: Number(data.diaMes) || 1,
      horaExecucao: formatHoraExecucao(data.horaExecucao || "00:10"),
    };
  }
  return {
    modo: "intervalo",
    intervaloMinutos: Number(data.intervaloMinutos) || 5,
    diaMes: null,
    horaExecucao: null,
  };
}

export const createSchema = z.object({
  nome: z.string().trim().min(3).max(255),
  tarefa: z.enum(TAREFA_ENUM),
  modo: z.enum(MODO_ENUM).optional(),
  intervaloMinutos: z.coerce.number().int().min(1).max(1440).optional(),
  diaMes: z.union([z.coerce.number().int().min(1).max(31), z.null()]).optional(),
  horaExecucao: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
  ativo: z.boolean().optional().default(true),
}).superRefine((data, ctx) => {
  const modo = data.modo || (data.diaMes ? "mensal" : "intervalo");
  if (modo === "intervalo" && data.intervaloMinutos == null) {
    ctx.addIssue({ code: "custom", path: ["intervaloMinutos"], message: "Informe o intervalo" });
  }
  if (modo === "mensal" && data.diaMes == null) {
    ctx.addIssue({ code: "custom", path: ["diaMes"], message: "Informe o dia do mês" });
  }
});

export const updateSchema = z.object({
  nome: z.string().trim().min(3).max(255).optional(),
  tarefa: z.enum(TAREFA_ENUM).optional(),
  modo: z.enum(MODO_ENUM).optional(),
  intervaloMinutos: z.coerce.number().int().min(1).max(1440).optional(),
  diaMes: z.union([z.coerce.number().int().min(1).max(31), z.null()]).optional(),
  horaExecucao: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
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

const EXPORT_FORMAT = "alldebt.schedules";
const EXPORT_VERSION = 1;

function normalizeImportBundle(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.schedules)) return body.schedules;
  if (Array.isArray(body?.connections)) return body.connections;
  if (Array.isArray(body?.data)) return body.data;
  return null;
}

function toExportItem(job) {
  return {
    nome: job.nome,
    tarefa: job.tarefa,
    modo: job.modo || (job.diaMes ? "mensal" : "intervalo"),
    intervaloMinutos: job.intervaloMinutos,
    diaMes: job.diaMes ?? null,
    horaExecucao: job.horaExecucao ? String(job.horaExecucao).slice(0, 5) : null,
    ativo: job.ativo !== false,
  };
}

export async function exportAll() {
  const jobs = await store.list();
  const schedules = (Array.isArray(jobs) ? jobs : []).map(toExportItem);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    count: schedules.length,
    schedules,
  };
}

export async function importMany(body, createdBy) {
  const rawItems = normalizeImportBundle(body);
  if (!rawItems?.length) {
    throw httpError(400, "Arquivo inválido: esperado { schedules: [...] }");
  }

  const created = [];
  const updated = [];
  const errors = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const raw = rawItems[index] || {};
    const label = raw.nome || raw.tarefa || `item ${index + 1}`;
    try {
      const parsed = createSchema.parse({
        nome: raw.nome,
        tarefa: raw.tarefa,
        modo: raw.modo,
        intervaloMinutos: raw.intervaloMinutos,
        diaMes: raw.diaMes,
        horaExecucao: raw.horaExecucao,
        ativo: raw.ativo !== false,
      });

      const existing = await store.findByTarefa(parsed.tarefa);
      if (existing) {
        const row = await updateById(existing.id, parsed);
        updated.push({ id: row.id, nome: row.nome, tarefa: row.tarefa });
      } else {
        const row = await create(parsed, createdBy);
        created.push({ id: row.id, nome: row.nome, tarefa: row.tarefa });
      }
    } catch (error) {
      let message = error?.message || "Falha ao importar";
      if (error?.details && typeof error.details === "object") {
        message = Object.values(error.details)[0] || message;
      } else if (error?.name === "ZodError" && Array.isArray(error.issues)) {
        message = error.issues[0]?.message || message;
      }
      errors.push({ index, nome: label, message });
    }
  }

  if (!created.length && !updated.length) {
    throw httpError(400, errors[0]?.message || "Nenhum agendamento foi importado", { errors });
  }

  return {
    imported: created.length + updated.length,
    created: created.length,
    updated: updated.length,
    failed: errors.length,
    items: { created, updated },
    errors,
  };
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
  const schedule = normalizeSchedule(data);
  const row = await store.create({
    id: generateCode("AGD"),
    nome: data.nome,
    tarefa: data.tarefa,
    ...schedule,
    ativo: data.ativo !== false,
    proximaExecucaoEm: initialRunAt({ ...schedule, ativo: data.ativo !== false }),
    createdBy,
  });
  return store.toPublic(row);
}

export async function updateById(id, data) {
  const current = await store.findById(id);
  if (!current) throw httpError(404, "Agendamento não encontrado");
  const merged = {
    modo: data.modo ?? current.modo,
    intervaloMinutos: data.intervaloMinutos ?? current.intervalo_minutos,
    diaMes: data.diaMes === undefined ? current.dia_mes : data.diaMes,
    horaExecucao: data.horaExecucao === undefined ? current.hora_execucao : data.horaExecucao,
    ativo: data.ativo ?? current.ativo,
  };
  const schedule = normalizeSchedule(merged);
  const ativo = data.ativo ?? current.ativo;
  const patch = {
    nome: data.nome,
    tarefa: data.tarefa,
    ...schedule,
    ativo,
    proximaExecucaoEm: ativo === false ? null : initialRunAt({ ...schedule, ativo: true }),
  };
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

function nextAfterRun(job) {
  if (!job?.ativo) return null;
  return nextRunAt(job, new Date());
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
      nextAt: nextAfterRun(job),
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
  const snapshot = await snapshotForAudit({
    resourceType: meta.rotina === "Contas a receber" ? "ReceivableTitle" : "PayableTitle",
    result,
    fallbackLabel: meta.label || tarefa,
  });
  if (origem === "automatico") {
    await writeAudit({
      action: "RUN",
      resourceType: "ScheduledJob",
      resourceId: job?.id,
      rotina: meta.rotina || "Agendamento",
      registro: snapshot.registro,
      origem: "automatico",
      processingType: "automatico",
      after: snapshot.after,
    });
  }
  return {
    ok: Boolean(result.ok),
    message: result.message,
    tarefa,
    origem,
    detalhes: result.detalhes || null,
    resumo: snapshot.registro,
    titulos: snapshot.after.titulos,
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
      const tenant = await loadTenantByGroupId(job.group_id);
      const task = () => executeTask(job.tarefa, "automatico");
      results.push(
        tenant
          ? await runWithTenant({
            groupId: job.group_id,
            tenantId: tenant.id,
            email: "sistema",
            fullName: "Sistema",
          }, task)
          : await task()
      );
    } catch (error) {
      await store.finishRun(job.id, {
        ok: false,
        message: error.message || "Falha no agendamento",
        nextAt: nextAfterRun(job),
      });
      results.push({ ok: false, tarefa: job.tarefa, message: error.message });
    }
  }
  return results;
}

export async function refreshUpcomingRuns() {
  const jobs = await store.listRaw();
  for (const job of jobs) {
    if (!job.ativo || job.modo !== "mensal") continue;
    const nextAt = nextRunAt(job, new Date());
    await store.update(job.id, { proximaExecucaoEm: nextAt });
  }
}
