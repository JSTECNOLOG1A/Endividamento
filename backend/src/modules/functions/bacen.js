import * as store from "../entities/store.js";

// Funções de acesso à API pública do Banco Central (BACEN) usadas tanto pelas
// funções sob demanda (/functions/getPTAXFromBACEN, /functions/getRatesFromBACEN
// — botão "Conciliar PTAX" e bloco "Importar automaticamente do BACEN") quanto
// pelas tarefas de Agendamento (atualizar_ptax_bacen, atualizar_indices_bacen),
// que chamam esse mesmo código periodicamente em background. Ficou centralizado
// aqui pra não duplicar a lógica de busca/parse em dois lugares que podem
// divergir com o tempo.

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatOlindaDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${date.getFullYear()}`;
}

function parseOlindaItem(item) {
  const raw = item.dataHoraCotacao || item.Data || "";
  return {
    rate_date: String(raw).slice(0, 10),
    ptax_rate: Number(item.cotacaoVenda ?? item.cotacaoCompra),
    source: "BCB_OLINDA",
    series_id: "BCB_PTAX_USD",
    fetched_at: new Date().toISOString(),
  };
}

export async function getPTAXFromBACEN(payload = {}) {
  const { targetDate, lag = 1 } = payload;
  if (!targetDate) {
    const err = new Error("targetDate é obrigatório (YYYY-MM-DD)");
    err.status = 400;
    throw err;
  }
  const searchDate = new Date(`${targetDate}T00:00:00`);
  searchDate.setDate(searchDate.getDate() - Number(lag || 0));
  const start = new Date(searchDate);
  start.setDate(start.getDate() - 10);
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${formatOlindaDate(start)}'` +
    `&@dataFinalCotacao='${formatOlindaDate(searchDate)}'` +
    `&$top=20&$format=json`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const err = new Error(`BACEN API retornou ${response.status}`);
    err.status = 502;
    throw err;
  }
  const data = await response.json();
  const values = Array.isArray(data.value) ? data.value : [];
  const searchStr = toIsoDate(searchDate);
  let foundRate = null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const parsed = parseOlindaItem(values[i]);
    if (parsed.rate_date && parsed.rate_date <= searchStr && Number.isFinite(parsed.ptax_rate)) {
      foundRate = parsed;
      break;
    }
  }
  if (!foundRate && values.length) {
    foundRate = {
      ...parseOlindaItem(values[values.length - 1]),
      source: "BCB_LAST_AVAILABLE",
      warning: `Taxa para ${searchStr} não disponível`,
    };
  }
  if (!foundRate) {
    const err = new Error("Nenhuma taxa PTAX disponível no BACEN");
    err.status = 404;
    throw err;
  }
  return { success: true, official: foundRate, targetDate, lag };
}

const BCB_DAILY_SERIES = { CDI: 12, SELIC: 11 };

function formatBCBDate(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

// Busca CDI ou SELIC direto do BACEN (Sistema Gerenciador de Séries
// Temporais — SGS, api.bcb.gov.br), a mesma fonte oficial já usada pra PTAX
// acima. Séries 12 (CDI) e 11 (SELIC) trazem a taxa DIÁRIA em % — o sistema
// guarda a taxa já anualizada em base 252 (mesmo campo/convenção que a
// importação manual por CSV usa), então converte aqui pra manter os dois
// caminhos consistentes entre si.
export async function getRatesFromBACEN(payload = {}) {
  const { rateType = "CDI", startDate, endDate } = payload;
  const seriesId = BCB_DAILY_SERIES[rateType];
  if (!seriesId) {
    const err = new Error(`rateType inválido: ${rateType} (use 'CDI' ou 'SELIC')`);
    err.status = 400;
    throw err;
  }
  if (!startDate || !endDate) {
    const err = new Error("startDate e endDate são obrigatórios (YYYY-MM-DD)");
    err.status = 400;
    throw err;
  }
  const start = formatBCBDate(new Date(`${startDate}T00:00:00`));
  const end = formatBCBDate(new Date(`${endDate}T00:00:00`));
  const url =
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesId}/dados` +
    `?formato=json&dataInicial=${start}&dataFinal=${end}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const err = new Error(`BACEN API retornou ${response.status}`);
    err.status = 502;
    throw err;
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    const err = new Error("Resposta inesperada da API do BACEN");
    err.status = 502;
    throw err;
  }
  const rates = data
    .map((item) => {
      const [dd, mm, yyyy] = String(item.data || "").split("/");
      const dailyRate = parseFloat(String(item.valor).replace(",", "."));
      if (!dd || !mm || !yyyy || !Number.isFinite(dailyRate)) return null;
      const dailyFactor = 1 + dailyRate / 100;
      const annualRate = (Math.pow(dailyFactor, 252) - 1) * 100;
      return {
        rate_date: `${yyyy}-${mm}-${dd}`,
        annual_rate: Math.round(annualRate * 100) / 100,
        daily_factor: parseFloat(dailyFactor.toFixed(9)),
        rate_type: rateType,
      };
    })
    .filter(Boolean);
  return { success: true, rate_type: rateType, count: rates.length, rates };
}

function todayIsoInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function isoDaysAgo(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() - days);
  return toIsoDate(d);
}

// Usada pela tarefa de Agendamento "atualizar_ptax_bacen": busca a cotação
// PTAX mais recente disponível (janela de 10 dias já embutida em
// getPTAXFromBACEN, cobre fins de semana/feriados) e grava/atualiza direto
// no cadastro de Moedas — o mesmo destino da importação manual por CSV
// (src/components/loan/PTAXImporter.jsx), pra o resto do sistema (inclusive
// o botão "Conciliar PTAX") continuar enxergando os dois caminhos como um só
// histórico.
export async function syncPtaxToCurrencies() {
  const today = todayIsoInSaoPaulo();
  const { official } = await getPTAXFromBACEN({ targetDate: today, lag: 0 });
  const existing = await store.filter("Currency", { currency_code: "USD", rate_date: official.rate_date }, "-rate_date", 1);
  const entry = {
    currency_code: "USD",
    currency_name: "Dólar Americano",
    exchange_rate: official.ptax_rate,
    rate_date: official.rate_date,
    status: "ativa",
  };
  if (existing?.[0]) {
    await store.update("Currency", existing[0].id, entry);
    return { ok: true, action: "updated", rate_date: official.rate_date, exchange_rate: official.ptax_rate };
  }
  await store.create("Currency", entry, "sistema-bacen");
  return { ok: true, action: "created", rate_date: official.rate_date, exchange_rate: official.ptax_rate };
}

// Usada pela tarefa de Agendamento "atualizar_indices_bacen": busca CDI e
// SELIC dos últimos 10 dias (cobre fins de semana/feriados e qualquer
// intervalo em que o agendamento tenha ficado pausado) e insere só as datas
// que ainda não existem em cdi_rates — mesma lógica de deduplicação por
// rate_date+rate_type já usada na importação manual por CSV/BACEN em
// src/components/loan/CDIImporter.jsx.
export async function syncRatesToCdiRates() {
  const today = todayIsoInSaoPaulo();
  const startDate = isoDaysAgo(today, 10);
  const summary = {};
  for (const rateType of ["CDI", "SELIC"]) {
    const { rates } = await getRatesFromBACEN({ rateType, startDate, endDate: today });
    const existing = await store.filter("CDIRate", { rate_type: rateType }, "-rate_date", 10000);
    const existingDates = new Set(existing.map((r) => r.rate_date));
    const newRates = rates.filter((r) => !existingDates.has(r.rate_date));
    if (newRates.length) {
      await store.bulkCreate("CDIRate", newRates, "sistema-bacen");
    }
    summary[rateType] = { fetched: rates.length, inserted: newRates.length };
  }
  return { ok: true, summary };
}
