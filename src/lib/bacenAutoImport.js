// Calcula automaticamente o período de busca pro botão "Atualizar" das abas
// de indexadores (CDI, SELIC, PTAX, IPCA, INPC, IGP-M) — o usuário não
// escolhe mais data nenhuma: se já tem dado no banco, só cobre a janela
// recente (mesma lógica das tarefas agendadas em backend/src/modules/
// functions/bacen.js — 10 dias pra série diária, 45 pra mensal, cobre fins
// de semana/feriados e o mês corrente mesmo perto da virada); se a tabela
// está vazia, traz um histórico inicial razoável de uma vez.
export function computeBacenStartDate(lastKnownDate, { isMonthly = false, bootstrapYears } = {}) {
  const today = new Date();
  if (!lastKnownDate) {
    const years = bootstrapYears ?? (isMonthly ? 10 : 5);
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString().split("T")[0];
  }
  const d = new Date(today);
  d.setDate(d.getDate() - (isMonthly ? 45 : 10));
  return d.toISOString().split("T")[0];
}

export function todayIso() {
  return new Date().toISOString().split("T")[0];
}
