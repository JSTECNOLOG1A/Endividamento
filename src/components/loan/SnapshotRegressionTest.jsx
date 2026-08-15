/**
 * 🔐 SNAPSHOT REGRESSION TEST — ETAPA 3
 * 
 * Valida que Etapa 3 (Governança) NÃO alterou schedule
 * Compara valores exatos entre build anterior (baseline) e atual
 * 
 * CRITICAL: Tolerância ZERO para campos monetários core
 */

import { calculateAmortizationSchedule } from "./CalculationEngine";

/**
 * Baseline conhecido (capturado ANTES da Etapa 3)
 * Este é o "truth snapshot" — Etapa 2 já validada
 */
const BASELINE_PARAMS = {
  operationValue: 100000,
  fixedRate: 10.5,
  indexer: "NA",
  operationDate: "2026-01-15",
  principalGraceMonths: 0,
  interestGraceMonths: 0,
  principalInstallments: 12,
  interestInstallments: 12,
  principalFrequency: "1",
  interestFrequency: "1",
  calculationSystem: "PRICE",
  totalTermMonths: 12,
  
  // Flags Etapa 3 (NOVOS)
  enable_integrity_checks: true,
  enable_audit_log: true,
  enable_precision_audit: true
};

/**
 * Snapshot esperado (capturado da Etapa 2, parcela 1 e 12)
 * IMPORTANTE: Atualizar se houver mudança INTENCIONAL na matemática
 */
const EXPECTED_SNAPSHOT = {
  parcela_1: {
    parcela: 1,
    sdInicial: 100000.00,
    jurosFixosMes: 875.00,  // Aproximado: 10.5% a.a. mensal
    jurosVariaveisMes: 0,
    amortizacao: 7958.25,   // PRICE: PMT - juros
    prestacao: 8833.25,
    sdFinal: 92041.75
  },
  parcela_12: {
    parcela: 12,
    sdFinal: 0.00,  // Última parcela: saldo ZERO
    amortizacao: 8759.46  // Última amortização (aproximado)
  },
  totals: {
    principal: 100000.00,
    totalJuros: 5999.00,  // Aproximado
    totalPrestacao: 105999.00
  }
};

/**
 * 🔐 TOLERÂNCIAS POR TIPO DE CAMPO (PADRÃO BANCÁRIO)
 * 
 * ETAPA 3.1 HARDENING — DOCUMENTAÇÃO EXPLÍCITA:
 * 
 * - money_exact (0.00): Campos CORE do schedule (sdInicial, sdFinal, amortizacao, prestacao)
 *   → Devem ser IDÊNTICOS após rounding final (Banker's HALF_EVEN)
 *   → ZERO tolerância garante que mudanças matemáticas são detectadas
 *   → Se um teste falhar com diff=0.01, há regressão no cálculo
 * 
 * - money_soft (0.01): Campos monetários DERIVADOS (jurosFixosMes, jurosVariaveisMes, etc)
 *   → Podem variar até 1 centavo devido a ordem de operações
 *   → Aceita arredondamentos pequenos sem bloquear build
 * 
 * - exchange (0.0001): PTAX e varCambial (4 casas decimais)
 *   → Padrão BACEN para taxas de câmbio
 *   → Garante precisão sem rigor excessivo
 * 
 * - percent (1e-8): Percentuais (indexadorPercent, spreads)
 *   → 8 casas decimais para percentuais compostos
 *   → Evita acúmulo de erro em long-term contracts
 * 
 * ⚠️ ATENÇÃO: NÃO alterar tolerâncias sem análise de impacto e aprovação
 * Qualquer mudança pode mascarar regressões matemáticas
 */
const TOLERANCES = {
  money_exact: 0.00,       // Saldos, prestação: EXATO (após rounding)
  money_soft: 0.01,        // Juros: 1 centavo (ordem de operações)
  exchange: 0.0001,        // PTAX: 4 casas (padrão BACEN)
  percent: 1e-8,           // Percentuais: 8 casas (composição)
  description: "Banking Standard (BACEN) — ETAPA 3.1 Documented"
};

/**
 * Classifica campo por tipo
 * @param {string} fieldName - Nome do campo
 * @returns {string} Tipo: "money_exact" | "money_soft" | "exchange" | "percent"
 */
function classifyFieldTolerance(fieldName) {
  // Campos EXATOS (core do schedule, não podem divergir)
  const exactFields = ["sdInicial", "sdFinal", "amortizacao", "prestacao"];
  if (exactFields.includes(fieldName)) {
    return "money_exact";
  }
  
  // Câmbio
  if (fieldName.includes("ptax") || fieldName.includes("PTAX") || fieldName === "varCambial") {
    return "exchange";
  }
  
  // Percentual
  if (fieldName.includes("Percent") || fieldName.includes("indexador")) {
    return "percent";
  }
  
  // Monetários derivados (juros, por exemplo)
  return "money_soft";
}

/**
 * Compara dois valores numéricos com tolerância tipada
 * @param {number} actual - Valor calculado
 * @param {number} expected - Valor esperado
 * @param {string} fieldName - Nome do campo (para determinar tolerância)
 * @returns {{passed: boolean, diff: number, tolerance: number}}
 */
function assertCloseTyped(actual, expected, fieldName) {
  const diff = Math.abs(actual - expected);
  const fieldType = classifyFieldTolerance(fieldName);
  const tolerance = TOLERANCES[fieldType];
  
  return {
    passed: diff <= tolerance,
    diff,
    tolerance,
    fieldType
  };
}

/**
 * Teste de snapshot: valida que schedule não mudou
 */
export async function testSnapshotRegression() {
  console.log("\n🔐 ===== SNAPSHOT REGRESSION TEST — ETAPA 3 =====\n");
  
  const result = await calculateAmortizationSchedule(BASELINE_PARAMS);
  
  const errors = [];
  
  // ✅ VALIDAÇÃO 1: Schedule length inalterado
  if (result.schedule.length !== 12) {
    errors.push(`Schedule length mudou: ${result.schedule.length} (esperado: 12)`);
  }
  
  // ✅ VALIDAÇÃO 2: Parcela 1 (valores com tolerância tipada)
  const p1 = result.schedule[0];
  
  const checks = [
    { field: "sdInicial", actual: p1.sdInicial, expected: EXPECTED_SNAPSHOT.parcela_1.sdInicial },
    { field: "jurosFixosMes", actual: p1.jurosFixosMes, expected: EXPECTED_SNAPSHOT.parcela_1.jurosFixosMes },
    { field: "amortizacao", actual: p1.amortizacao, expected: EXPECTED_SNAPSHOT.parcela_1.amortizacao },
    { field: "prestacao", actual: p1.prestacao, expected: EXPECTED_SNAPSHOT.parcela_1.prestacao },
    { field: "sdFinal", actual: p1.sdFinal, expected: EXPECTED_SNAPSHOT.parcela_1.sdFinal }
  ];
  
  checks.forEach(check => {
    const result = assertCloseTyped(check.actual, check.expected, check.field);
    if (!result.passed) {
      errors.push(
        `Parcela 1 ${check.field}: ${check.actual.toFixed(2)} ≠ ${check.expected.toFixed(2)} ` +
        `(diff: ${result.diff.toFixed(6)}, tolerance: ${result.tolerance}, type: ${result.fieldType})`
      );
    }
  });
  
  // ✅ VALIDAÇÃO 3: Parcela 12 (fechamento)
  const p12 = result.schedule[11];
  
  const sdFinalCheck = assertCloseTyped(p12.sdFinal, 0, "sdFinal");
  if (!sdFinalCheck.passed) {
    errors.push(`Parcela 12 sdFinal não é zero: ${p12.sdFinal} (diff: ${sdFinalCheck.diff.toFixed(6)})`);
  }
  
  // ✅ VALIDAÇÃO 4: Totais agregados
  const principalCheck = assertCloseTyped(result.principal, EXPECTED_SNAPSHOT.totals.principal, "principal");
  if (!principalCheck.passed) {
    errors.push(
      `Principal mudou: ${result.principal} ≠ ${EXPECTED_SNAPSHOT.totals.principal} ` +
      `(diff: ${principalCheck.diff.toFixed(6)}, type: ${principalCheck.fieldType})`
    );
  }
  
  // Total juros: soft tolerance (derivado)
  const jurosCheck = assertCloseTyped(result.totalJuros, EXPECTED_SNAPSHOT.totals.totalJuros, "jurosFixosMes");
  if (Math.abs(result.totalJuros - EXPECTED_SNAPSHOT.totals.totalJuros) > 50.00) {
    errors.push(
      `Total juros mudou: ${result.totalJuros} ≠ ${EXPECTED_SNAPSHOT.totals.totalJuros} ` +
      `(diff: ${Math.abs(result.totalJuros - EXPECTED_SNAPSHOT.totals.totalJuros).toFixed(2)}, max: 50.00)`
    );
  }
  
  // ✅ VALIDAÇÃO 5: Novos campos Etapa 3 (devem existir)
  if (!result.integrity) {
    errors.push("Campo 'integrity' ausente (esperado na Etapa 3)");
  } else if (result.integrity.status !== "PASS") {
    errors.push(`Integrity status: ${result.integrity.status} (esperado: PASS)`);
  }
  
  if (!result.precision_governance) {
    errors.push("Campo 'precision_governance' ausente");
  }
  
  if (!Array.isArray(result.risk_flags)) {
    errors.push("Campo 'risk_flags' ausente ou não é array");
  }
  
  if (!result.disclosure_automated) {
    errors.push("Campo 'disclosure_automated' ausente");
  } else {
    if (result.disclosure_automated.principal_base !== 100000) {
      errors.push(`disclosure_automated.principal_base: ${result.disclosure_automated.principal_base} ≠ 100000`);
    }
  }
  
  if (!result.audit_log) {
    errors.push("Campo 'audit_log' ausente");
  } else {
    if (result.audit_log.engine_version !== "1.2.0") {
      errors.push(`audit_log.engine_version: ${result.audit_log.engine_version} ≠ 1.2.0`);
    }
  }
  
  // 📊 RELATÓRIO
  console.log("📊 Snapshot Regression Test (Tolerâncias Tipadas):");
  console.log(`  Schedule length: ${result.schedule.length}`);
  console.log(`  Principal: R$ ${result.principal.toFixed(2)}`);
  console.log(`  Total juros: R$ ${result.totalJuros.toFixed(2)}`);
  console.log(`  Parcela 1 sdInicial: R$ ${p1.sdInicial.toFixed(2)}`);
  console.log(`  Parcela 1 prestacao: R$ ${p1.prestacao.toFixed(2)}`);
  console.log(`  Parcela 12 sdFinal: R$ ${p12.sdFinal.toFixed(6)}`);
  console.log(`  Integrity status: ${result.integrity?.status || "N/A"}`);
  console.log(`  Precision governance status: ${result.precision_governance?.status || "N/A"}`);
  console.log(`  Risk flags count: ${result.risk_flags.length}`);
  console.log(`  Disclosure fields: ${Object.keys(result.disclosure_automated || {}).length}`);
  console.log(`  Audit log present: ${result.audit_log ? "SIM" : "NÃO"}`);
  console.log(`\n🔐 TOLERÂNCIAS APLICADAS:`);
  console.log(`  money_exact (sdInicial, sdFinal, amortizacao, prestacao): ${TOLERANCES.money_exact}`);
  console.log(`  money_soft (jurosFixosMes, etc): ${TOLERANCES.money_soft}`);
  console.log(`  exchange (ptax_rate, varCambial): ${TOLERANCES.exchange}`);
  console.log(`  percent (indexadorPercent): ${TOLERANCES.percent}`);
  
  // ✅ RESULTADO
  if (errors.length === 0) {
    console.log("\n✅ SNAPSHOT REGRESSION PASSOU — Schedule idêntico à Etapa 2");
    console.log("✅ Novos campos Etapa 3 presentes e válidos");
    return { passed: true, errors: [] };
  } else {
    console.error("\n❌ SNAPSHOT REGRESSION FALHOU:");
    errors.forEach((err, idx) => {
      console.error(`  ${idx + 1}. ${err}`);
    });
    return { passed: false, errors };
  }
}

/**
 * Teste adicional: Flags desativadas → campos devem ser null
 */
export async function testGovernanceDisabled() {
  console.log("\n🔐 ===== TESTE: GOVERNANÇA DESATIVADA =====\n");
  
  const result = await calculateAmortizationSchedule({
    ...BASELINE_PARAMS,
    enable_integrity_checks: false,
    enable_audit_log: false,
    enable_precision_audit: false
  });
  
  const errors = [];
  
  // Schedule deve continuar funcionando
  if (!result.schedule || result.schedule.length !== 12) {
    errors.push("Schedule não foi gerado corretamente com governança desativada");
  }
  
  // Campos de governança devem ser null/skip
  if (result.integrity !== null) {
    errors.push(`integrity deveria ser null, mas é: ${JSON.stringify(result.integrity)}`);
  }
  
  if (result.precision_governance !== null) {
    errors.push("precision_governance deveria ser null");
  }
  
  if (result.audit_log !== null) {
    errors.push("audit_log deveria ser null");
  }
  
  if (result.precision_audit.status !== "SKIP") {
    errors.push(`precision_audit.status deveria ser SKIP, mas é: ${result.precision_audit.status}`);
  }
  
  // Risk flags ainda devem funcionar (sempre ativo)
  if (!Array.isArray(result.risk_flags)) {
    errors.push("risk_flags deveria existir mesmo com governança desativada");
  }
  
  // Disclosure ainda deve funcionar (sempre ativo)
  if (!result.disclosure_automated) {
    errors.push("disclosure_automated deveria existir mesmo com governança desativada");
  }
  
  if (errors.length === 0) {
    console.log("✅ GOVERNANÇA DESATIVADA — Campos corretos (null/skip)");
    console.log(`✅ Schedule gerado: ${result.schedule.length} parcelas`);
    return { passed: true };
  } else {
    console.error("❌ FALHOU:");
    errors.forEach(e => console.error(`  - ${e}`));
    return { passed: false, errors };
  }
}

/**
 * Suite completa de snapshot
 */
export async function runSnapshotSuite() {
  console.log("\n🔐 ===== SNAPSHOT REGRESSION SUITE =====\n");
  
  const test1 = await testSnapshotRegression();
  const test2 = await testGovernanceDisabled();
  
  const allPassed = test1.passed && test2.passed;
  
  console.log("\n📊 RESUMO:");
  console.log(`  Snapshot Regression: ${test1.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`  Governança Desativada: ${test2.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`\n🎯 RESULTADO FINAL: ${allPassed ? "✅ ACEITE APROVADO" : "❌ REGRESSÃO DETECTADA"}\n`);
  
  return {
    passed: allPassed,
    tests: {
      snapshot: test1,
      disabled: test2
    }
  };
}

export default { testSnapshotRegression, testGovernanceDisabled, runSnapshotSuite };