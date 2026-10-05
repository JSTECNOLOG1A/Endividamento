// Datas da Gestão Tributária são datas civis (AAAA-MM-DD): o vencimento de um tributo é o dia do calendário,
// não um instante. Toda conta aqui é feita sobre os componentes da data, sem passar por fuso horário.

const DAY_MS = 86_400_000;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data civil de hoje em America/Sao_Paulo, no formato AAAA-MM-DD. */
export function todayInBrazil(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function parts(civil) {
  const match = CIVIL_DATE.exec(String(civil || ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toDayNumber(civil) {
  const p = parts(civil);
  return p ? Date.UTC(p.year, p.month - 1, p.day) / DAY_MS : null;
}

function fromParts(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isCivilDate(value) {
  const p = parts(value);
  if (!p) return false;
  const probe = new Date(Date.UTC(p.year, p.month - 1, p.day));
  return probe.getUTCFullYear() === p.year && probe.getUTCMonth() === p.month - 1 && probe.getUTCDate() === p.day;
}

/** Dias corridos de `from` até `to` (positivo quando `to` é depois). Null se alguma data for inválida. */
export function daysBetween(from, to) {
  const a = toDayNumber(from);
  const b = toDayNumber(to);
  if (a === null || b === null) return null;
  return b - a;
}

export function addDays(civil, days) {
  const n = toDayNumber(civil);
  if (n === null) return null;
  const date = new Date(n * DAY_MS + days * DAY_MS);
  return fromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Soma meses mantendo o dia de referência; em mês que não tem esse dia (ex.: 31 em abril, 30 em fevereiro),
 * usa o último dia do mês. O dia de referência não "encolhe" de um mês para o outro.
 */
export function addMonthsKeepingDay(civil, months, anchorDay) {
  const p = parts(civil);
  if (!p) return null;
  const index = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(anchorDay ?? p.day, daysInMonth(year, month));
  return fromParts(year, month, day);
}

/** dd/mm/aaaa a partir de AAAA-MM-DD, sem conversão de fuso. */
export function formatCivilDate(civil) {
  const p = parts(civil);
  if (!p) return "";
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`;
}
