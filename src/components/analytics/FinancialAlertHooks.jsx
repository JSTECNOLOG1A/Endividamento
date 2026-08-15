/**
 * 🔐 FINANCIAL ALERT HOOKS — ETAPA 4C (HARDENED)
 * 
 * Gera eventos de alerta sem bloquear cálculos
 * Detecta: INTEGRITY_FAIL, PRECISION_FAIL, SNAPSHOT_FALLBACK
 * 
 * HARDENING:
 * - Deduplicação por contrato+flag (janela 24h)
 * 
 * NÃO BLOQUEIA: Apenas loga e retorna flags
 * SEM PII: Apenas contract_number, hash, engine_version
 */

/**
 * 🔐 DEDUPLICATION CACHE (in-memory, janela 24h)
 */
const alertCache = new Map(); // key: "contract_number:flag"
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Verifica se alerta é duplicado (janela 24h)
 * @param {string} contractNumber - Número do contrato
 * @param {string} flag - Flag do alerta
 * @returns {boolean} True se duplicado
 */
function isDuplicateAlert(contractNumber, flag) {
  const key = `${contractNumber}:${flag}`;
  const cached = alertCache.get(key);
  
  if (!cached) return false;
  
  const now = Date.now();
  const elapsed = now - cached.timestamp;
  
  // Se passou da janela, limpar cache
  if (elapsed > DEDUP_WINDOW_MS) {
    alertCache.delete(key);
    return false;
  }
  
  return true;
}

/**
 * Registra alerta no cache
 * @param {string} contractNumber - Número do contrato
 * @param {string} flag - Flag do alerta
 */
function cacheAlert(contractNumber, flag) {
  const key = `${contractNumber}:${flag}`;
  alertCache.set(key, { timestamp: Date.now() });
}

/**
 * Detecta eventos de alerta em um snapshot/result
 * @param {Object} snapshot - CalculationSnapshot do banco
 * @param {Object} result - Output de calculateAmortizationSchedule() (opcional)
 * @param {Object} contract - Contrato relacionado
 * @returns {Object} Eventos de alerta
 */
export function detectFinancialAlerts(snapshot, result = null, contract = {}) {
  const alerts = [];
  const deduped = [];
  const timestamp = new Date().toISOString();
  const contractNumber = contract.contract_number || snapshot?.contract_number || "UNKNOWN";
  
  // 🔐 ALERT 1: INTEGRITY_FAIL
  if (result?.integrity?.status === "FAIL") {
    if (isDuplicateAlert(contractNumber, "INTEGRITY_FAIL")) {
      deduped.push("INTEGRITY_FAIL");
    } else {
      alerts.push({
        type: "FINANCIAL_ENGINE_ALERT",
        severity: "CRITICAL",
        flag: "INTEGRITY_FAIL",
        message: "Validação de integridade financeira falhou",
        contract_number: contractNumber,
        snapshot_id: snapshot?.id || null,
        calculation_hash_strict: snapshot?.calculation_hash_strict || result?.calculation_metadata?.calculation_hash_strict,
        engine_version: snapshot?.engine_version || result?.calculation_metadata?.engine_version,
        timestamp: timestamp,
        details: result.integrity.summary?.message || "N/A"
      });
      cacheAlert(contractNumber, "INTEGRITY_FAIL");
    }
  }
  
  // 🔐 ALERT 2: INTEGRITY_FAIL (do snapshot armazenado)
  if (snapshot && snapshot.risk_flags_snapshot) {
    try {
      const riskFlags = JSON.parse(snapshot.risk_flags_snapshot);
      const integrityFlag = riskFlags.find(f => f.flag === "INTEGRITY_FAIL");
      
      if (integrityFlag && !isDuplicateAlert(contractNumber, "INTEGRITY_FAIL_SNAPSHOT")) {
        alerts.push({
          type: "FINANCIAL_ENGINE_ALERT",
          severity: "CRITICAL",
          flag: "INTEGRITY_FAIL",
          message: "Snapshot contém flag de integridade falha",
          contract_number: contractNumber,
          snapshot_id: snapshot.id,
          calculation_hash_strict: snapshot.calculation_hash_strict,
          engine_version: snapshot.engine_version,
          timestamp: timestamp,
          details: integrityFlag.message
        });
        cacheAlert(contractNumber, "INTEGRITY_FAIL_SNAPSHOT");
      } else if (integrityFlag) {
        deduped.push("INTEGRITY_FAIL_SNAPSHOT");
      }
    } catch (e) {
      console.warn("Erro ao parsear risk_flags_snapshot:", e.message);
    }
  }
  
  // 🔐 ALERT 3: PRECISION_FAIL
  if (result?.precision_governance?.status === "FAIL") {
    if (isDuplicateAlert(contractNumber, "PRECISION_FAIL")) {
      deduped.push("PRECISION_FAIL");
    } else {
      alerts.push({
        type: "FINANCIAL_ENGINE_ALERT",
        severity: "HIGH",
        flag: "PRECISION_FAIL",
        message: "Validação de precisão falhou",
        contract_number: contractNumber,
        snapshot_id: snapshot?.id || null,
        calculation_hash_strict: snapshot?.calculation_hash_strict || result?.calculation_metadata?.calculation_hash_strict,
        engine_version: snapshot?.engine_version || result?.calculation_metadata?.engine_version,
        timestamp: timestamp,
        details: result.precision_governance.notes?.[0] || "N/A"
      });
      cacheAlert(contractNumber, "PRECISION_FAIL");
    }
  }
  
  // 🔐 ALERT 4: PRECISION_FAIL (do snapshot)
  if (snapshot && snapshot.risk_flags_snapshot) {
    try {
      const riskFlags = JSON.parse(snapshot.risk_flags_snapshot);
      const precisionFlag = riskFlags.find(f => f.flag === "PRECISION_FAIL");
      
      if (precisionFlag && !isDuplicateAlert(contractNumber, "PRECISION_FAIL_SNAPSHOT")) {
        alerts.push({
          type: "FINANCIAL_ENGINE_ALERT",
          severity: "HIGH",
          flag: "PRECISION_FAIL",
          message: "Snapshot contém flag de precisão falha",
          contract_number: contractNumber,
          snapshot_id: snapshot.id,
          calculation_hash_strict: snapshot.calculation_hash_strict,
          engine_version: snapshot.engine_version,
          timestamp: timestamp,
          details: precisionFlag.message
        });
        cacheAlert(contractNumber, "PRECISION_FAIL_SNAPSHOT");
      } else if (precisionFlag) {
        deduped.push("PRECISION_FAIL_SNAPSHOT");
      }
    } catch (e) {
      console.warn("Erro ao parsear risk_flags_snapshot:", e.message);
    }
  }
  
  // 🔐 ALERT 5: SNAPSHOT_FALLBACK
  if (contract.status === "aprovado" && !contract.current_snapshot_id && contract.schedule_data) {
    if (isDuplicateAlert(contractNumber, "SNAPSHOT_FALLBACK")) {
      deduped.push("SNAPSHOT_FALLBACK");
    } else {
      alerts.push({
        type: "FINANCIAL_ENGINE_ALERT",
        severity: "MEDIUM",
        flag: "SNAPSHOT_FALLBACK",
        message: "Contrato aprovado usando fallback SCHEDULE_DATA",
        contract_number: contractNumber,
        snapshot_id: null,
        calculation_hash_strict: null,
        engine_version: null,
        timestamp: timestamp,
        details: "Snapshot ausente, usando schedule_data (retrocompatibilidade)"
      });
      cacheAlert(contractNumber, "SNAPSHOT_FALLBACK");
    }
  }
  
  return {
    alerts_count: alerts.length,
    alerts: alerts,
    deduped_count: deduped.length,
    deduped_flags: deduped,
    has_critical: alerts.some(a => a.severity === "CRITICAL"),
    has_warnings: alerts.some(a => a.severity === "HIGH" || a.severity === "MEDIUM")
  };
}

/**
 * Loga alertas (não bloqueante)
 * @param {Array} alerts - Array de alertas
 */
export function logFinancialAlerts(alerts) {
  if (!alerts || alerts.length === 0) {
    return;
  }
  
  console.log(`\n🚨 ===== FINANCIAL ENGINE ALERTS (${alerts.length}) =====\n`);
  
  alerts.forEach((alert, idx) => {
    const emoji = alert.severity === "CRITICAL" ? "🔴" : alert.severity === "HIGH" ? "🟠" : "🟡";
    console.log(`${emoji} Alert ${idx + 1}/${alerts.length}: ${alert.flag}`);
    console.log(`   Contract: ${alert.contract_number}`);
    console.log(`   Message: ${alert.message}`);
    console.log(`   Snapshot ID: ${alert.snapshot_id || "N/A"}`);
    console.log(`   Hash: ${alert.calculation_hash_strict?.substring(0, 16) || "N/A"}...`);
    console.log(`   Engine: ${alert.engine_version || "N/A"}`);
    console.log(`   Timestamp: ${alert.timestamp}`);
    if (alert.details) {
      console.log(`   Details: ${alert.details}`);
    }
    console.log("");
  });
  
  console.log("========================================\n");
}

/**
 * Verifica se deve gerar evento de alerta
 * @param {Object} snapshot - CalculationSnapshot
 * @param {Object} result - Output de calculateAmortizationSchedule() (opcional)
 * @param {Object} contract - Contrato relacionado
 * @returns {boolean} True se deve alertar
 */
export function shouldTriggerAlert(snapshot, result = null, contract = {}) {
  const alerts = detectFinancialAlerts(snapshot, result, contract);
  return alerts.alerts_count > 0;
}

export default {
  detectFinancialAlerts,
  logFinancialAlerts,
  shouldTriggerAlert
};