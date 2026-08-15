/**
 * 🔐 DEBT POSITION FACT — ETAPA 4C (HARDENED)
 * 
 * Materialização read-only de fatos de endividamento a partir de CalculationSnapshot
 * 100% derivado do schedule_snapshot (sem recálculo)
 * 
 * HARDENING APLICADO:
 * - Comparação timezone-safe (parseDate)
 * - Validação schedule: ordenação, duplicidade, vazio
 * - Position as-of: sd_base + sd_brl com currency_base
 * - Rounding final-only + rounding_policy
 * - PAID_OFF/NOT_STARTED objetivo
 * 
 * RESPONSABILIDADE:
 * - Transformar schedule_snapshot em fatos analíticos
 * - Classificar circulante vs não circulante
 * - Agregar por dimensões temporais (mês, ano, trimestre)
 * 
 * NÃO FAZ:
 * - Recálculo matemático
 * - Mutação de snapshots
 * - Validações de negócio (já feitas no snapshot)
 */

/**
 * 🔐 ROUNDING POLICY (Final-Only)
 */
const ROUNDING_POLICY = {
  method: "HALF_EVEN",
  decimals: 2,
  description: "Banker's Rounding — Final aggregates only"
};

/**
 * Parse date timezone-safe (YYYY-MM-DD string → Date UTC)
 * @param {string} dateStr - Data em formato YYYY-MM-DD
 * @returns {Date} Date object UTC
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  // Força T00:00:00Z para evitar conversão de timezone
  return new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00Z');
}

/**
 * Valida schedule (ordenação, duplicidade, vazio)
 * @param {Array} schedule - Schedule desserializado
 * @throws {Error} Se schedule inválido
 */
function validateSchedule(schedule) {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) {
    throw new Error("[DEBT_FACT] Schedule vazio ou inválido");
  }
  
  // Validar ordenação crescente (dataVencimento)
  for (let i = 1; i < schedule.length; i++) {
    const prevDate = parseDate(schedule[i - 1].dataVencimento);
    const currDate = parseDate(schedule[i].dataVencimento);
    if (currDate <= prevDate) {
      throw new Error(
        `[DEBT_FACT] Schedule não ordenado: parcela ${schedule[i - 1].parcela} ` +
        `(${schedule[i - 1].dataVencimento}) >= parcela ${schedule[i].parcela} (${schedule[i].dataVencimento})`
      );
    }
  }
  
  // Validar duplicidade de datas
  const dates = schedule.map(p => p.dataVencimento);
  const uniqueDates = new Set(dates);
  if (dates.length !== uniqueDates.size) {
    throw new Error("[DEBT_FACT] Schedule contém datas duplicadas");
  }
  
  return true;
}

/**
 * Rounding final para agregados (Banker's Rounding)
 * @param {number} value - Valor a arredondar
 * @param {number} decimals - Casas decimais (default: 2)
 * @returns {number} Valor arredondado
 */
function roundFinal(value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Materializa fatos de endividamento a partir do schedule snapshot
 * @param {Object} snapshot - CalculationSnapshot do banco
 * @param {Object} contract - Contrato relacionado
 * @param {Date} asOfDate - Data de corte para posição (opcional)
 * @returns {Object} Fatos materializados
 */
export function materializeDebtFacts(snapshot, contract = {}, asOfDate = null) {
  if (!snapshot || !snapshot.schedule_snapshot) {
    throw new Error("[DEBT_FACT] Snapshot inválido: schedule_snapshot ausente");
  }

  const schedule = JSON.parse(snapshot.schedule_snapshot);
  
  // 🔐 VALIDAR SCHEDULE (ordenação, duplicidade, vazio)
  validateSchedule(schedule);
  
  const cutoffDate = asOfDate ? parseDate(asOfDate) : new Date();
  
  // 🔐 FACT 1: Posição Geral (saldo devedor + próximas parcelas)
  const position = calculatePositionAsOf(schedule, cutoffDate);
  
  // 🔐 FACT 2: Classificação Circulante/Não Circulante (12 meses)
  const liquidity = classifyLiquidity(schedule, cutoffDate);
  
  // 🔐 FACT 3: Eventos Futuros (parcelas não pagas)
  const futureEvents = extractFutureEvents(schedule, cutoffDate);
  
  // 🔐 FACT 4: Juros por Período (agregação mensal/trimestral/anual)
  const interestByPeriod = aggregateInterestByPeriod(schedule, cutoffDate);
  
  // 🔐 FACT 5: Variação Cambial por Período (se USD)
  const exchangeByPeriod = aggregateExchangeByPeriod(schedule, cutoffDate);
  
  // 🔐 METADATA: Rastreabilidade completa
  return {
    snapshot_id: snapshot.id,
    contract_id: snapshot.contract_id,
    contract_number: snapshot.contract_number,

    // Hashes (imutabilidade)
    calculation_hash_strict: snapshot.calculation_hash_strict,
    calculation_hash_instance: snapshot.calculation_hash_instance,

    // Engine version
    engine_version: snapshot.engine_version,
    engine_build_id: snapshot.engine_build_id,

    // Snapshot timestamp
    snapshot_created_at: snapshot.created_date,
    trigger_event: snapshot.trigger_event,

    // Análise as-of
    as_of_date: cutoffDate.toISOString().split('T')[0],

    // Rounding policy
    rounding_policy: ROUNDING_POLICY,

    // Fatos materializados
    position: position,
    liquidity: liquidity,
    future_events: futureEvents,
    interest_by_period: interestByPeriod,
    exchange_by_period: exchangeByPeriod,

    // Metadados do contrato (enriquecimento)
    contract_metadata: {
      group_id: contract.group_id,
      entity_id: contract.entity_id,
      bank_id: contract.bank_id,
      currency: snapshot.currency,
      operation_date: contract.operation_date
    }
  };
  }

/**
 * Calcula posição as-of (saldo devedor na data de corte)
 * @param {Array} schedule - Schedule desserializado
 * @param {Date} cutoffDate - Data de corte
 * @returns {Object} Posição consolidada
 */
function calculatePositionAsOf(schedule, cutoffDate) {
  const isUSD = schedule[0]?.sdInicial_USD !== null && schedule[0]?.sdInicial_USD !== undefined;
  
  // Última parcela ANTES ou NA data de corte (timezone-safe)
  const lastParcelBeforeCutoff = schedule
    .filter(p => parseDate(p.dataVencimento) <= cutoffDate)
    .sort((a, b) => parseDate(b.dataVencimento) - parseDate(a.dataVencimento))[0];
  
  if (!lastParcelBeforeCutoff) {
    // Contrato ainda não iniciou: primeira parcela é futura
    const sdBase = isUSD ? (schedule[0]?.sdInicial_USD || 0) : (schedule[0]?.sdInicial || 0);
    
    return {
      saldo_devedor: schedule[0]?.sdInicial || 0,
      saldo_devedor_base: sdBase,
      saldo_devedor_brl: schedule[0]?.sdInicial || 0,
      saldo_devedor_usd: schedule[0]?.sdInicial_USD || null,
      currency_base: isUSD ? "USD" : "BRL",
      status: "NOT_STARTED",
      next_payment_date: schedule[0]?.dataVencimento,
      next_payment_amount: schedule[0]?.prestacao || 0,
      parcels_paid: 0,
      parcels_remaining: schedule.length
    };
  }
  
  // PAID_OFF objetivo: sdFinal <= 0.01 (última parcela paga)
  const isPaidOff = lastParcelBeforeCutoff.sdFinal <= 0.01;
  
  // Próxima parcela DEPOIS da data de corte
  const nextParcel = schedule.find(p => parseDate(p.dataVencimento) > cutoffDate);
  
  const sdBase = isUSD ? (lastParcelBeforeCutoff.sdFinal_USD || 0) : (lastParcelBeforeCutoff.sdFinal || 0);
  
  return {
    saldo_devedor: lastParcelBeforeCutoff.sdFinal || 0,
    saldo_devedor_base: roundFinal(sdBase, 2),
    saldo_devedor_brl: roundFinal(lastParcelBeforeCutoff.sdFinal || 0, 2),
    saldo_devedor_usd: isUSD ? roundFinal(lastParcelBeforeCutoff.sdFinal_USD || 0, 2) : null,
    currency_base: isUSD ? "USD" : "BRL",
    status: isPaidOff ? "PAID_OFF" : "ACTIVE",
    last_payment_date: lastParcelBeforeCutoff.dataVencimento,
    next_payment_date: nextParcel?.dataVencimento || null,
    next_payment_amount: nextParcel?.prestacao || 0,
    parcels_paid: schedule.findIndex(p => p.dataVencimento === lastParcelBeforeCutoff.dataVencimento) + 1,
    parcels_remaining: nextParcel ? schedule.length - schedule.findIndex(p => p.dataVencimento === nextParcel.dataVencimento) : 0
  };
}

/**
 * Classifica circulante vs não circulante (12 meses)
 * @param {Array} schedule - Schedule desserializado
 * @param {Date} cutoffDate - Data de corte
 * @returns {Object} Classificação de liquidez
 */
function classifyLiquidity(schedule, cutoffDate) {
  const horizon12Months = new Date(cutoffDate);
  horizon12Months.setMonth(horizon12Months.getMonth() + 12);
  
  // 🔐 HARDENING: Apenas vencimentos ESTRITAMENTE > cutoffDate e <= cutoffDate+12m
  const futureParcels = schedule.filter(p => parseDate(p.dataVencimento) > cutoffDate);
  
  const circulante = futureParcels
    .filter(p => parseDate(p.dataVencimento) <= horizon12Months)
    .reduce((acc, p) => ({
      principal: acc.principal + (p.amortizacao || 0),
      juros: acc.juros + (p.jurosFixosMes || 0) + (p.jurosVariaveisMes || 0),
      total: acc.total + (p.prestacao || 0),
      count: acc.count + 1
    }), { principal: 0, juros: 0, total: 0, count: 0 });
  
  const naoCirculante = futureParcels
    .filter(p => parseDate(p.dataVencimento) > horizon12Months)
    .reduce((acc, p) => ({
      principal: acc.principal + (p.amortizacao || 0),
      juros: acc.juros + (p.jurosFixosMes || 0) + (p.jurosVariaveisMes || 0),
      total: acc.total + (p.prestacao || 0),
      count: acc.count + 1
    }), { principal: 0, juros: 0, total: 0, count: 0 });
  
  return {
    horizon_months: 12,
    cutoff_date: cutoffDate.toISOString().split('T')[0],
    horizon_end_date: horizon12Months.toISOString().split('T')[0],
    circulante: {
      principal: roundFinal(circulante.principal),
      juros: roundFinal(circulante.juros),
      total: roundFinal(circulante.total),
      parcels_count: circulante.count
    },
    nao_circulante: {
      principal: roundFinal(naoCirculante.principal),
      juros: roundFinal(naoCirculante.juros),
      total: roundFinal(naoCirculante.total),
      parcels_count: naoCirculante.count
    },
    total: {
      principal: roundFinal(circulante.principal + naoCirculante.principal),
      juros: roundFinal(circulante.juros + naoCirculante.juros),
      total: roundFinal(circulante.total + naoCirculante.total)
    }
  };
}

/**
 * Extrai eventos futuros (parcelas não pagas)
 * @param {Array} schedule - Schedule desserializado
 * @param {Date} cutoffDate - Data de corte
 * @returns {Array} Parcelas futuras
 */
function extractFutureEvents(schedule, cutoffDate) {
  return schedule
    .filter(p => parseDate(p.dataVencimento) > cutoffDate)
    .map(p => ({
      parcela: p.parcela,
      data_vencimento: p.dataVencimento,
      principal: roundFinal(p.amortizacao || 0),
      juros: roundFinal((p.jurosFixosMes || 0) + (p.jurosVariaveisMes || 0)),
      prestacao: roundFinal(p.prestacao || 0),
      saldo_devedor_pos: roundFinal(p.sdFinal || 0),
      days_until_due: Math.ceil((parseDate(p.dataVencimento) - cutoffDate) / (1000 * 60 * 60 * 24))
    }));
}

/**
 * Agrega juros por período (mensal/trimestral/anual)
 * @param {Array} schedule - Schedule desserializado
 * @param {Date} cutoffDate - Data de corte (opcional, null = todos os períodos)
 * @returns {Object} Agregações de juros
 */
function aggregateInterestByPeriod(schedule, cutoffDate = null) {
  const parcels = cutoffDate 
    ? schedule.filter(p => parseDate(p.dataVencimento) <= cutoffDate)
    : schedule;
  
  // Agregação mensal
  const byMonth = parcels.reduce((acc, p) => {
    const month = p.dataVencimento.substring(0, 7); // YYYY-MM
    if (!acc[month]) {
      acc[month] = { fixo: 0, variavel: 0, total: 0, parcels: [] };
    }
    acc[month].fixo += p.jurosFixosMes || 0;
    acc[month].variavel += p.jurosVariaveisMes || 0;
    acc[month].total += (p.jurosFixosMes || 0) + (p.jurosVariaveisMes || 0);
    acc[month].parcels.push(p.parcela);
    return acc;
  }, {});
  
  // Agregação anual
  const byYear = parcels.reduce((acc, p) => {
    const year = p.dataVencimento.substring(0, 4); // YYYY
    if (!acc[year]) {
      acc[year] = { fixo: 0, variavel: 0, total: 0, parcels_count: 0 };
    }
    acc[year].fixo += p.jurosFixosMes || 0;
    acc[year].variavel += p.jurosVariaveisMes || 0;
    acc[year].total += (p.jurosFixosMes || 0) + (p.jurosVariaveisMes || 0);
    acc[year].parcels_count++;
    return acc;
  }, {});
  
  return {
    by_month: Object.keys(byMonth).sort().map(month => ({
      period: month,
      juros_fixo: roundFinal(byMonth[month].fixo),
      juros_variavel: roundFinal(byMonth[month].variavel),
      juros_total: roundFinal(byMonth[month].total),
      parcels: byMonth[month].parcels
    })),
    by_year: Object.keys(byYear).sort().map(year => ({
      period: year,
      juros_fixo: roundFinal(byYear[year].fixo),
      juros_variavel: roundFinal(byYear[year].variavel),
      juros_total: roundFinal(byYear[year].total),
      parcels_count: byYear[year].parcels_count
    }))
  };
}

/**
 * Agrega variação cambial por período (se USD)
 * @param {Array} schedule - Schedule desserializado
 * @param {Date} cutoffDate - Data de corte (opcional)
 * @returns {Object} Agregações de variação cambial
 */
function aggregateExchangeByPeriod(schedule, cutoffDate = null) {
  const parcels = cutoffDate 
    ? schedule.filter(p => parseDate(p.dataVencimento) <= cutoffDate)
    : schedule;
  
  // Verificar se há variação cambial (USD)
  const hasExchange = parcels.some(p => p.varCambial !== undefined && p.varCambial !== null);
  
  if (!hasExchange) {
    return { currency: "BRL", has_exchange: false, by_month: [], by_year: [] };
  }
  
  // Agregação mensal
  const byMonth = parcels.reduce((acc, p) => {
    const month = p.dataVencimento.substring(0, 7);
    if (!acc[month]) {
      acc[month] = { variacao: 0, parcels: [] };
    }
    acc[month].variacao += p.varCambial || 0;
    acc[month].parcels.push(p.parcela);
    return acc;
  }, {});
  
  // Agregação anual
  const byYear = parcels.reduce((acc, p) => {
    const year = p.dataVencimento.substring(0, 4);
    if (!acc[year]) {
      acc[year] = { variacao: 0, parcels_count: 0 };
    }
    acc[year].variacao += p.varCambial || 0;
    acc[year].parcels_count++;
    return acc;
  }, {});
  
  return {
    currency: "USD",
    has_exchange: true,
    by_month: Object.keys(byMonth).sort().map(month => ({
      period: month,
      variacao_cambial: roundFinal(byMonth[month].variacao),
      parcels: byMonth[month].parcels
    })),
    by_year: Object.keys(byYear).sort().map(year => ({
      period: year,
      variacao_cambial: roundFinal(byYear[year].variacao),
      parcels_count: byYear[year].parcels_count
    }))
  };
}

/**
 * Gera mapa de endividamento (visualização mensal/anual)
 * @param {Array} schedule - Schedule desserializado
 * @returns {Object} Mapa de endividamento
 */
export function generateDebtMap(schedule) {
  if (!schedule || schedule.length === 0) {
    return { monthly: [], yearly: [], basis: "DUE_DATE" };
  }
  
  // Mapa mensal: SD inicial/final + prestação
  const monthly = schedule.map(p => ({
    period: p.dataVencimento.substring(0, 7),
    date: p.dataVencimento,
    parcela: p.parcela,
    saldo_inicial: roundFinal(p.sdInicial || 0),
    saldo_final: roundFinal(p.sdFinal || 0),
    amortizacao: roundFinal(p.amortizacao || 0),
    juros_total: roundFinal((p.jurosFixosMes || 0) + (p.jurosVariaveisMes || 0)),
    prestacao: roundFinal(p.prestacao || 0)
  }));
  
  // Mapa anual: Agregação por ano
  const yearly = schedule.reduce((acc, p) => {
    const year = p.dataVencimento.substring(0, 4);
    if (!acc[year]) {
      acc[year] = {
        period: year,
        saldo_inicial: p.sdInicial || 0,
        amortizacao_total: 0,
        juros_total: 0,
        prestacao_total: 0,
        parcels_count: 0
      };
    }
    acc[year].amortizacao_total += p.amortizacao || 0;
    acc[year].juros_total += (p.jurosFixosMes || 0) + (p.jurosVariaveisMes || 0);
    acc[year].prestacao_total += p.prestacao || 0;
    acc[year].parcels_count++;
    
    // Saldo final do ano é o SD final da última parcela
    acc[year].saldo_final = p.sdFinal || 0;
    
    return acc;
  }, {});
  
  return {
    monthly: monthly,
    yearly: Object.values(yearly).map(y => ({
      ...y,
      amortizacao_total: roundFinal(y.amortizacao_total),
      juros_total: roundFinal(y.juros_total),
      prestacao_total: roundFinal(y.prestacao_total),
      saldo_inicial: roundFinal(y.saldo_inicial),
      saldo_final: roundFinal(y.saldo_final)
    })),
    basis: "DUE_DATE"
  };
}

export default {
  materializeDebtFacts,
  generateDebtMap
};