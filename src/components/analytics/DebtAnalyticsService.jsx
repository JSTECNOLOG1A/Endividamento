/**
 * 🔐 DEBT ANALYTICS SERVICE — ETAPA 4C
 * 
 * Service layer 100% read-only para análises de endividamento
 * Consome APENAS CalculationSnapshot (nunca recalcula)
 * 
 * ENDPOINTS:
 * 1. getPositionAsOf(filters) - Posição consolidada as-of
 * 2. getLiquidityAnalysis(filters) - Circulante vs não circulante
 * 3. getInterestForDRE(filters) - Juros do mês (DRE)
 * 4. getInterestByPeriod(filters) - Juros por período
 * 5. getExchangeByPeriod(filters) - Variação cambial por período
 * 6. getDebtMap(filters) - Mapa de endividamento
 * 7. getConsolidatedAnalytics(filters) - Análise consolidada (all-in-one)
 * 
 * METADADOS EM TODAS AS RESPOSTAS:
 * - snapshot_id, calculation_hash_strict, engine_version, engine_build_id
 * - filters_applied, query_timestamp
 */

import { base44 } from "@/api/base44Client";
import { materializeDebtFacts, generateDebtMap } from "./DebtPositionFact";

/**
 * 🔐 FILTERS PADRÃO
 * Todos os endpoints aceitam esses filtros
 */
const DEFAULT_FILTERS = {
  contract_ids: null,      // Array de IDs específicos
  group_ids: null,         // Array de grupos
  entity_ids: null,        // Array de entidades
  bank_ids: null,          // Array de bancos
  currency: null,          // "BRL" ou "USD"
  as_of_date: null,        // Data de corte (ISO: YYYY-MM-DD)
  include_paid_off: false  // Incluir contratos quitados
};

/**
 * 🔐 CORE: Busca snapshots com filtros (batch limitado)
 * @param {Object} filters - Filtros de query
 * @returns {Promise<Array>} Snapshots + contracts
 */
async function fetchSnapshotsWithFilters(filters = {}) {
  const { 
    contract_ids, 
    group_ids, 
    entity_ids, 
    bank_ids, 
    currency, 
    as_of_date,
    include_paid_off 
  } = { ...DEFAULT_FILTERS, ...filters };
  
  // 1️⃣ Buscar todos os contratos (com filtros)
  let contractQuery = {};
  if (group_ids?.length) contractQuery.group_id = { $in: group_ids };
  if (entity_ids?.length) contractQuery.entity_id = { $in: entity_ids };
  if (bank_ids?.length) contractQuery.bank_id = { $in: bank_ids };
  if (currency) contractQuery.currency_id = currency === "BRL" ? null : { $ne: null };
  
  const contracts = await base44.entities.LoanContract.filter(contractQuery, "-created_date", 1000);
  
  // 2️⃣ Filtrar por contract_ids se fornecido
  const targetContracts = contract_ids?.length
    ? contracts.filter(c => contract_ids.includes(c.id))
    : contracts;
  
  if (targetContracts.length === 0) {
    return [];
  }
  
  // 3️⃣ Buscar snapshots em CHUNKS (evitar Promise.all gigante)
  const CHUNK_SIZE = 20;
  const chunks = [];
  for (let i = 0; i < targetContracts.length; i += CHUNK_SIZE) {
    chunks.push(targetContracts.slice(i, i + CHUNK_SIZE));
  }
  
  const results = [];
  for (const chunk of chunks) {
    const chunkPromises = chunk.map(async (contract) => {
      if (!contract.current_snapshot_id) {
        console.warn(`Contrato ${contract.contract_number} sem snapshot`);
        return null;
      }
      
      try {
        const snapshot = await base44.entities.CalculationSnapshot.read(contract.current_snapshot_id);
        return { snapshot, contract };
      } catch (error) {
        console.error(`Erro ao carregar snapshot ${contract.current_snapshot_id}:`, error.message);
        return null;
      }
    });
    
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }
  
  // 4️⃣ Filtrar nulls + aplicar filtros adicionais
  let filtered = results.filter(r => r !== null);
  
  // Filtrar quitados (se não incluir) — timezone-safe + objetivo
  if (!include_paid_off && as_of_date) {
    filtered = filtered.filter(({ snapshot }) => {
      const schedule = JSON.parse(snapshot.schedule_snapshot);
      const cutoffDate = parseDate(as_of_date);
      const lastParcel = schedule
        .filter(p => parseDate(p.dataVencimento) <= cutoffDate)
        .sort((a, b) => parseDate(b.dataVencimento) - parseDate(a.dataVencimento))[0];
      
      // PAID_OFF objetivo: sdFinal <= 0.01
      return !lastParcel || lastParcel.sdFinal > 0.01;
    });
  }
  
  return filtered;
}

/**
 * Parse date timezone-safe (helper local)
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00Z');
}

/**
 * 🔐 ENDPOINT 1: Posição consolidada as-of
 * @param {Object} filters - Filtros de query
 * @returns {Promise<Object>} Posição consolidada
 */
export async function getPositionAsOf(filters = {}) {
  const queryStart = Date.now();
  const asOfDate = filters.as_of_date ? parseDate(filters.as_of_date) : new Date();
  
  const snapshots = await fetchSnapshotsWithFilters(filters);
  
  if (snapshots.length === 0) {
    return {
      status: "NO_DATA",
      filters_applied: filters,
      query_timestamp: new Date().toISOString(),
      query_duration_ms: Date.now() - queryStart,
      contracts_count: 0,
      position: null
    };
  }
  
  // Materializar fatos + agregar
  const facts = snapshots.map(({ snapshot, contract }) => 
    materializeDebtFacts(snapshot, contract, asOfDate)
  );
  
  // Consolidar posições
  const consolidated = {
    saldo_devedor_total_brl: facts.reduce((acc, f) => acc + f.position.saldo_devedor_brl, 0),
    saldo_devedor_total_base: facts.reduce((acc, f) => acc + f.position.saldo_devedor_base, 0),
    saldo_devedor_total_usd: facts.reduce((acc, f) => acc + (f.position.saldo_devedor_usd || 0), 0),
    contracts_active: facts.filter(f => f.position.status === "ACTIVE").length,
    contracts_paid_off: facts.filter(f => f.position.status === "PAID_OFF").length,
    contracts_not_started: facts.filter(f => f.position.status === "NOT_STARTED").length
  };
  
  return {
    status: "SUCCESS",
    filters_applied: filters,
    query_timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - queryStart,
    as_of_date: asOfDate.toISOString().split('T')[0],
    contracts_count: snapshots.length,
    rounding_policy: { method: "HALF_EVEN", decimals: 2 },
    
    // Posição consolidada
    position: {
      saldo_devedor_total_brl: roundFinal(consolidated.saldo_devedor_total_brl),
      saldo_devedor_total_base: roundFinal(consolidated.saldo_devedor_total_base),
      saldo_devedor_total_usd: roundFinal(consolidated.saldo_devedor_total_usd),
      contracts_active: consolidated.contracts_active,
      contracts_paid_off: consolidated.contracts_paid_off,
      contracts_not_started: consolidated.contracts_not_started
    },
    
    // Detalhamento por contrato
    contracts: facts.map(f => ({
      contract_number: f.contract_number,
      snapshot_id: f.snapshot_id,
      calculation_hash_strict: f.calculation_hash_strict,
      engine_version: f.engine_version,
      position: f.position
    }))
  };
}

/**
 * Rounding final helper
 */
function roundFinal(value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * 🔐 ENDPOINT 2: Análise de Liquidez (Circulante vs Não Circulante)
 * @param {Object} filters - Filtros de query
 * @returns {Promise<Object>} Análise de liquidez
 */
export async function getLiquidityAnalysis(filters = {}) {
  const queryStart = Date.now();
  const asOfDate = filters.as_of_date ? parseDate(filters.as_of_date) : new Date();
  
  const snapshots = await fetchSnapshotsWithFilters(filters);
  
  if (snapshots.length === 0) {
    return {
      status: "NO_DATA",
      filters_applied: filters,
      query_timestamp: new Date().toISOString(),
      query_duration_ms: Date.now() - queryStart
    };
  }
  
  const facts = snapshots.map(({ snapshot, contract }) => 
    materializeDebtFacts(snapshot, contract, asOfDate)
  );
  
  // Consolidar liquidez
  const consolidated = facts.reduce((acc, f) => {
    acc.circulante.principal += f.liquidity.circulante.principal;
    acc.circulante.juros += f.liquidity.circulante.juros;
    acc.circulante.total += f.liquidity.circulante.total;
    
    acc.nao_circulante.principal += f.liquidity.nao_circulante.principal;
    acc.nao_circulante.juros += f.liquidity.nao_circulante.juros;
    acc.nao_circulante.total += f.liquidity.nao_circulante.total;
    
    return acc;
  }, {
    circulante: { principal: 0, juros: 0, total: 0 },
    nao_circulante: { principal: 0, juros: 0, total: 0 }
  });
  
  return {
    status: "SUCCESS",
    filters_applied: filters,
    query_timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - queryStart,
    as_of_date: asOfDate.toISOString().split('T')[0],
    horizon_months: 12,
    contracts_count: snapshots.length,
    rounding_policy: { method: "HALF_EVEN", decimals: 2 },
    
    // Consolidado
    liquidity: {
      circulante: {
        principal: roundFinal(consolidated.circulante.principal),
        juros: roundFinal(consolidated.circulante.juros),
        total: roundFinal(consolidated.circulante.total)
      },
      nao_circulante: {
        principal: roundFinal(consolidated.nao_circulante.principal),
        juros: roundFinal(consolidated.nao_circulante.juros),
        total: roundFinal(consolidated.nao_circulante.total)
      },
      total: {
        principal: roundFinal(consolidated.circulante.principal + consolidated.nao_circulante.principal),
        juros: roundFinal(consolidated.circulante.juros + consolidated.nao_circulante.juros),
        total: roundFinal(consolidated.circulante.total + consolidated.nao_circulante.total)
      }
    },
    
    // Detalhamento por contrato
    contracts: facts.map(f => ({
      contract_number: f.contract_number,
      snapshot_id: f.snapshot_id,
      calculation_hash_strict: f.calculation_hash_strict,
      liquidity: f.liquidity
    }))
  };
}

/**
 * 🔐 ENDPOINT 3: Juros do Mês (para DRE)
 * @param {Object} filters - Filtros de query (obrigatório: target_month YYYY-MM)
 * @returns {Promise<Object>} Juros do mês
 */
export async function getInterestForDRE(filters = {}) {
  const queryStart = Date.now();
  
  if (!filters.target_month) {
    throw new Error("[ANALYTICS] target_month obrigatório (formato: YYYY-MM)");
  }
  
  const snapshots = await fetchSnapshotsWithFilters(filters);
  
  if (snapshots.length === 0) {
    return {
      status: "NO_DATA",
      filters_applied: filters,
      query_timestamp: new Date().toISOString(),
      query_duration_ms: Date.now() - queryStart
    };
  }
  
  // Filtrar parcelas do mês alvo
  const targetMonth = filters.target_month;
  
  const consolidated = snapshots.reduce((acc, { snapshot }) => {
    const schedule = JSON.parse(snapshot.schedule_snapshot);
    const parcelsOfMonth = schedule.filter(p => p.dataVencimento.startsWith(targetMonth));
    
    parcelsOfMonth.forEach(p => {
      acc.juros_fixo += p.jurosFixosMes || 0;
      acc.juros_variavel += p.jurosVariaveisMes || 0;
      acc.var_cambial += p.varCambial || 0;
      acc.parcels_count++;
    });
    
    return acc;
  }, { juros_fixo: 0, juros_variavel: 0, var_cambial: 0, parcels_count: 0 });
  
  return {
    status: "SUCCESS",
    filters_applied: filters,
    query_timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - queryStart,
    target_month: targetMonth,
    contracts_count: snapshots.length,
    rounding_policy: { method: "HALF_EVEN", decimals: 2 },
    
    // DRE do mês
    dre: {
      juros_fixo: roundFinal(consolidated.juros_fixo),
      juros_variavel: roundFinal(consolidated.juros_variavel),
      juros_total: roundFinal(consolidated.juros_fixo + consolidated.juros_variavel),
      variacao_cambial: roundFinal(consolidated.var_cambial),
      parcels_count: consolidated.parcels_count
    }
  };
}

/**
 * 🔐 ENDPOINT 4: Juros por Período (mensal/anual)
 * @param {Object} filters - Filtros de query
 * @returns {Promise<Object>} Juros por período
 */
export async function getInterestByPeriod(filters = {}) {
  const queryStart = Date.now();
  const snapshots = await fetchSnapshotsWithFilters(filters);
  
  if (snapshots.length === 0) {
    return {
      status: "NO_DATA",
      filters_applied: filters,
      query_timestamp: new Date().toISOString(),
      query_duration_ms: Date.now() - queryStart
    };
  }
  
  const facts = snapshots.map(({ snapshot, contract }) => 
    materializeDebtFacts(snapshot, contract)
  );
  
  // Consolidar por mês
  const byMonth = facts.reduce((acc, f) => {
    f.interest_by_period.by_month.forEach(m => {
      if (!acc[m.period]) {
        acc[m.period] = { fixo: 0, variavel: 0, total: 0 };
      }
      acc[m.period].fixo += m.juros_fixo;
      acc[m.period].variavel += m.juros_variavel;
      acc[m.period].total += m.juros_total;
    });
    return acc;
  }, {});
  
  // Consolidar por ano
  const byYear = facts.reduce((acc, f) => {
    f.interest_by_period.by_year.forEach(y => {
      if (!acc[y.period]) {
        acc[y.period] = { fixo: 0, variavel: 0, total: 0 };
      }
      acc[y.period].fixo += y.juros_fixo;
      acc[y.period].variavel += y.juros_variavel;
      acc[y.period].total += y.juros_total;
    });
    return acc;
  }, {});
  
  return {
    status: "SUCCESS",
    filters_applied: filters,
    query_timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - queryStart,
    contracts_count: snapshots.length,
    rounding_policy: { method: "HALF_EVEN", decimals: 2 },
    
    by_month: Object.keys(byMonth).sort().map(period => ({
      period,
      juros_fixo: roundFinal(byMonth[period].fixo),
      juros_variavel: roundFinal(byMonth[period].variavel),
      juros_total: roundFinal(byMonth[period].total)
    })),
    
    by_year: Object.keys(byYear).sort().map(period => ({
      period,
      juros_fixo: roundFinal(byYear[period].fixo),
      juros_variavel: roundFinal(byYear[period].variavel),
      juros_total: roundFinal(byYear[period].total)
    }))
  };
}

/**
 * 🔐 ENDPOINT 5: Variação Cambial por Período
 * @param {Object} filters - Filtros de query
 * @returns {Promise<Object>} Variação cambial por período
 */
export async function getExchangeByPeriod(filters = {}) {
  const queryStart = Date.now();
  const snapshots = await fetchSnapshotsWithFilters({ ...filters, currency: "USD" });
  
  if (snapshots.length === 0) {
    return {
      status: "NO_DATA",
      filters_applied: filters,
      query_timestamp: new Date().toISOString(),
      query_duration_ms: Date.now() - queryStart,
      message: "Nenhum contrato USD encontrado"
    };
  }
  
  const facts = snapshots.map(({ snapshot, contract }) => 
    materializeDebtFacts(snapshot, contract)
  );
  
  // Consolidar por mês
  const byMonth = facts.reduce((acc, f) => {
    f.exchange_by_period.by_month.forEach(m => {
      if (!acc[m.period]) {
        acc[m.period] = 0;
      }
      acc[m.period] += m.variacao_cambial;
    });
    return acc;
  }, {});
  
  // Consolidar por ano
  const byYear = facts.reduce((acc, f) => {
    f.exchange_by_period.by_year.forEach(y => {
      if (!acc[y.period]) {
        acc[y.period] = 0;
      }
      acc[y.period] += y.variacao_cambial;
    });
    return acc;
  }, {});
  
  return {
    status: "SUCCESS",
    filters_applied: filters,
    query_timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - queryStart,
    contracts_count: snapshots.length,
    rounding_policy: { method: "HALF_EVEN", decimals: 2 },
    
    by_month: Object.keys(byMonth).sort().map(period => ({
      period,
      variacao_cambial: roundFinal(byMonth[period])
    })),
    
    by_year: Object.keys(byYear).sort().map(period => ({
      period,
      variacao_cambial: roundFinal(byYear[period])
    }))
  };
}

/**
 * 🔐 ENDPOINT 6: Mapa de Endividamento
 * @param {Object} filters - Filtros de query
 * @returns {Promise<Object>} Mapa de endividamento
 */
export async function getDebtMap(filters = {}) {
  const queryStart = Date.now();
  const snapshots = await fetchSnapshotsWithFilters(filters);
  
  if (snapshots.length === 0) {
    return {
      status: "NO_DATA",
      filters_applied: filters,
      query_timestamp: new Date().toISOString(),
      query_duration_ms: Date.now() - queryStart
    };
  }
  
  const maps = snapshots.map(({ snapshot }) => {
    const schedule = JSON.parse(snapshot.schedule_snapshot);
    return generateDebtMap(schedule);
  });
  
  // Consolidar mapas mensais
  const monthlyConsolidated = maps.reduce((acc, map) => {
    map.monthly.forEach(m => {
      if (!acc[m.period]) {
        acc[m.period] = { saldo_inicial: 0, amortizacao: 0, juros: 0, prestacao: 0, saldo_final: 0 };
      }
      acc[m.period].saldo_inicial += m.saldo_inicial;
      acc[m.period].amortizacao += m.amortizacao;
      acc[m.period].juros += m.juros_total;
      acc[m.period].prestacao += m.prestacao;
      acc[m.period].saldo_final += m.saldo_final;
    });
    return acc;
  }, {});
  
  // Consolidar mapas anuais
  const yearlyConsolidated = maps.reduce((acc, map) => {
    map.yearly.forEach(y => {
      if (!acc[y.period]) {
        acc[y.period] = { saldo_inicial: 0, amortizacao: 0, juros: 0, prestacao: 0, saldo_final: 0 };
      }
      acc[y.period].saldo_inicial += y.saldo_inicial;
      acc[y.period].amortizacao += y.amortizacao_total;
      acc[y.period].juros += y.juros_total;
      acc[y.period].prestacao += y.prestacao_total;
      acc[y.period].saldo_final += y.saldo_final;
    });
    return acc;
  }, {});
  
  return {
    status: "SUCCESS",
    filters_applied: filters,
    query_timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - queryStart,
    contracts_count: snapshots.length,
    rounding_policy: { method: "HALF_EVEN", decimals: 2 },
    basis: "DUE_DATE",
    
    monthly: Object.keys(monthlyConsolidated).sort().map(period => ({
      period,
      saldo_inicial: roundFinal(monthlyConsolidated[period].saldo_inicial),
      amortizacao: roundFinal(monthlyConsolidated[period].amortizacao),
      juros: roundFinal(monthlyConsolidated[period].juros),
      prestacao: roundFinal(monthlyConsolidated[period].prestacao),
      saldo_final: roundFinal(monthlyConsolidated[period].saldo_final)
    })),
    
    yearly: Object.keys(yearlyConsolidated).sort().map(period => ({
      period,
      saldo_inicial: roundFinal(yearlyConsolidated[period].saldo_inicial),
      amortizacao_total: roundFinal(yearlyConsolidated[period].amortizacao),
      juros_total: roundFinal(yearlyConsolidated[period].juros),
      prestacao_total: roundFinal(yearlyConsolidated[period].prestacao),
      saldo_final: roundFinal(yearlyConsolidated[period].saldo_final)
    }))
  };
}

/**
 * 🔐 ENDPOINT 7: Análise Consolidada (All-in-One)
 * @param {Object} filters - Filtros de query
 * @returns {Promise<Object>} Análise completa
 */
export async function getConsolidatedAnalytics(filters = {}) {
  const queryStart = Date.now();
  
  // 🔐 CACHE LOCAL: Evitar refetch de snapshots
  const snapshotCache = new Map();
  const snapshots = await fetchSnapshotsWithFilters(filters);
  
  // Popular cache
  snapshots.forEach(({ snapshot, contract }) => {
    snapshotCache.set(snapshot.id, { snapshot, contract });
  });
  
  // Funções internas (usam cache)
  const getCachedFacts = (asOfDate = null) => {
    return Array.from(snapshotCache.values()).map(({ snapshot, contract }) =>
      materializeDebtFacts(snapshot, contract, asOfDate)
    );
  };
  
  const asOfDate = filters.as_of_date ? parseDate(filters.as_of_date) : new Date();
  const facts = getCachedFacts(asOfDate);
  
  if (facts.length === 0) {
    return {
      status: "NO_DATA",
      filters_applied: filters,
      query_timestamp: new Date().toISOString(),
      query_duration_ms: Date.now() - queryStart
    };
  }
  
  // Consolidar posição
  const consolidatedPosition = {
    saldo_devedor_total_brl: facts.reduce((acc, f) => acc + f.position.saldo_devedor_brl, 0),
    saldo_devedor_total_base: facts.reduce((acc, f) => acc + f.position.saldo_devedor_base, 0),
    saldo_devedor_total_usd: facts.reduce((acc, f) => acc + (f.position.saldo_devedor_usd || 0), 0),
    contracts_active: facts.filter(f => f.position.status === "ACTIVE").length,
    contracts_paid_off: facts.filter(f => f.position.status === "PAID_OFF").length,
    contracts_not_started: facts.filter(f => f.position.status === "NOT_STARTED").length
  };
  
  // Consolidar liquidez
  const consolidatedLiquidity = facts.reduce((acc, f) => {
    acc.circulante.principal += f.liquidity.circulante.principal;
    acc.circulante.juros += f.liquidity.circulante.juros;
    acc.circulante.total += f.liquidity.circulante.total;
    acc.nao_circulante.principal += f.liquidity.nao_circulante.principal;
    acc.nao_circulante.juros += f.liquidity.nao_circulante.juros;
    acc.nao_circulante.total += f.liquidity.nao_circulante.total;
    return acc;
  }, {
    circulante: { principal: 0, juros: 0, total: 0 },
    nao_circulante: { principal: 0, juros: 0, total: 0 }
  });
  
  // Gerar debt maps e consolidar
  const maps = Array.from(snapshotCache.values()).map(({ snapshot }) => {
    const schedule = JSON.parse(snapshot.schedule_snapshot);
    return generateDebtMap(schedule);
  });
  
  const monthlyConsolidated = maps.reduce((acc, map) => {
    map.monthly.forEach(m => {
      if (!acc[m.period]) {
        acc[m.period] = { saldo_inicial: 0, amortizacao: 0, juros: 0, prestacao: 0, saldo_final: 0 };
      }
      acc[m.period].saldo_inicial += m.saldo_inicial;
      acc[m.period].amortizacao += m.amortizacao;
      acc[m.period].juros += m.juros_total;
      acc[m.period].prestacao += m.prestacao;
      acc[m.period].saldo_final += m.saldo_final;
    });
    return acc;
  }, {});
  
  const yearlyConsolidated = maps.reduce((acc, map) => {
    map.yearly.forEach(y => {
      if (!acc[y.period]) {
        acc[y.period] = { saldo_inicial: 0, amortizacao: 0, juros: 0, prestacao: 0, saldo_final: 0 };
      }
      acc[y.period].saldo_inicial += y.saldo_inicial;
      acc[y.period].amortizacao += y.amortizacao_total;
      acc[y.period].juros += y.juros_total;
      acc[y.period].prestacao += y.prestacao_total;
      acc[y.period].saldo_final += y.saldo_final;
    });
    return acc;
  }, {});
  
  return {
    status: "SUCCESS",
    filters_applied: filters,
    query_timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - queryStart,
    contracts_count: snapshots.length,
    rounding_policy: { method: "HALF_EVEN", decimals: 2 },
    cache_used: true,
    
    position: {
      saldo_devedor_total_brl: roundFinal(consolidatedPosition.saldo_devedor_total_brl),
      saldo_devedor_total_base: roundFinal(consolidatedPosition.saldo_devedor_total_base),
      saldo_devedor_total_usd: roundFinal(consolidatedPosition.saldo_devedor_total_usd),
      contracts_active: consolidatedPosition.contracts_active,
      contracts_paid_off: consolidatedPosition.contracts_paid_off,
      contracts_not_started: consolidatedPosition.contracts_not_started
    },
    
    liquidity: {
      circulante: {
        principal: roundFinal(consolidatedLiquidity.circulante.principal),
        juros: roundFinal(consolidatedLiquidity.circulante.juros),
        total: roundFinal(consolidatedLiquidity.circulante.total)
      },
      nao_circulante: {
        principal: roundFinal(consolidatedLiquidity.nao_circulante.principal),
        juros: roundFinal(consolidatedLiquidity.nao_circulante.juros),
        total: roundFinal(consolidatedLiquidity.nao_circulante.total)
      },
      total: {
        principal: roundFinal(consolidatedLiquidity.circulante.principal + consolidatedLiquidity.nao_circulante.principal),
        juros: roundFinal(consolidatedLiquidity.circulante.juros + consolidatedLiquidity.nao_circulante.juros),
        total: roundFinal(consolidatedLiquidity.circulante.total + consolidatedLiquidity.nao_circulante.total)
      }
    },
    
    debt_map: {
      monthly: Object.keys(monthlyConsolidated).sort().map(period => ({
        period,
        saldo_inicial: roundFinal(monthlyConsolidated[period].saldo_inicial),
        amortizacao: roundFinal(monthlyConsolidated[period].amortizacao),
        juros: roundFinal(monthlyConsolidated[period].juros),
        prestacao: roundFinal(monthlyConsolidated[period].prestacao),
        saldo_final: roundFinal(monthlyConsolidated[period].saldo_final)
      })),
      yearly: Object.keys(yearlyConsolidated).sort().map(period => ({
        period,
        saldo_inicial: roundFinal(yearlyConsolidated[period].saldo_inicial),
        amortizacao_total: roundFinal(yearlyConsolidated[period].amortizacao),
        juros_total: roundFinal(yearlyConsolidated[period].juros),
        prestacao_total: roundFinal(yearlyConsolidated[period].prestacao),
        saldo_final: roundFinal(yearlyConsolidated[period].saldo_final)
      })),
      basis: "DUE_DATE"
    }
  };
}

export default {
  getPositionAsOf,
  getLiquidityAnalysis,
  getInterestForDRE,
  getInterestByPeriod,
  getExchangeByPeriod,
  getDebtMap,
  getConsolidatedAnalytics
};