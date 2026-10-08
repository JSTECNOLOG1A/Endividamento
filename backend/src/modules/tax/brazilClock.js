// Relógio civil de Brasília para a Gestão Tributária: "hoje" é a data do calendário em America/Sao_Paulo, nunca a
// data UTC do servidor. Datas civis são texto AAAA-MM-DD (ou AAAA-MM para mês), sem horário nem fuso.

const TIME_ZONE = "America/Sao_Paulo";

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function parts(now) {
  const read = (type) => PARTS.formatToParts(now).find((item) => item.type === type)?.value;
  return { year: read("year"), month: read("month"), day: read("day"), hour: Number(read("hour")) };
}

/** Data civil (AAAA-MM-DD) de Brasília no instante `now`. */
export function brazilDate(now = new Date()) {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hora (0–23) de Brasília no instante `now`. */
export function brazilHour(now = new Date()) {
  return parts(now).hour;
}

/** Data civil + dias (negativo volta), sem passar por fuso. */
export function addDays(civilDate, days) {
  const [y, m, d] = civilDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Mês (AAAA-MM) + meses. */
export function addMonths(month, count) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Último dia (AAAA-MM-DD) do mês AAAA-MM. */
export function lastDayOfMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Meses de `from` a `to` (AAAA-MM), inclusive. */
export function monthsBetween(from, to) {
  const out = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) out.push(month);
  return out;
}

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "outubro de 2026" para "2026-10". */
export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}
