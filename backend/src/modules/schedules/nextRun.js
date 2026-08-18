const TIME_ZONE = "America/Sao_Paulo";
const DEFAULT_HORA = "00:10";

function saoPauloParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseHoraExecucao(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { hour: value.getUTCHours(), minute: value.getUTCMinutes() };
  }
  const text = String(value || DEFAULT_HORA);
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return { hour: 0, minute: 10 };
  return {
    hour: Math.min(23, Math.max(0, Number(match[1]))),
    minute: Math.min(59, Math.max(0, Number(match[2]))),
  };
}

export function formatHoraExecucao(value) {
  const { hour, minute } = parseHoraExecucao(value);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function wallTimeInSaoPaulo(year, month, day, hour, minute) {
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mi = String(minute).padStart(2, "0");
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00-03:00`);
}

function monthlyOccurrence(year, month, diaMes, hour, minute) {
  const day = Math.min(Number(diaMes) || 1, lastDayOfMonth(year, month));
  return wallTimeInSaoPaulo(year, month, day, hour, minute);
}

export function scheduleOf(job = {}) {
  return {
    modo: job.modo || "intervalo",
    diaMes: job.dia_mes ?? job.diaMes ?? null,
    horaExecucao: job.hora_execucao ?? job.horaExecucao ?? DEFAULT_HORA,
    intervaloMinutos: job.intervalo_minutos ?? job.intervaloMinutos ?? 5,
    ativo: job.ativo,
  };
}

export function nextRunAt(job, from = new Date()) {
  const schedule = scheduleOf(job);
  if (schedule.modo === "mensal" && Number(schedule.diaMes) >= 1) {
    const { hour, minute } = parseHoraExecucao(schedule.horaExecucao);
    const now = saoPauloParts(from);
    const thisMonth = monthlyOccurrence(now.year, now.month, schedule.diaMes, hour, minute);
    if (thisMonth.getTime() > from.getTime()) return thisMonth;
    const nextYear = now.month === 12 ? now.year + 1 : now.year;
    const nextMonth = now.month === 12 ? 1 : now.month + 1;
    return monthlyOccurrence(nextYear, nextMonth, schedule.diaMes, hour, minute);
  }
  const minutes = Math.max(Number(schedule.intervaloMinutos) || 1, 1);
  return new Date(from.getTime() + minutes * 60_000);
}

export function initialRunAt(job) {
  const schedule = scheduleOf(job);
  if (schedule.ativo === false) return null;
  if (schedule.modo === "mensal") return nextRunAt(job, new Date());
  return new Date();
}
