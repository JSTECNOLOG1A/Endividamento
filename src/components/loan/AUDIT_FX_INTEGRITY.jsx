/**
 * 🏦 AUDIT DE INTEGRIDADE PARA OPERAÇÕES EM MOEDA ESTRANGEIRA
 * 
 * Valida os 5 pontos críticos para USD/FX
 */

import { calculateAmortizationSchedule } from './CalculationEngine';
import { roundMoney } from './roundMoney';

/**
 * TESTE 1: Validação em Moeda Base
 * Confirma: Soma(amortizacao_usd) === principal_usd
 */
export function auditAmortizationInBaseCurrency(schedule, isUSD, principal) {
  if (!isUSD) return { passed: true, message: "BRL - não aplica" };

  let totalAmortizationUSD = 0;
  
  for (const row of schedule) {
    if (row.amortizacao_USD !== null) {
      totalAmortizationUSD += row.amortizacao_USD;
    }
  }

  const diff = Math.abs(totalAmortizationUSD - principal);
  const passed = diff <= 0.01;

  return {
    passed,
    totalAmortizationUSD: roundMoney(totalAmortizationUSD, 2),
    principal: roundMoney(principal, 2),
    diff: roundMoney(diff, 2),
    message: passed 
      ? `✅ VÁLIDO: Soma(amortizacao_usd) = ${totalAmortizationUSD.toFixed(2)} ≈ principal = ${principal.toFixed(2)}`
      : `❌ ERRO: Soma(amortizacao_usd) = ${totalAmortizationUSD.toFixed(2)} ≠ principal = ${principal.toFixed(2)}, diff = ${diff.toFixed(2)}`
  };
}

/**
 * TESTE 2: Validação de Não-Incorporação de Juros no Principal
 * Para BULLET: principal_usd permanece constante, juros_usd acumulam separadamente
 */
export function auditBulletJurosNotIncorporated(schedule, isUSD, calculationSystem, principal) {
  if (!isUSD || calculationSystem !== "BULLET") {
    return { passed: true, message: "Não BULLET USD - não aplica" };
  }

  const firstRow = schedule[0];
  const lastRow = schedule[schedule.length - 1];

  // Em BULLET, última linha deve ter amortizacao_USD = principal
  const lastAmortization = lastRow.amortizacao_USD || 0;
  const passed = Math.abs(lastAmortization - principal) <= 0.01;

  return {
    passed,
    lastAmortizationUSD: roundMoney(lastAmortization, 2),
    principal: roundMoney(principal, 2),
    message: passed
      ? `✅ VÁLIDO: BULLET paga exatamente principal (${lastAmortization.toFixed(2)} USD) no final`
      : `❌ ERRO: BULLET deveria pagar principal (${principal.toFixed(2)}) mas pagou (${lastAmortization.toFixed(2)})`
  };
}

/**
 * TESTE 3: Validação de Isolamento da Variação Cambial
 * Confirma: varCambial = saldoUSD * (ptaxAtual - ptaxAnterior)
 */
export function auditExchangeRateVariationIsolated(schedule, isUSD) {
  if (!isUSD) return { passed: true, message: "BRL - não aplica" };

  const errors = [];
  let allValid = true;

  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    
    if (row.ptax_rate === null) continue;
    
    // Calcular varCambial esperada
    const sdUSD = row.sdInicial_USD || 0;
    const ptaxCurrent = row.ptax_rate || 1;
    const ptaxPrev = i > 0 ? (schedule[i-1].ptax_rate || 1) : ptaxCurrent;
    
    const expectedVarCambial = roundMoney(sdUSD * (ptaxCurrent - ptaxPrev), 2);
    const reportedVarCambial = row.varCambial || 0;
    
    const diff = Math.abs(expectedVarCambial - reportedVarCambial);
    if (diff > 0.01) {
      allValid = false;
      errors.push({
        parcela: row.parcela,
        sdUSD: roundMoney(sdUSD, 2),
        ptaxPrev: roundMoney(ptaxPrev, 4),
        ptaxCurrent: roundMoney(ptaxCurrent, 4),
        expectedVarCambial: roundMoney(expectedVarCambial, 2),
        reportedVarCambial: roundMoney(reportedVarCambial, 2),
        diff: roundMoney(diff, 2)
      });
    }
  }

  return {
    passed: allValid,
    errorCount: errors.length,
    errors: errors.slice(0, 5), // Primeiros 5 erros
    message: allValid
      ? `✅ VÁLIDO: Todas as variações cambiais calculadas corretamente (varCambial = sdUSD * ΔptaxRate)`
      : `❌ ERRO: ${errors.length} linhas com variação cambial incorreta`
  };
}

/**
 * TESTE 4: Validação de Separação de Componentes
 * Confirma que existe separação clara: principal_usd, juros_usd, var_cambial
 */
export function auditComponentSeparation(schedule, isUSD) {
  if (!isUSD) return { passed: true, message: "BRL - não aplica" };

  const requiredFields = [
    'sdInicial_USD',      // Principal USD inicial
    'amortizacao_USD',    // Amortização USD
    'sdFinal_USD',        // Saldo final USD
    'varCambial',         // Variação cambial (isolada)
    'ptax_rate',          // Taxa PTAX (para auditoria)
    'jurosFixosMes',      // Juros fixos
    'jurosVariaveisMes'   // Juros variáveis
  ];

  const issues = [];
  
  for (let i = 0; i < Math.min(schedule.length, 3); i++) {
    const row = schedule[i];
    for (const field of requiredFields) {
      if (!(field in row)) {
        issues.push(`Parcela ${row.parcela}: Campo '${field}' faltando`);
      }
    }
  }

  const passed = issues.length === 0;

  return {
    passed,
    issueCount: issues.length,
    issues: issues.slice(0, 5),
    message: passed
      ? `✅ VÁLIDO: Separação completa de componentes (USD, juros, varCambial)`
      : `❌ ERRO: ${issues.length} campos faltando ou incorretos`
  };
}

/**
 * TESTE 5: VALIDAÇÃO CRÍTICA - PTAX Varia, Juros=0 → saldoUSD Constante
 * Se PTAX mudar mas juros forem zero, o saldo em USD não deve variar
 */
export async function auditPTAXVarianceWithZeroInterest() {
  // Parâmetros de teste: BULLET USD com juros=0 e PTAX variando
  const testParams = {
    operationValue: 10000000,       // 10M BRL
    amount_foreign: 1850000,        // ~1.85M USD (10M / 5.4)
    currencyId: "USD",
    exchangeLag: 1,
    fixedRate: 0,                   // CRÍTICO: Taxa zero
    indexer: "NA",                  // Sem indexador
    calculationSystem: "BULLET",
    totalTermMonths: 3,
    principalInstallments: 1,
    interestInstallments: 1,
    graceInterestBehavior: "CAPITALIZAR",
    operationDate: "2024-10-02",
    finalMaturityDate: "2025-01-02",
    
    // PTAX variando: 5.43, 5.80, 6.15
    exchangeRates: [
      { rate_date: "2024-10-02", ptax_rate: 5.43, source: "BCB" },
      { rate_date: "2024-11-02", ptax_rate: 5.80, source: "BCB" },
      { rate_date: "2024-12-02", ptax_rate: 5.90, source: "BCB" },
      { rate_date: "2025-01-02", ptax_rate: 6.15, source: "BCB" }
    ],
    cdiRates: []
  };

  const result = await calculateAmortizationSchedule(testParams);
  
  // Validação: saldoUSD deve ser constante (igual ao principal) até última parcela
  const saldoUSDValues = result.schedule
    .filter((_, i) => i < result.schedule.length - 1)  // Excluir última (tem amortização)
    .map(row => row.sdInicial_USD);

  const allEqual = saldoUSDValues.every(val => Math.abs(val - saldoUSDValues[0]) < 0.01);
  
  // Verificar que varCambial existe e BRL variou
  const varCambialTotal = result.schedule.reduce((sum, row) => sum + (row.varCambial || 0), 0);
  const hasVariation = Math.abs(varCambialTotal) > 0.01;

  return {
    passed: allEqual && hasVariation,
    testScenario: "BULLET USD com fixedRate=0, PTAX variando",
    saldoUSDConstant: allEqual,
    varCambialPresent: hasVariation,
    saldoUSDValues: saldoUSDValues.map(v => roundMoney(v, 2)),
    totalVarCambial: roundMoney(varCambialTotal, 2),
    message: (allEqual && hasVariation)
      ? `✅ VÁLIDO: saldoUSD constante, varCambial isolada (PTAX não afeta principal USD)`
      : `❌ ERRO: saldoUSD variou ou varCambial não calculada`
  };
}

/**
 * EXECUTA AUDIT COMPLETO
 */
export async function runCompleteAudit(schedule, isUSD, principal, calculationSystem) {
  console.log('🏦 INICIANDO AUDIT DE INTEGRIDADE FX\n');

  const results = {
    "1. Validação em Moeda Base": auditAmortizationInBaseCurrency(schedule, isUSD, principal),
    "2. BULLET Juros Não-Incorporados": auditBulletJurosNotIncorporated(schedule, isUSD, calculationSystem, principal),
    "3. Isolamento de Variação Cambial": auditExchangeRateVariationIsolated(schedule, isUSD),
    "4. Separação de Componentes": auditComponentSeparation(schedule, isUSD),
  };

  // Executar teste 5 apenas se USD
  if (isUSD) {
    try {
      results["5. PTAX Variance com Zero Interest"] = await auditPTAXVarianceWithZeroInterest();
    } catch (err) {
      results["5. PTAX Variance com Zero Interest"] = {
        passed: false,
        error: err.message
      };
    }
  }

  // Resumo
  const passedCount = Object.values(results).filter(r => r.passed).length;
  const totalCount = Object.keys(results).length;
  const allPassed = passedCount === totalCount;

  console.log('\n📊 RESULTADO DO AUDIT:');
  console.log(`${passedCount}/${totalCount} testes passaram\n`);

  Object.entries(results).forEach(([testName, testResult]) => {
    console.log(`${testResult.passed ? '✅' : '❌'} ${testName}`);
    console.log(`   ${testResult.message}\n`);
  });

  return {
    allPassed,
    passedCount,
    totalCount,
    details: results
  };
}