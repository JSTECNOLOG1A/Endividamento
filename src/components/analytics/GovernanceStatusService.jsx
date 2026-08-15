/**
 * 🔐 GOVERNANCE STATUS SERVICE — ETAPA 4C (HARDENED)
 * 
 * Endpoint para dashboard de risk/governance
 * Retorna estatísticas consolidadas de saúde financeira
 * 
 * HARDENING:
 * - Governance score (0-100) baseado em integrity, precision, snapshot_health
 * 
 * 100% read-only, sem mutações
 */

import { base44 } from "@/api/base44Client";

/**
 * Calcula governance score (0-100)
 * @param {Object} governance - Estatísticas de governança
 * @param {Object} overview - Estatísticas gerais
 * @returns {Object} Score com breakdown
 */
function calculateGovernanceScore(governance, overview) {
  const totalContracts = overview.with_snapshot;
  
  if (totalContracts === 0) {
    return {
      score: 100,
      rating: "EXCELLENT",
      breakdown: { integrity: 100, precision: 100, snapshot_health: 100 }
    };
  }
  
  // 1️⃣ Integrity score (40% peso)
  const integrityPenalty = (governance.integrity_fail / totalContracts) * 100;
  const integrityScore = Math.max(0, 100 - (integrityPenalty * 10)); // Cada 10% de falhas = -100 pontos
  
  // 2️⃣ Precision score (30% peso)
  const precisionPenalty = (governance.precision_fail / totalContracts) * 100;
  const precisionScore = Math.max(0, 100 - (precisionPenalty * 5)); // Cada 20% de falhas = -100 pontos
  
  // 3️⃣ Snapshot health score (30% peso)
  const snapshotHealthPenalty = (overview.without_snapshot / overview.total_contracts) * 100;
  const fallbackPenalty = (overview.fallback_active / overview.total_contracts) * 100;
  const snapshotHealthScore = Math.max(0, 100 - (snapshotHealthPenalty * 2) - (fallbackPenalty * 1));
  
  // Score final (média ponderada)
  const finalScore = Math.round(
    (integrityScore * 0.4) + 
    (precisionScore * 0.3) + 
    (snapshotHealthScore * 0.3)
  );
  
  // Rating
  let rating = "POOR";
  if (finalScore >= 90) rating = "EXCELLENT";
  else if (finalScore >= 80) rating = "GOOD";
  else if (finalScore >= 70) rating = "FAIR";
  else if (finalScore >= 60) rating = "NEEDS_IMPROVEMENT";
  
  return {
    score: finalScore,
    rating: rating,
    breakdown: {
      integrity: Math.round(integrityScore),
      precision: Math.round(precisionScore),
      snapshot_health: Math.round(snapshotHealthScore)
    },
    weights: {
      integrity: "40%",
      precision: "30%",
      snapshot_health: "30%"
    }
  };
}

/**
 * Retorna status consolidado de governança financeira
 * @param {Object} filters - Filtros opcionais
 * @returns {Promise<Object>} Status de governança
 */
export async function getFinancialGovernanceStatus(filters = {}) {
  const queryStart = Date.now();
  
  // 1️⃣ Buscar todos os contratos (não apenas aprovados)
  const contractQuery = {};
  if (filters.group_ids?.length) contractQuery.group_id = { $in: filters.group_ids };
  if (filters.entity_ids?.length) contractQuery.entity_id = { $in: filters.entity_ids };
  
  const allContracts = await base44.entities.LoanContract.filter(contractQuery, "-created_date", 1000);
  
  // 2️⃣ Buscar snapshots associados
  const snapshotPromises = allContracts
    .filter(c => c.current_snapshot_id)
    .map(async (contract) => {
      try {
        const snapshot = await base44.entities.CalculationSnapshot.read(contract.current_snapshot_id);
        return { contract, snapshot, loaded: true };
      } catch (error) {
        console.warn(`Erro ao carregar snapshot ${contract.current_snapshot_id}:`, error.message);
        return { contract, snapshot: null, loaded: false };
      }
    });
  
  const snapshotResults = await Promise.all(snapshotPromises);
  
  // 3️⃣ Analisar risk flags e integrity status
  const snapshotsWithData = snapshotResults.filter(r => r.loaded);
  
  const integrityFailCount = snapshotsWithData.filter(({ snapshot }) => {
    try {
      const riskFlags = JSON.parse(snapshot.risk_flags_snapshot || "[]");
      return riskFlags.some(f => f.flag === "INTEGRITY_FAIL");
    } catch {
      return false;
    }
  }).length;
  
  const precisionFailCount = snapshotsWithData.filter(({ snapshot }) => {
    try {
      const riskFlags = JSON.parse(snapshot.risk_flags_snapshot || "[]");
      return riskFlags.some(f => f.flag === "PRECISION_FAIL");
    } catch {
      return false;
    }
  }).length;
  
  const anatocismCount = snapshotsWithData.filter(({ snapshot }) => {
    try {
      const riskFlags = JSON.parse(snapshot.risk_flags_snapshot || "[]");
      return riskFlags.some(f => f.flag === "ANATOCISM");
    } catch {
      return false;
    }
  }).length;
  
  const exchangeRiskCount = snapshotsWithData.filter(({ snapshot }) => {
    try {
      const riskFlags = JSON.parse(snapshot.risk_flags_snapshot || "[]");
      return riskFlags.some(f => f.flag === "EXCHANGE_RATE_RISK");
    } catch {
      return false;
    }
  }).length;
  
  const ptaxFallbackCount = snapshotsWithData.filter(({ snapshot }) => {
    try {
      const riskFlags = JSON.parse(snapshot.risk_flags_snapshot || "[]");
      return riskFlags.some(f => f.flag === "PTAX_NEAREST_PAST" || f.flag === "PTAX_NO_RATE_AVAILABLE");
    } catch {
      return false;
    }
  }).length;
  
  // 4️⃣ Consolidar por status de contrato
  const byStatus = allContracts.reduce((acc, c) => {
    const status = c.status || "rascunho";
    if (!acc[status]) acc[status] = 0;
    acc[status]++;
    return acc;
  }, {});
  
  // 5️⃣ Consolidar por moeda
  const byMoeda = snapshotsWithData.reduce((acc, { snapshot }) => {
    const currency = snapshot.currency || "BRL";
    if (!acc[currency]) {
      acc[currency] = { count: 0, saldo_total: 0 };
    }
    acc[currency].count++;
    acc[currency].saldo_total += snapshot.principal || 0;
    return acc;
  }, {});
  
  // Calcular governance score
  const governanceData = {
    integrity_fail: integrityFailCount,
    precision_fail: precisionFailCount,
    anatocism: anatocismCount,
    exchange_rate_risk: exchangeRiskCount,
    ptax_fallback: ptaxFallbackCount
  };
  
  const overviewData = {
    total_contracts: allContracts.length,
    with_snapshot: snapshotsWithData.length,
    without_snapshot: allContracts.length - snapshotsWithData.length,
    fallback_active: allContracts.filter(c => !c.current_snapshot_id && c.schedule_data).length
  };
  
  const governanceScore = calculateGovernanceScore(governanceData, overviewData);
  
  return {
    status: "SUCCESS",
    filters_applied: filters,
    query_timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - queryStart,
    
    // Governance Score (0-100)
    governance_score: governanceScore,
    
    // Estatísticas gerais
    overview: {
      ...overviewData,
      
      // Por status
      by_status: byStatus,
      
      // Por moeda
      by_currency: byMoeda
    },
    
    // Governança & Riscos
    governance: governanceData,
    
    // Snapshots mais recentes (últimos 5)
    recent_snapshots: snapshotsWithData
      .sort((a, b) => new Date(b.snapshot.created_date) - new Date(a.snapshot.created_date))
      .slice(0, 5)
      .map(({ snapshot, contract }) => ({
        contract_number: contract.contract_number,
        snapshot_id: snapshot.id,
        created_date: snapshot.created_date,
        trigger_event: snapshot.trigger_event,
        engine_version: snapshot.engine_version,
        calculation_hash_strict: snapshot.calculation_hash_strict.substring(0, 16) + "..."
      }))
  };
}

export default { getFinancialGovernanceStatus };