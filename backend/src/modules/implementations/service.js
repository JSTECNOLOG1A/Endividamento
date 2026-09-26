import { pool } from "../../db/pool.js";
import { flattenTemplate, TOTAL_ACTIVITIES } from "./template.js";
import { runAutoCheck } from "./autoChecks.js";

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function isOverdue(activity) {
  if (activity.status === "concluida") return false;
  if (!activity.prazo) return false;
  const prazo = new Date(activity.prazo);
  return prazo.getTime() < Date.now();
}

// "atrasada" é só um rótulo de leitura — nunca sobrescreve o status
// persistido (segue a mesma regra já usada para "Expirada" nas propostas
// comerciais).
function withDisplayStatus(activity) {
  const displayStatus = isOverdue(activity) ? "atrasada" : activity.status;
  return { ...activity, display_status: displayStatus };
}

function computeProgress(activities) {
  const total = activities.length;
  const concluidas = activities.filter((a) => a.status === "concluida").length;
  const atrasadas = activities.filter((a) => isOverdue(a)).length;
  const pendentes = total - concluidas;
  const percentual = total > 0 ? Math.round((concluidas / total) * 100) : 0;
  return { total, concluidas, atrasadas, pendentes, percentual };
}

export async function listAvailableTenants() {
  const result = await pool.query(
    `SELECT t.id, t.tenant_name, t.group_id
     FROM tenants t
     WHERE NOT EXISTS (
       SELECT 1 FROM client_implementations ci
       WHERE ci.tenant_id = t.id AND ci.status = 'em_andamento'
     )
     ORDER BY t.tenant_name ASC`
  );
  return result.rows;
}

export async function list({ q, status } = {}) {
  const params = [];
  const conditions = [];
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    conditions.push(`lower(t.tenant_name) LIKE $${params.length}`);
  }
  if (status && String(status).trim()) {
    params.push(String(status).trim());
    conditions.push(`ci.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT
       ci.id, ci.tenant_id, ci.group_id, ci.status, ci.data_inicio, ci.previsao_conclusao,
       ci.concluida_em, ci.created_date, ci.updated_date,
       t.tenant_name,
       COUNT(a.id) AS total_atividades,
       COUNT(a.id) FILTER (WHERE a.status = 'concluida') AS atividades_concluidas,
       COUNT(a.id) FILTER (
         WHERE a.status <> 'concluida' AND a.prazo IS NOT NULL AND a.prazo < CURRENT_DATE
       ) AS atividades_atrasadas
     FROM client_implementations ci
     JOIN tenants t ON t.id = ci.tenant_id
     LEFT JOIN client_implementation_activities a ON a.implementation_id = ci.id
     ${where}
     GROUP BY ci.id, t.tenant_name
     ORDER BY ci.created_date DESC`,
    params
  );
  return result.rows.map((row) => {
    const total = Number(row.total_atividades) || 0;
    const concluidas = Number(row.atividades_concluidas) || 0;
    return {
      ...row,
      total_atividades: total,
      atividades_concluidas: concluidas,
      atividades_atrasadas: Number(row.atividades_atrasadas) || 0,
      percentual: total > 0 ? Math.round((concluidas / total) * 100) : 0,
    };
  });
}

async function loadImplementation(id) {
  const result = await pool.query(
    `SELECT ci.*, t.tenant_name, t.created_date AS tenant_created_date
     FROM client_implementations ci
     JOIN tenants t ON t.id = ci.tenant_id
     WHERE ci.id = $1`,
    [id]
  );
  if (!result.rows[0]) throw httpError(404, "Implantação não encontrada", "NOT_FOUND");
  return result.rows[0];
}

async function loadActivities(implementationId) {
  const result = await pool.query(
    `SELECT * FROM client_implementation_activities
     WHERE implementation_id = $1
     ORDER BY sort_order ASC`,
    [implementationId]
  );
  return result.rows;
}

async function loadHistory(activityIds) {
  if (!activityIds.length) return new Map();
  const result = await pool.query(
    `SELECT * FROM client_implementation_activity_history
     WHERE activity_id = ANY($1::uuid[])
     ORDER BY occurred_at DESC`,
    [activityIds]
  );
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.activity_id)) map.set(row.activity_id, []);
    map.get(row.activity_id).push(row);
  }
  return map;
}

async function writeHistory(activityId, eventType, previousValue, newValue, note, actor) {
  await pool.query(
    `INSERT INTO client_implementation_activity_history
       (activity_id, event_type, previous_value, new_value, note, actor)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [activityId, eventType, previousValue ?? null, newValue ?? null, note ?? null, actor ?? null]
  );
}

// Motor de detecção automática — roda a cada abertura do cronograma (pull),
// não em background. Nunca reverte uma conclusão já feita (manual ou
// automática); se a evidência de uma atividade concluída automaticamente
// desaparecer, apenas sinaliza needs_revalidation.
export async function recomputeAutomaticActivities(implementationId, tenantId, groupId, tenantCreatedDate) {
  const activities = await loadActivities(implementationId);
  const ctx = { tenantId, groupId, tenantCreatedDate };
  for (const activity of activities) {
    if (!activity.auto_check_key) continue;
    const signal = await runAutoCheck(activity.auto_check_key, ctx);
    if (signal) {
      if (activity.status !== "concluida") {
        await pool.query(
          `UPDATE client_implementation_activities
           SET status = 'concluida', completion_mode = 'automatica', data_conclusao = now(),
               completed_by = 'sistema', needs_revalidation = false, updated_date = now()
           WHERE id = $1`,
          [activity.id]
        );
        await writeHistory(activity.id, "concluida", activity.status, "concluida", "Detectado automaticamente", "sistema");
      } else if (activity.completion_mode === "automatica" && activity.needs_revalidation) {
        await pool.query(
          `UPDATE client_implementation_activities
           SET needs_revalidation = false, updated_date = now()
           WHERE id = $1`,
          [activity.id]
        );
      }
    } else if (
      activity.status === "concluida" &&
      activity.completion_mode === "automatica" &&
      !activity.needs_revalidation
    ) {
      await pool.query(
        `UPDATE client_implementation_activities
         SET needs_revalidation = true, updated_date = now()
         WHERE id = $1`,
        [activity.id]
      );
      await writeHistory(
        activity.id,
        "sinalizada_revalidacao",
        "concluida",
        "concluida",
        "A configuração que originou esta conclusão automática não foi mais encontrada — revise.",
        "sistema"
      );
    }
  }
}

export async function create(body, user) {
  const tenantId = String(body?.tenant_id || "").trim();
  if (!tenantId) throw httpError(400, "Selecione um cliente", "VALIDATION");
  const dataInicio = body?.data_inicio || null;
  if (!dataInicio) throw httpError(400, "Informe a data de início", "VALIDATION");

  const tenantResult = await pool.query("SELECT id, group_id FROM tenants WHERE id = $1", [tenantId]);
  const tenant = tenantResult.rows[0];
  if (!tenant) throw httpError(404, "Cliente não encontrado", "NOT_FOUND");

  const existing = await pool.query(
    "SELECT id FROM client_implementations WHERE tenant_id = $1 AND status = 'em_andamento' LIMIT 1",
    [tenantId]
  );
  if (existing.rows[0]) {
    throw httpError(409, "Este cliente já possui uma implantação em andamento", "ALREADY_EXISTS");
  }

  const created = await pool.query(
    `INSERT INTO client_implementations
       (tenant_id, group_id, data_inicio, previsao_conclusao, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     RETURNING *`,
    [tenantId, tenant.group_id, dataInicio, body?.previsao_conclusao || null, user?.email || null]
  );
  const implementation = created.rows[0];

  const rows = flattenTemplate();
  for (const row of rows) {
    await pool.query(
      `INSERT INTO client_implementation_activities
         (implementation_id, stage_code, stage_name, activity_code, activity_name, sort_order, auto_check_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [implementation.id, row.stageCode, row.stageName, row.activityCode, row.activityName, row.sortOrder, row.autoCheckKey]
    );
  }

  const tenantCreatedDate = (await pool.query("SELECT created_date FROM tenants WHERE id = $1", [tenantId])).rows[0].created_date;
  await recomputeAutomaticActivities(implementation.id, tenantId, tenant.group_id, tenantCreatedDate);

  return getDetail(implementation.id);
}

export async function getDetail(id, { skipRecompute = false } = {}) {
  const implementation = await loadImplementation(id);
  if (!skipRecompute && implementation.status === "em_andamento") {
    await recomputeAutomaticActivities(id, implementation.tenant_id, implementation.group_id, implementation.tenant_created_date);
  }
  const activities = await loadActivities(id);
  const historyMap = await loadHistory(activities.map((a) => a.id));
  const activitiesWithDisplay = activities.map((a) => ({
    ...withDisplayStatus(a),
    history: historyMap.get(a.id) || [],
  }));

  const stagesMap = new Map();
  for (const activity of activitiesWithDisplay) {
    if (!stagesMap.has(activity.stage_code)) {
      stagesMap.set(activity.stage_code, {
        stage_code: activity.stage_code,
        stage_name: activity.stage_name,
        activities: [],
      });
    }
    stagesMap.get(activity.stage_code).activities.push(activity);
  }
  const stages = Array.from(stagesMap.values()).map((stage) => ({
    ...stage,
    progress: computeProgress(stage.activities),
  }));

  const overall = computeProgress(activities);

  return {
    ...implementation,
    stages,
    progress: overall,
  };
}

export async function update(id, body, user) {
  const implementation = await loadImplementation(id);
  const fields = [];
  const values = [];
  let idx = 1;

  if (body?.previsao_conclusao !== undefined) {
    fields.push(`previsao_conclusao = $${idx++}`);
    values.push(body.previsao_conclusao || null);
  }
  if (body?.data_inicio) {
    fields.push(`data_inicio = $${idx++}`);
    values.push(body.data_inicio);
  }
  if (body?.status && ["em_andamento", "concluida", "cancelada"].includes(body.status)) {
    fields.push(`status = $${idx++}`);
    values.push(body.status);
    if (body.status === "concluida") {
      fields.push(`concluida_em = now()`);
    }
  }
  if (!fields.length) return getDetail(id);

  fields.push(`updated_date = now()`, `updated_by = $${idx++}`);
  values.push(user?.email || null);
  values.push(id);

  await pool.query(
    `UPDATE client_implementations SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
  return getDetail(id);
}

export async function updateActivity(implementationId, activityId, body, user) {
  await loadImplementation(implementationId);
  const current = await pool.query(
    `SELECT * FROM client_implementation_activities WHERE id = $1 AND implementation_id = $2`,
    [activityId, implementationId]
  );
  const activity = current.rows[0];
  if (!activity) throw httpError(404, "Atividade não encontrada", "NOT_FOUND");

  const actor = user?.email || null;
  const sets = [];
  const values = [];
  let idx = 1;

  if (body?.responsavel !== undefined) {
    sets.push(`responsavel = $${idx++}`);
    values.push(body.responsavel || null);
  }

  if (body?.prazo !== undefined && body.prazo !== activity.prazo) {
    sets.push(`prazo = $${idx++}`);
    values.push(body.prazo || null);
    await writeHistory(activityId, "prazo_alterado", activity.prazo, body.prazo || null, body.justificativa || null, actor);
  }

  if (body?.observacoes !== undefined && body.observacoes !== activity.observacoes) {
    sets.push(`observacoes = $${idx++}`);
    values.push(body.observacoes || null);
    await writeHistory(activityId, "observacao_atualizada", activity.observacoes, body.observacoes || null, null, actor);
  }

  if (body?.status && body.status !== activity.status) {
    if (body.status === "concluida") {
      sets.push(`status = $${idx++}`, `completion_mode = 'manual'`, `data_conclusao = now()`, `completed_by = $${idx++}`, `needs_revalidation = false`);
      values.push("concluida", actor);
      await writeHistory(activityId, "concluida", activity.status, "concluida", body.justificativa || null, actor);
    } else {
      // Reabertura (de concluída para não iniciada/em andamento) ou apenas
      // mudança de progresso manual — reabrir uma atividade concluída exige
      // justificativa.
      if (activity.status === "concluida" && !body.justificativa) {
        throw httpError(400, "Informe uma justificativa para reabrir a atividade", "VALIDATION");
      }
      const wasConcluded = activity.status === "concluida";
      sets.push(`status = $${idx++}`);
      values.push(body.status);
      if (wasConcluded) {
        sets.push(`completion_mode = NULL`, `data_conclusao = NULL`, `completed_by = NULL`, `needs_revalidation = false`);
        await writeHistory(activityId, "reaberta", "concluida", body.status, body.justificativa, actor);
      }
    }
  }

  if (!sets.length) return getDetail(implementationId, { skipRecompute: true });

  sets.push(`updated_date = now()`);
  values.push(activityId, implementationId);
  await pool.query(
    `UPDATE client_implementation_activities SET ${sets.join(", ")} WHERE id = $${idx} AND implementation_id = $${idx + 1}`,
    values
  );

  return getDetail(implementationId, { skipRecompute: true });
}

export { TOTAL_ACTIVITIES };
