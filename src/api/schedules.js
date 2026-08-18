import { apiRequest } from "./base44Client";

export const INTERVAL_OPTIONS = [
  { value: 1, label: "A cada 1 minuto" },
  { value: 2, label: "A cada 2 minutos" },
  { value: 5, label: "A cada 5 minutos" },
  { value: 10, label: "A cada 10 minutos" },
  { value: 15, label: "A cada 15 minutos" },
  { value: 30, label: "A cada 30 minutos" },
  { value: 60, label: "A cada 1 hora" },
  { value: 120, label: "A cada 2 horas" },
  { value: 360, label: "A cada 6 horas" },
  { value: 720, label: "A cada 12 horas" },
  { value: 1440, label: "A cada 24 horas" },
];

export const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1;
  return {
    value: day,
    label: day === 31 ? "Dia 31 (ou último dia do mês)" : `Dia ${day}`,
  };
});

export function intervalLabel(minutes) {
  const option = INTERVAL_OPTIONS.find((item) => item.value === Number(minutes));
  return option?.label || `A cada ${minutes} min`;
}

export function scheduleLabel(item) {
  if (item?.modo === "mensal" && item.diaMes) {
    const hora = String(item.horaExecucao || "00:10").slice(0, 5);
    return `Todo mês, dia ${item.diaMes}, às ${hora}`;
  }
  return intervalLabel(item?.intervaloMinutos);
}

export function payloadFromCatalogTask(task) {
  const mensal = task?.defaultModo === "mensal";
  return {
    nome: task.defaultNome || task.label,
    tarefa: task.key,
    modo: mensal ? "mensal" : "intervalo",
    intervaloMinutos: Number(task.defaultIntervaloMinutos) || (mensal ? 1440 : 60),
    diaMes: mensal ? Number(task.defaultDiaMes) || 1 : null,
    horaExecucao: mensal ? (task.defaultHoraExecucao || "00:10") : null,
    ativo: true,
  };
}

export function formFromCatalogTask(task, current = {}, previousTask = null) {
  const payload = payloadFromCatalogTask(task);
  const autoNome = !current.nome?.trim()
    || current.nome === previousTask?.defaultNome
    || current.nome === previousTask?.label;
  return {
    nome: autoNome ? payload.nome : current.nome,
    tarefa: payload.tarefa,
    modo: payload.modo,
    intervaloMinutos: payload.intervaloMinutos,
    diaMes: payload.diaMes || 1,
    horaExecucao: payload.horaExecucao || "00:10",
    ativo: current.ativo !== false,
  };
}

export const schedulesApi = {
  list() {
    return apiRequest("/schedules");
  },
  tasks() {
    return apiRequest("/schedules/tasks");
  },
  get(id) {
    return apiRequest(`/schedules/${id}`);
  },
  create(data) {
    return apiRequest("/schedules", { method: "POST", body: data });
  },
  update(id, data) {
    return apiRequest(`/schedules/${id}`, { method: "PUT", body: data });
  },
  updateStatus(id, ativo) {
    return apiRequest(`/schedules/${id}/status`, { method: "PATCH", body: { ativo } });
  },
  remove(id) {
    return apiRequest(`/schedules/${id}`, { method: "DELETE" });
  },
  run(id) {
    return apiRequest(`/schedules/${id}/run`, { method: "POST", body: {} });
  },
  runTask(tarefa) {
    return apiRequest("/schedules/run-task", { method: "POST", body: { tarefa } });
  },
};
