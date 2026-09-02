// Feriados nacionais via BrasilAPI (brasilapi.com.br) — API pública, gratuita
// e sem autenticação, mantida pela comunidade brasileira. O BACEN não publica
// um endpoint aberto próprio de feriados nacionais/bancários (só feriados de
// Argentina/Uruguai/Paraguai, via SML, que não servem aqui); BrasilAPI é a
// fonte de fato mais usada no mercado brasileiro pra esse dado, e cobre
// exatamente o escopo já cadastrado manualmente hoje ("Feriados Nacionais").
function capitalizeWeekday(weekday) {
  const text = String(weekday || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function getHolidaysFromBrasilAPI(payload = {}) {
  const currentYear = new Date().getFullYear();
  const startYear = Number(payload.startYear) || currentYear;
  const endYear = Number(payload.endYear) || startYear;
  if (endYear < startYear) {
    const err = new Error("endYear deve ser maior ou igual a startYear");
    err.status = 400;
    throw err;
  }
  if (endYear - startYear > 20) {
    const err = new Error("Intervalo máximo de 20 anos por vez");
    err.status = 400;
    throw err;
  }

  const holidays = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const err = new Error(`BrasilAPI retornou ${response.status} para o ano ${year}`);
      err.status = 502;
      throw err;
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      const err = new Error("Resposta inesperada da BrasilAPI");
      err.status = 502;
      throw err;
    }
    for (const item of data) {
      if (!item.date || !item.name) continue;
      holidays.push({
        holiday_date: item.date,
        holiday_name: item.name,
        day_of_week: capitalizeWeekday(item.weekday),
      });
    }
  }

  return { success: true, count: holidays.length, holidays };
}
