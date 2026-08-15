/**
 * 🔐 SNAPSHOT DE SEGURANÇA PARA VALIDAÇÃO DE REESTRUTURAÇÃO
 * 
 * PROPÓSITO:
 * Garantir que refatorações estruturais NÃO alterem resultados matemáticos.
 * 
 * REGRA ABSOLUTA:
 * Se qualquer valor crítico mudar → ROLLBACK IMEDIATO
 * 
 * CAMPOS IMUTÁVEIS:
 * - principal
 * - CET (cetAnnual)
 * - total juros USD
 * - total amortização USD
 * - sdFinal_USD (última parcela)
 * - schedule.length
 */

import { roundMoney } from "./roundMoney";

/**
 * Cria snapshot dos valores críticos ANTES da refatoração
 * 
 * ✅ SNAPSHOT USD-FIRST: valida apenas campos em USD (moeda base)
 * ❌ NÃO valida campos BRL (são apenas conversão/display)
 */
export function createCalculationSnapshot(result) {
  if (!result || !result.schedule || result.schedule.length === 0) {
    throw new Error("SNAPSHOT_ERROR: Resultado inválido para snapshot");
  }
  
  const schedule = result.schedule;
  const lastRow = schedule[schedule.length - 1];
  const isUSD = schedule.some(row => row.sdInicial_USD !== null && row.sdInicial_USD !== undefined);
  
  // 🔐 TOTAL AMORTIZAÇÃO USD (campo nativo do engine)
  const totalAmortizationUSD = schedule.reduce((sum, row) => {
    return sum + (row.amortizacao_USD || 0);
  }, 0);
  
  // 🔐 TOTAL JUROS USD (campo nativo do engine - STRICT)
  // REGRA: Para USD, EXIGIR campos nativos USD (não reconstruir dividindo BRL/PTAX)
  let totalInterestUSD;
  let interestSource = "UNKNOWN";
  let snapshotQuality = "STRICT";
  
  if (isUSD) {
    // Cenário 1: Engine expõe juros em USD nativamente (STRICT - obrigatório)
    if (schedule[0].jurosFixosMes_USD !== undefined || schedule[0].jurosTotal_USD !== undefined) {
      if (schedule[0].jurosTotal_USD !== undefined) {
        // Método preferencial: jurosTotal_USD direto
        totalInterestUSD = schedule.reduce((sum, row) => {
          return sum + (row.jurosTotal_USD || 0);
        }, 0);
        interestSource = "NATIVE_TOTAL";
      } else {
        // Método alternativo: somar fixos + variáveis em USD
        totalInterestUSD = schedule.reduce((sum, row) => {
          return sum + (row.jurosFixosMes_USD || 0) + (row.jurosVariaveisMes_USD || 0);
        }, 0);
        interestSource = "NATIVE_SPLIT";
      }
      snapshotQuality = "STRICT";
    } 
    // Cenário 2: DEGRADED - engine não expõe USD nativo (PROIBIDO)
    else {
      totalInterestUSD = schedule.reduce((sum, row) => {
        const ptax = row.ptax_rate || 1;
        const jurosFixosUSD = (row.jurosFixosMes || 0) / ptax;
        const jurosVariaveisUSD = (row.jurosVariaveisMes || 0) / ptax;
        return sum + jurosFixosUSD + jurosVariaveisUSD;
      }, 0);
      interestSource = "DEGRADED_BRL_PTAX";
      snapshotQuality = "DEGRADED";
      
      // 🚨 ALERTA CRÍTICO: Snapshot degradado não é confiável
      console.error(
        '🚨 SNAPSHOT DEGRADED: Engine não expõe juros USD nativos!\n' +
        'Campos esperados: jurosTotal_USD ou jurosFixosMes_USD/jurosVariaveisMes_USD\n' +
        'Snapshot está usando reconstrução BRL/PTAX (não confiável)'
      );
    }
  } else {
    // Operação BRL: juros já estão em BRL (moeda base)
    totalInterestUSD = schedule.reduce((sum, row) => {
      return sum + (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
    }, 0);
    interestSource = "BRL_NATIVE";
    snapshotQuality = "STRICT";
  }
  
  // 🔐 CALCULATION HASH (fingerprint determinístico do engine)
  const calculationHashStrict = result.calculation_metadata?.calculation_hash_strict || null;
  
  // 🔐 HASH DO SCHEDULE (campos USD críticos)
  const scheduleUSDHash = isUSD ? JSON.stringify(
    schedule.map(row => ({
      p: row.parcela,
      d: row.dataVencimento,
      si: roundMoney(row.sdInicial_USD || 0, 2),
      am: roundMoney(row.amortizacao_USD || 0, 2),
      pr: roundMoney(row.prestacao_USD || 0, 2),
      sf: roundMoney(row.sdFinal_USD || 0, 2)
    }))
  ) : null;
  
  const snapshot = {
    // Identificação
    timestamp: new Date().toISOString(),
    schedule_length: schedule.length,
    is_usd: isUSD,
    
    // 🔐 QUALIDADE DO SNAPSHOT
    snapshot_quality: snapshotQuality,
    interest_source: interestSource,
    
    // 🔐 VALORES CRÍTICOS (IMUTÁVEIS)
    principal: roundMoney(result.principal, 2),
    cet_annual: roundMoney(result.cetAnnual || result.cet, 2),
    total_interest_usd: roundMoney(totalInterestUSD, 2),
    total_amortization_usd: isUSD ? roundMoney(totalAmortizationUSD, 2) : null,
    sd_final_usd: isUSD ? roundMoney(lastRow.sdFinal_USD || 0, 2) : roundMoney(lastRow.sdFinal || 0, 2),
    
    // 🔐 HASHES (assinatura de integridade)
    calculation_hash_strict: calculationHashStrict,
    schedule_usd_hash: scheduleUSDHash,
    
    // Hash primeira/última parcela (USD)
    first_row_hash: isUSD ? JSON.stringify({
      parcela: schedule[0].parcela,
      dataVencimento: schedule[0].dataVencimento,
      sdInicial_USD: roundMoney(schedule[0].sdInicial_USD || 0, 2),
      amortizacao_USD: roundMoney(schedule[0].amortizacao_USD || 0, 2),
      sdFinal_USD: roundMoney(schedule[0].sdFinal_USD || 0, 2)
    }) : null,
    last_row_hash: isUSD ? JSON.stringify({
      parcela: lastRow.parcela,
      dataVencimento: lastRow.dataVencimento,
      sdInicial_USD: roundMoney(lastRow.sdInicial_USD || 0, 2),
      amortizacao_USD: roundMoney(lastRow.amortizacao_USD || 0, 2),
      sdFinal_USD: roundMoney(lastRow.sdFinal_USD || 0, 2)
    }) : null
  };
  
  console.log('📸 SNAPSHOT USD-FIRST CRIADO:', {
    quality: snapshotQuality,
    interest_source: interestSource,
    principal: snapshot.principal,
    cet: snapshot.cet_annual,
    total_interest: snapshot.total_interest_usd,
    total_amort: snapshot.total_amortization_usd,
    sd_final: snapshot.sd_final_usd
  });
  
  // ⚠️ ALERTA: Se não temos calculation_hash_strict
  if (!calculationHashStrict) {
    console.warn('⚠️ SNAPSHOT: calculation_hash_strict não disponível - validação menos robusta');
  }
  
  // 🚨 ERRO: Se snapshot DEGRADED para operação USD
  if (snapshotQuality === "DEGRADED") {
    const errorMsg = 
      '🚨 SNAPSHOT DEGRADED: Engine não expõe campos USD nativos!\n' +
      `Expected: jurosTotal_USD ou jurosFixosMes_USD/jurosVariaveisMes_USD\n` +
      `Found: apenas campos BRL (reconstrução via PTAX não é confiável)\n` +
      `Snapshot quality: ${snapshotQuality} | Interest source: ${interestSource}`;
    
    console.error(errorMsg);
    
    // Lançar warning HIGH (não bloqueia, mas alerta)
    snapshot._warning = {
      severity: "HIGH",
      message: "Snapshot degradado: juros USD reconstruídos via BRL/PTAX (não confiável)"
    };
  }
  
  return snapshot;
}

/**
 * Compara snapshot ANTES vs DEPOIS da refatoração
 * 
 * ✅ VALIDAÇÃO USD-FIRST: compara apenas campos imutáveis em moeda base
 * ❌ IGNORA campos BRL (são apenas conversão/display)
 * 
 * Retorna { valid: boolean, differences: array }
 */
export function compareSnapshots(before, after) {
  const tolerance = 0.01; // 1 centavo de tolerância (moeda base)
  const differences = [];
  
  // 🔐 VALIDAÇÃO 1: Schedule Length (estrutural)
  if (before.schedule_length !== after.schedule_length) {
    differences.push({
      field: "schedule_length",
      before: before.schedule_length,
      after: after.schedule_length,
      severity: "CRITICAL",
      message: "Número de parcelas alterado"
    });
  }
  
  // 🔐 VALIDAÇÃO 2: Principal (moeda base)
  const principalDiff = Math.abs(before.principal - after.principal);
  if (principalDiff > tolerance) {
    differences.push({
      field: "principal",
      before: before.principal,
      after: after.principal,
      diff: principalDiff,
      severity: "CRITICAL",
      message: `Principal alterado: ${principalDiff.toFixed(2)}`
    });
  }
  
  // 🔐 VALIDAÇÃO 3: CET (custo efetivo total)
  const cetDiff = Math.abs(before.cet_annual - after.cet_annual);
  if (cetDiff > tolerance) {
    differences.push({
      field: "cet_annual",
      before: before.cet_annual,
      after: after.cet_annual,
      diff: cetDiff,
      severity: "CRITICAL",
      message: `CET alterado: ${cetDiff.toFixed(2)}pp`
    });
  }
  
  // 🔐 VALIDAÇÃO 4: Total Juros USD (moeda base)
  const interestDiff = Math.abs(before.total_interest_usd - after.total_interest_usd);
  if (interestDiff > tolerance) {
    differences.push({
      field: "total_interest_usd",
      before: before.total_interest_usd,
      after: after.total_interest_usd,
      diff: interestDiff,
      severity: "CRITICAL",
      message: `Total de juros (moeda base) alterado: ${interestDiff.toFixed(2)}`
    });
  }
  
  // 🔐 VALIDAÇÃO 5: Total Amortização USD (moeda base, se USD)
  if (before.is_usd && after.is_usd && before.total_amortization_usd !== null && after.total_amortization_usd !== null) {
    const amortDiff = Math.abs(before.total_amortization_usd - after.total_amortization_usd);
    if (amortDiff > tolerance) {
      differences.push({
        field: "total_amortization_usd",
        before: before.total_amortization_usd,
        after: after.total_amortization_usd,
        diff: amortDiff,
        severity: "CRITICAL",
        message: `Total amortização USD alterado: ${amortDiff.toFixed(2)}`
      });
    }
  }
  
  // 🔐 VALIDAÇÃO 6: SD Final (moeda base)
  const sdFinalDiff = Math.abs(before.sd_final_usd - after.sd_final_usd);
  if (sdFinalDiff > tolerance) {
    differences.push({
      field: "sd_final_usd",
      before: before.sd_final_usd,
      after: after.sd_final_usd,
      diff: sdFinalDiff,
      severity: "CRITICAL",
      message: `Saldo final (moeda base) alterado: ${sdFinalDiff.toFixed(2)}`
    });
  }
  
  // 🔐 VALIDAÇÃO 7: Calculation Hash Strict (fingerprint de inputs)
  if (before.calculation_hash_strict && after.calculation_hash_strict) {
    if (before.calculation_hash_strict !== after.calculation_hash_strict) {
      differences.push({
        field: "calculation_hash_strict",
        before: before.calculation_hash_strict,
        after: after.calculation_hash_strict,
        severity: "CRITICAL",
        message: "Hash de cálculo alterado (inputs mudaram)"
      });
    }
  }
  
  // 🔐 VALIDAÇÃO 8: Schedule USD Hash (assinatura completa do schedule) - CRITICAL
  if (before.is_usd && after.is_usd && before.schedule_usd_hash && after.schedule_usd_hash) {
    if (before.schedule_usd_hash !== after.schedule_usd_hash) {
      differences.push({
        field: "schedule_usd_hash",
        before: before.schedule_usd_hash?.substring(0, 16) + "...",
        after: after.schedule_usd_hash?.substring(0, 16) + "...",
        severity: "CRITICAL",
        message: "Schedule USD alterado (valores em USD mudaram) - hash completo diverge"
      });
    }
  }
  
  // 🔐 VALIDAÇÃO 9: Hash primeira parcela USD
  if (before.first_row_hash && after.first_row_hash && before.first_row_hash !== after.first_row_hash) {
    differences.push({
      field: "first_row_hash",
      before: before.first_row_hash,
      after: after.first_row_hash,
      severity: "HIGH",
      message: "Primeira parcela USD alterada"
    });
  }
  
  // 🔐 VALIDAÇÃO 10: Hash última parcela USD
  if (before.last_row_hash && after.last_row_hash && before.last_row_hash !== after.last_row_hash) {
    differences.push({
      field: "last_row_hash",
      before: before.last_row_hash,
      after: after.last_row_hash,
      severity: "HIGH",
      message: "Última parcela USD alterada"
    });
  }
  
  const isValid = differences.filter(d => d.severity === "CRITICAL").length === 0;
  const hasCritical = differences.some(d => d.severity === "CRITICAL");
  const hasHigh = differences.some(d => d.severity === "HIGH");
  
  // 🔐 VALIDAÇÃO EXTRA: Snapshot Quality Degradation
  if (before.snapshot_quality === "STRICT" && after.snapshot_quality === "DEGRADED") {
    differences.push({
      field: "snapshot_quality",
      before: before.snapshot_quality,
      after: after.snapshot_quality,
      severity: "HIGH",
      message: "Qualidade do snapshot degradou (STRICT → DEGRADED)"
    });
  }
  
  if (before.interest_source !== after.interest_source) {
    differences.push({
      field: "interest_source",
      before: before.interest_source,
      after: after.interest_source,
      severity: "HIGH",
      message: "Fonte de cálculo de juros mudou"
    });
  }
  
  if (hasCritical) {
    console.error('🚨 SNAPSHOT VALIDATION FAILED (CRITICAL):', differences.filter(d => d.severity === "CRITICAL"));
  } else if (hasHigh) {
    console.warn('⚠️ SNAPSHOT VALIDATION: Divergências HIGH detectadas:', differences.filter(d => d.severity === "HIGH"));
  } else if (differences.length > 0) {
    console.warn('⚠️ SNAPSHOT VALIDATION: Divergências menores detectadas:', differences);
  } else {
    console.log('✅ SNAPSHOT VALIDATION PASSED: Cálculos USD preservados');
  }
  
  return {
    valid: isValid,
    differences,
    critical_count: differences.filter(d => d.severity === "CRITICAL").length,
    high_count: differences.filter(d => d.severity === "HIGH").length,
    snapshot_quality_before: before.snapshot_quality,
    snapshot_quality_after: after.snapshot_quality,
    interest_source_before: before.interest_source,
    interest_source_after: after.interest_source,
    summary: isValid 
      ? "✅ Validação aprovada: cálculos USD preservados (campos BRL ignorados)"
      : `❌ FALHA CRÍTICA: ${differences.filter(d => d.severity === "CRITICAL").length} divergências críticas detectadas`
  };
}

/**
 * Valida integridade interna de um resultado (sanity check)
 */
export function validateResultIntegrity(result) {
  const errors = [];
  
  if (!result) {
    errors.push("Resultado é null ou undefined");
    return { valid: false, errors };
  }
  
  if (!result.schedule || !Array.isArray(result.schedule)) {
    errors.push("Schedule inválido ou não é array");
    return { valid: false, errors };
  }
  
  if (result.schedule.length === 0) {
    errors.push("Schedule vazio");
    return { valid: false, errors };
  }
  
  // Verificar campos críticos
  if (!Number.isFinite(result.principal) || result.principal <= 0) {
    errors.push(`Principal inválido: ${result.principal}`);
  }
  
  if (!Number.isFinite(result.cetAnnual) && !Number.isFinite(result.cet)) {
    errors.push("CET inválido");
  }
  
  // Verificar última parcela
  const lastRow = result.schedule[result.schedule.length - 1];
  if (lastRow.sdFinal_USD !== undefined && lastRow.sdFinal_USD !== null) {
    if (Math.abs(lastRow.sdFinal_USD) > 0.01) {
      errors.push(`Saldo final USD não é zero: ${lastRow.sdFinal_USD}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Wrapper de segurança para executar refatoração com validação automática
 */
export async function safeRefactor(beforeResult, refactorFn) {
  // FASE 0.1: Validar resultado inicial
  const initialCheck = validateResultIntegrity(beforeResult);
  if (!initialCheck.valid) {
    throw new Error(`SNAPSHOT_ERROR: Resultado inicial inválido: ${initialCheck.errors.join(", ")}`);
  }
  
  // FASE 0.2: Criar snapshot ANTES
  const snapshotBefore = createCalculationSnapshot(beforeResult);
  
  // FASE 0.3: Executar refatoração
  let afterResult;
  try {
    afterResult = await refactorFn();
  } catch (error) {
    console.error('🚨 REFACTOR FAILED:', error);
    throw new Error(`REFACTOR_ERROR: ${error.message}`);
  }
  
  // FASE 0.4: Validar resultado final
  const finalCheck = validateResultIntegrity(afterResult);
  if (!finalCheck.valid) {
    throw new Error(`SNAPSHOT_ERROR: Resultado final inválido: ${finalCheck.errors.join(", ")}`);
  }
  
  // FASE 0.5: Criar snapshot DEPOIS
  const snapshotAfter = createCalculationSnapshot(afterResult);
  
  // FASE 0.6: Comparar snapshots
  const comparison = compareSnapshots(snapshotBefore, snapshotAfter);
  
  if (!comparison.valid) {
    throw new Error(
      `SNAPSHOT_VALIDATION_FAILED: Refatoração alterou cálculos!\n\n` +
      `Diferenças detectadas:\n${comparison.differences.map(d => 
        `- ${d.field}: ${d.before} → ${d.after} (diff: ${d.diff || 'N/A'})`
      ).join('\n')}`
    );
  }
  
  return {
    result: afterResult,
    snapshot_before: snapshotBefore,
    snapshot_after: snapshotAfter,
    validation: comparison
  };
}