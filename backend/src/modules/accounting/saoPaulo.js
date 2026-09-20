// Datas no fuso de São Paulo. O servidor roda em UTC, mas os agendamentos (por exemplo o fechamento do último dia do
// mês às 22:00) e as cotações do BACEN seguem o horário de Brasília: às 22:00 de 30/09 em Brasília já é 01:00 de 01/10
// em UTC, e "o mês atual" pelo relógio do servidor seria outubro.
const TIME_ZONE = "America/Sao_Paulo";

/** Data de hoje (AAAA-MM-DD) em São Paulo. */
export function todayInSaoPaulo(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

/** Competência do momento (mês em São Paulo): { year, month, start, end }. */
export function competenciaEmSaoPaulo(now = new Date()) {
  const [year, month] = todayInSaoPaulo(now).split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { year, month, start, end };
}
