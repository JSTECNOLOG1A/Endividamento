/**
 * 🏦 VALIDAÇÃO DE INTEGRIDADE FINANCEIRA — PADRÃO BANCÁRIO
 * 
 * Valida fechamento exato do schedule na moeda base
 * Funciona com Decimal.js para precisão 8+ casas
 */

import { toDecimal, sum, isEqual, isValid, round, PRECISION_MODES } from './PrecisionLayer';

/**
 * RESULTADO DA VALIDAÇÃO
 */
export const VALIDATION_STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  WARNING: 'WARNING'
};

/**
 * Validação 1: Soma de amortizações = principal (na moeda base)
 */
export function validateAmortizationSum(schedule, principalBase) {
  const errors = [];
  
  // Acumular amortizações na moeda base
  const amortizacoes = schedule
    .filter(row => row.amortizacaoBase !== undefined && row.amortizacaoBase !== null)
    .map(row => toDecimal(row.amortizacaoBase));
  
  const totalAmortization = sum(amortizacoes);
  const principal = toDecimal(principalBase);
  
  const diff = totalAmortization.minus(principal).abs();
  const tolerance = toDecimal(0.01);  // 1 centavo
  
  const passed = diff.lte(tolerance);
  
  if (!passed) {
    errors.push({
      code: 'AMORTIZATION_MISMATCH',
      severity: 'CRITICAL',
      message: `Soma de amortizações não converge: ${totalAmortization.toString()} ≠ ${principal.toString()}, diff=${diff.toString()}`,
      details: {
        totalAmortization: totalAmortization.toString(),
        principal: principal.toString(),
        diff: diff.toString(),
        tolerance: tolerance.toString()
      }
    });
  }
  
  return {
    passed,
    totalAmortization: totalAmortization.toString(),
    principal: principal.toString(),
    diff: diff.toString(),
    errors
  };
}

/**
 * Validação 2: Saldo final = 0 (última parcela)
 */
export function validateFinalBalance(schedule) {
  const errors = [];
  
  if (!schedule || schedule.length === 0) {
    return {
      passed: false,
      finalBalance: null,
      errors: [{ code: 'EMPTY_SCHEDULE', severity: 'CRITICAL', message: 'Schedule vazio' }]
    };
  }
  
  const lastRow = schedule[schedule.length - 1];
  const finalBalance = toDecimal(lastRow.saldoFinalBase || lastRow.sdFinal_USD || lastRow.sdFinal || 0);
  
  const tolerance = toDecimal(0.01);
  const passed = finalBalance.abs().lte(tolerance);
  
  if (!passed) {
    errors.push({
      code: 'FINAL_BALANCE_NOT_ZERO',
      severity: 'CRITICAL',
      message: `Saldo final não é zero: ${finalBalance.toString()}`,
      details: {
        finalBalance: finalBalance.toString(),
        tolerance: tolerance.toString()
      }
    });
  }
  
  return {
    passed,
    finalBalance: finalBalance.toString(),
    errors
  };
}

/**
 * Validação 3: Nenhum saldo negativo indevido
 */
export function validateNoNegativeBalance(schedule) {
  const errors = [];
  const warnings = [];
  
  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    const saldoFinal = toDecimal(row.saldoFinalBase || row.sdFinal_USD || row.sdFinal || 0);
    
    // Última parcela permite -0.01 (arredondamento)
    const isLastRow = i === schedule.length - 1;
    const tolerance = isLastRow ? toDecimal(0.01) : toDecimal(0.001);
    
    if (saldoFinal.lt(tolerance.negated())) {
      errors.push({
        code: 'NEGATIVE_BALANCE',
        severity: 'CRITICAL',
        parcela: row.parcela,
        message: `Saldo negativo indevido na parcela ${row.parcela}: ${saldoFinal.toString()}`,
        details: {
          parcela: row.parcela,
          saldoFinal: saldoFinal.toString(),
          tolerance: tolerance.toString()
        }
      });
    }
  }
  
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    errors
  };
}

/**
 * Validação 4: Continuidade entre parcelas (SD Final [n-1] = SD Inicial [n])
 */
export function validateRowContinuity(schedule) {
  const errors = [];
  
  for (let i = 1; i < schedule.length; i++) {
    const prev = schedule[i - 1];
    const curr = schedule[i];
    
    const sdFinalPrev = toDecimal(prev.saldoFinalBase || prev.sdFinal_USD || prev.sdFinal || 0);
    const sdInicialCurr = toDecimal(curr.saldoInicialBase || curr.sdInicial_USD || curr.sdInicial || 0);
    
    const diff = sdFinalPrev.minus(sdInicialCurr).abs();
    const tolerance = toDecimal(0.01);
    
    if (diff.gt(tolerance)) {
      errors.push({
        code: 'CONTINUITY_BREAK',
        severity: 'CRITICAL',
        parcelas: [prev.parcela, curr.parcela],
        message: `Quebra de continuidade entre parcelas ${prev.parcela} e ${curr.parcela}`,
        details: {
          sdFinalPrev: sdFinalPrev.toString(),
          sdInicialCurr: sdInicialCurr.toString(),
          diff: diff.toString()
        }
      });
    }
  }
  
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    errors
  };
}

/**
 * Validação 5: Amortização ≤ Saldo (nunca amortiza mais que deve)
 */
export function validateAmortizationNotExceedBalance(schedule) {
  const errors = [];
  
  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    
    const sdInicial = toDecimal(row.saldoInicialBase || row.sdInicial_USD || row.sdInicial || 0);
    const amortizacao = toDecimal(row.amortizacaoBase || row.amortizacao_USD || row.amortizacao || 0);
    
    if (amortizacao.gt(sdInicial.plus(0.01))) {  // tolerância de 1 centavo
      errors.push({
        code: 'AMORTIZATION_EXCEEDS_BALANCE',
        severity: 'CRITICAL',
        parcela: row.parcela,
        message: `Amortização > saldo na parcela ${row.parcela}`,
        details: {
          parcela: row.parcela,
          saldoInicial: sdInicial.toString(),
          amortizacao: amortizacao.toString(),
          excess: amortizacao.minus(sdInicial).toString()
        }
      });
    }
  }
  
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    errors
  };
}

/**
 * Validação 6: Juros capitalizados apenas quando permitido
 * (regra de negócio: só com graceInterestBehavior === 'CAPITALIZAR')
 */
export function validateCapitalizationRules(schedule, graceInterestBehavior) {
  const errors = [];
  
  const shouldCapitalize = graceInterestBehavior === 'CAPITALIZAR';
  
  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    const jurosCapitalizados = toDecimal(row.jurosCapitalizadosBase || row.jurosCapitalizados || 0);
    
    // Se não deve capitalizar, jurosCapitalizados deve ser zero
    if (!shouldCapitalize && jurosCapitalizados.gt(0)) {
      errors.push({
        code: 'UNAUTHORIZED_CAPITALIZATION',
        severity: 'CRITICAL',
        parcela: row.parcela,
        message: `Juros capitalizados na parcela ${row.parcela}, mas graceInterestBehavior = ${graceInterestBehavior}`,
        details: {
          parcela: row.parcela,
          jurosCapitalizados: jurosCapitalizados.toString(),
          graceInterestBehavior
        }
      });
    }
  }
  
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    errors
  };
}

/**
 * Validação 7: Nenhum NaN ou Infinity
 */
export function validateNoInvalidNumbers(schedule) {
  const errors = [];
  
  const criticalFields = [
    'saldoInicialBase', 'saldoFinalBase', 'amortizacaoBase',
    'jurosFixosMes', 'jurosVariaveisMes', 'prestacaoBase'
  ];
  
  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    
    for (const field of criticalFields) {
      const value = row[field];
      if (value !== undefined && value !== null) {
        const d = toDecimal(value);
        if (!isValid(d)) {
          errors.push({
            code: 'INVALID_NUMBER',
            severity: 'CRITICAL',
            parcela: row.parcela,
            message: `Campo ${field} contém valor inválido na parcela ${row.parcela}: ${value}`,
            details: {
              parcela: row.parcela,
              field,
              value
            }
          });
        }
      }
    }
  }
  
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    errors
  };
}

/**
 * Validação 8: Isolamento de variação cambial (USD only)
 */
export function validateExchangeVariationIsolated(schedule, isUSD) {
  const errors = [];
  
  if (!isUSD) {
    return { passed: true, message: 'BRL - não aplica' };
  }
  
  for (let i = 1; i < schedule.length; i++) {
    const row = schedule[i];
    const prev = schedule[i - 1];
    
    if (!row.varCambial || !row.ptax_rate) continue;
    
    const sdUSD = toDecimal(prev.saldoFinalBase || prev.sdFinal_USD || 0);
    const ptaxPrev = toDecimal(prev.ptax_rate || 1);
    const ptaxCurr = toDecimal(row.ptax_rate || 1);
    
    const expectedVarCambial = sdUSD.times(ptaxCurr.minus(ptaxPrev));
    const reportedVarCambial = toDecimal(row.varCambial);
    
    const diff = expectedVarCambial.minus(reportedVarCambial).abs();
    const tolerance = toDecimal(0.01);
    
    if (diff.gt(tolerance)) {
      errors.push({
        code: 'FX_VARIATION_MISMATCH',
        severity: 'WARNING',
        parcela: row.parcela,
        message: `Variação cambial incorreta na parcela ${row.parcela}`,
        details: {
          parcela: row.parcela,
          expected: expectedVarCambial.toString(),
          reported: reportedVarCambial.toString(),
          diff: diff.toString()
        }
      });
    }
  }
  
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    errors
  };
}

/**
 * VALIDAÇÃO INTEGRAL (MASTER)
 * Executa todas as validações
 */
export function validateScheduleIntegrity(schedule, params = {}) {
  const {
    principalBase,
    isUSD = false,
    graceInterestBehavior = 'CAPITALIZAR',
    stopOnFirstError = false
  } = params;
  
  const allResults = {
    amortizationSum: validateAmortizationSum(schedule, principalBase),
    finalBalance: validateFinalBalance(schedule),
    negativeBalance: validateNoNegativeBalance(schedule),
    continuity: validateRowContinuity(schedule),
    amortizationNotExceed: validateAmortizationNotExceedBalance(schedule),
    capitalization: validateCapitalizationRules(schedule, graceInterestBehavior),
    noInvalidNumbers: validateNoInvalidNumbers(schedule),
    exchangeVariation: validateExchangeVariationIsolated(schedule, isUSD)
  };
  
  // Colecionar erros críticos
  const criticalErrors = [];
  const allWarnings = [];
  
  Object.entries(allResults).forEach(([test, result]) => {
    if (result.errors && result.errors.length > 0) {
      result.errors.forEach(err => {
        if (err.severity === 'CRITICAL') {
          criticalErrors.push({ test, ...err });
          if (stopOnFirstError) throw new Error(`[${test}] ${err.message}`);
        } else if (err.severity === 'WARNING') {
          allWarnings.push({ test, ...err });
        }
      });
    }
  });
  
  const overallPassed = criticalErrors.length === 0;
  
  return {
    passed: overallPassed,
    status: overallPassed ? VALIDATION_STATUS.PASS : VALIDATION_STATUS.FAIL,
    criticalErrorCount: criticalErrors.length,
    warningCount: allWarnings.length,
    criticalErrors: criticalErrors.slice(0, 10),  // Primeiros 10
    warnings: allWarnings.slice(0, 10),
    detailedResults: allResults,
    timestamp: new Date().toISOString(),
    summary: {
      amortizationOK: allResults.amortizationSum.passed,
      finalBalanceOK: allResults.finalBalance.passed,
      noNegativeOK: allResults.negativeBalance.passed,
      continuityOK: allResults.continuity.passed,
      amortizationBoundsOK: allResults.amortizationNotExceed.passed,
      capitalizationOK: allResults.capitalization.passed,
      numbersOK: allResults.noInvalidNumbers.passed,
      fxVariationOK: allResults.exchangeVariation.passed
    }
  };
}

export default {
  validateScheduleIntegrity,
  validateAmortizationSum,
  validateFinalBalance,
  validateNoNegativeBalance,
  validateRowContinuity,
  validateAmortizationNotExceedBalance,
  validateCapitalizationRules,
  validateNoInvalidNumbers,
  validateExchangeVariationIsolated,
  VALIDATION_STATUS
};