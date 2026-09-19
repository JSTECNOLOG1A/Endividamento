// T0 — Prepara e valida a carga de feriados nacionais (2020–2033). NÃO grava em nenhum sistema.
// Fonte 1: BrasilAPI (a mesma que o importador do AllDebt usa). Fonte 2: cálculo independente (Páscoa + datas fixas).
import fs from "node:fs";

const FIRST = 2020, LAST = 2033;
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

function easter(y) { // Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

function computed(y) {
  const e = easter(y);
  const list = [
    [`${y}-01-01`, "Confraternização Universal"],
    [iso(addDays(e, -48)), "Carnaval (segunda-feira)"],
    [iso(addDays(e, -47)), "Carnaval (terça-feira)"],
    [iso(addDays(e, -2)), "Sexta-feira Santa"],
    [`${y}-04-21`, "Tiradentes"],
    [`${y}-05-01`, "Dia do Trabalho"],
    [iso(addDays(e, 60)), "Corpus Christi"],
    [`${y}-09-07`, "Independência do Brasil"],
    [`${y}-10-12`, "Nossa Senhora Aparecida"],
    [`${y}-11-02`, "Finados"],
    [`${y}-11-15`, "Proclamação da República"],
    [`${y}-12-25`, "Natal"],
  ];
  if (y >= 2024) list.push([`${y}-11-20`, "Consciência Negra (nacional desde a Lei 14.759/2023)"]);
  return list;
}

const api = new Map();
for (let y = FIRST; y <= LAST; y++) {
  const r = await fetch(`https://brasilapi.com.br/api/feriados/v1/${y}`);
  if (!r.ok) throw new Error(`BrasilAPI ${r.status} em ${y}`);
  for (const h of await r.json()) api.set(h.date, h.name);
}

const rows = [];
const report = { onlyComputed: [], onlyApi: [], nameDiff: [] };
for (let y = FIRST; y <= LAST; y++) {
  for (const [date, name] of computed(y)) {
    const dow = new Date(date + "T12:00:00Z").getUTCDay();
    rows.push({ holiday_date: date, holiday_name: name, day_of_week: ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"][dow], em_api: api.has(date) });
    if (!api.has(date)) report.onlyComputed.push(`${date} ${name}`);
  }
}
const computedSet = new Set(rows.map((r) => r.holiday_date));
for (const [d, n] of api) if (!computedSet.has(d) && !/Páscoa/i.test(n)) report.onlyApi.push(`${d} ${n}`);

rows.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
fs.writeFileSync("t0/feriados_nacionais_2020_2033.json", JSON.stringify(rows.map(({ em_api, ...r }) => r), null, 1));
fs.writeFileSync("t0/feriados_validacao.json", JSON.stringify({ total: rows.length, ...report }, null, 1));
console.log("feriados na carga:", rows.length);
console.log("só no cálculo independente (ausentes na BrasilAPI):", report.onlyComputed.length, report.onlyComputed.slice(0, 12));
console.log("só na BrasilAPI (fora do cálculo, exceto Páscoa):", report.onlyApi.length, report.onlyApi.slice(0, 12));
