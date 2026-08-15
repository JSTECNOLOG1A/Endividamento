/**
 * 🧪 DEBT ANALYTICS 4C TESTS — ETAPA 4C (HARDENING)
 * 
 * Valida:
 * 1) Timezone-safe date comparison
 * 2) Schedule validation (ordenação, duplicidade, vazio)
 * 3) Position as-of (sd_base + sd_brl, currency_base)
 * 4) Liquidez (apenas vencimentos > cutoff e <= cutoff+12m)
 * 5) Debt map (basis="DUE_DATE")
 * 6) Determinismo (mesmos inputs → mesmos outputs)
 */

import { materializeDebtFacts, generateDebtMap } from "./DebtPositionFact";

// Mock snapshot padrão
const MOCK_SNAPSHOT_BRL = {
  id: "SNAP_BRL_001",
  contract_id: "CONTRACT_001",
  contract_number: "2026-00001",
  calculation_hash_strict: "abc123" + "0".repeat(58),
  calculation_hash_instance: "def456" + "0".repeat(58),
  engine_version: "1.2.1",
  engine_build_id: "build-20260222-etapa4c",
  currency: "BRL",
  principal: 100000,
  total_interest: 10000,
  total_paid: 110000,
  trigger_event: "APPROVED",
  created_date: "2026-01-15T10:00:00Z",
  schedule_snapshot: JSON.stringify([
    { parcela: 1, dataVencimento: "2026-02-15", sdInicial: 100000, sdFinal: 91667, amortizacao: 8333, jurosFixosMes: 875, jurosVariaveisMes: 0, prestacao: 9208 },
    { parcela: 2, dataVencimento: "2026-03-15", sdInicial: 91667, sdFinal: 83334, amortizacao: 8333, jurosFixosMes: 802, jurosVariaveisMes: 0, prestacao: 9135 },
    { parcela: 3, dataVencimento: "2026-04-15", sdInicial: 83334, sdFinal: 75001, amortizacao: 8333, jurosFixosMes: 729, jurosVariaveisMes: 0, prestacao: 9062 },
    { parcela: 4, dataVencimento: "2026-05-15", sdInicial: 75001, sdFinal: 66668, amortizacao: 8333, jurosFixosMes: 656, jurosVariaveisMes: 0, prestacao: 8989 },
    { parcela: 5, dataVencimento: "2026-06-15", sdInicial: 66668, sdFinal: 58335, amortizacao: 8333, jurosFixosMes: 583, jurosVariaveisMes: 0, prestacao: 8916 },
    { parcela: 6, dataVencimento: "2026-07-15", sdInicial: 58335, sdFinal: 50002, amortizacao: 8333, jurosFixosMes: 510, jurosVariaveisMes: 0, prestacao: 8843 },
    { parcela: 7, dataVencimento: "2026-08-15", sdInicial: 50002, sdFinal: 41669, amortizacao: 8333, jurosFixosMes: 437, jurosVariaveisMes: 0, prestacao: 8770 },
    { parcela: 8, dataVencimento: "2026-09-15", sdInicial: 41669, sdFinal: 33336, amortizacao: 8333, jurosFixosMes: 364, jurosVariaveisMes: 0, prestacao: 8697 },
    { parcela: 9, dataVencimento: "2026-10-15", sdInicial: 33336, sdFinal: 25003, amortizacao: 8333, jurosFixosMes: 291, jurosVariaveisMes: 0, prestacao: 8624 },
    { parcela: 10, dataVencimento: "2026-11-15", sdInicial: 25003, sdFinal: 16670, amortizacao: 8333, jurosFixosMes: 219, jurosVariaveisMes: 0, prestacao: 8552 },
    { parcela: 11, dataVencimento: "2026-12-15", sdInicial: 16670, sdFinal: 8337, amortizacao: 8333, jurosFixosMes: 146, jurosVariaveisMes: 0, prestacao: 8479 },
    { parcela: 12, dataVencimento: "2027-01-15", sdInicial: 8337, sdFinal: 0, amortizacao: 8337, jurosFixosMes: 73, jurosVariaveisMes: 0, prestacao: 8410 }
  ])
};

const MOCK_CONTRACT = {
  id: "CONTRACT_001",
  group_id: "GROUP_1",
  entity_id: "ENTITY_1",
  bank_id: "BANK_1",
  operation_date: "2026-01-15"
};

// ============================================
// TEST 1: TIMEZONE-SAFE DATE COMPARISON
// ============================================
export async function testTimezoneSafeDates() {
  console.log("\n🧪 ===== TEST 1: TIMEZONE-SAFE DATES =====\n");
  
  const cutoffDate = "2026-06-15"; // String sem timezone
  const facts = materializeDebtFacts(MOCK_SNAPSHOT_BRL, MOCK_CONTRACT, cutoffDate);
  
  // Validar que as_of_date está correto
  const asOfValid = facts.as_of_date === "2026-06-15";
  
  // Validar que parcelas futuras são > cutoff (estritamente)
  const futureParcels = facts.future_events;
  const allFutureValid = futureParcels.every(p => p.data_vencimento > "2026-06-15");
  
  console.log("📊 Timezone-safe validation:");
  console.log(`   as_of_date correto: ${asOfValid ? "✅" : "❌"} (${facts.as_of_date})`);
  console.log(`   Parcelas futuras: ${futureParcels.length}`);
  console.log(`   Todas futuras > cutoff: ${allFutureValid ? "✅" : "❌"}`);
  
  return {
    passed: asOfValid && allFutureValid,
    asOfValid,
    allFutureValid
  };
}

// ============================================
// TEST 2: SCHEDULE VALIDATION
// ============================================
export async function testScheduleValidation() {
  console.log("\n🧪 ===== TEST 2: SCHEDULE VALIDATION =====\n");
  
  const errors = [];
  
  // Cenário 1: Schedule vazio
  try {
    materializeDebtFacts({ ...MOCK_SNAPSHOT_BRL, schedule_snapshot: "[]" }, MOCK_CONTRACT);
    errors.push("Schedule vazio deveria falhar");
  } catch (e) {
    if (!e.message.includes("vazio")) {
      errors.push(`Erro inesperado: ${e.message}`);
    }
  }
  
  // Cenário 2: Schedule não ordenado
  const unorderedSchedule = JSON.parse(MOCK_SNAPSHOT_BRL.schedule_snapshot);
  [unorderedSchedule[0], unorderedSchedule[1]] = [unorderedSchedule[1], unorderedSchedule[0]]; // Swap
  
  try {
    materializeDebtFacts({ ...MOCK_SNAPSHOT_BRL, schedule_snapshot: JSON.stringify(unorderedSchedule) }, MOCK_CONTRACT);
    errors.push("Schedule não ordenado deveria falhar");
  } catch (e) {
    if (!e.message.includes("não ordenado")) {
      errors.push(`Erro inesperado: ${e.message}`);
    }
  }
  
  // Cenário 3: Duplicidade de datas
  const duplicatedSchedule = JSON.parse(MOCK_SNAPSHOT_BRL.schedule_snapshot);
  duplicatedSchedule[1].dataVencimento = duplicatedSchedule[0].dataVencimento;
  
  try {
    materializeDebtFacts({ ...MOCK_SNAPSHOT_BRL, schedule_snapshot: JSON.stringify(duplicatedSchedule) }, MOCK_CONTRACT);
    errors.push("Schedule duplicado deveria falhar");
  } catch (e) {
    if (!e.message.includes("duplicada")) {
      errors.push(`Erro inesperado: ${e.message}`);
    }
  }
  
  console.log("📊 Schedule validation:");
  console.log(`   Validações bloquearam: ${errors.length === 0 ? "✅ SIM" : "❌ NÃO"}`);
  if (errors.length > 0) {
    errors.forEach(e => console.log(`   ❌ ${e}`));
  }
  
  return { passed: errors.length === 0, errors };
}

// ============================================
// TEST 3: POSITION AS-OF (sd_base + sd_brl + currency_base)
// ============================================
export async function testPositionAsOf() {
  console.log("\n🧪 ===== TEST 3: POSITION AS-OF =====\n");
  
  const facts = materializeDebtFacts(MOCK_SNAPSHOT_BRL, MOCK_CONTRACT, "2026-06-15");
  const position = facts.position;
  
  const hasBase = position.saldo_devedor_base !== undefined;
  const hasBRL = position.saldo_devedor_brl !== undefined;
  const hasCurrency = position.currency_base !== undefined;
  const currencyCorrect = position.currency_base === "BRL";
  
  // Para BRL, base = brl
  const baseEqualsBRL = position.saldo_devedor_base === position.saldo_devedor_brl;
  
  console.log("📊 Position as-of:");
  console.log(`   saldo_devedor_base: ${hasBase ? "✅" : "❌"} (${position.saldo_devedor_base})`);
  console.log(`   saldo_devedor_brl: ${hasBRL ? "✅" : "❌"} (${position.saldo_devedor_brl})`);
  console.log(`   currency_base: ${hasCurrency ? "✅" : "❌"} (${position.currency_base})`);
  console.log(`   base === brl (BRL): ${baseEqualsBRL ? "✅" : "❌"}`);
  
  return {
    passed: hasBase && hasBRL && hasCurrency && currencyCorrect && baseEqualsBRL,
    position
  };
}

// ============================================
// TEST 4: LIQUIDEZ (apenas > cutoff e <= cutoff+12m)
// ============================================
export async function testLiquidityRange() {
  console.log("\n🧪 ===== TEST 4: LIQUIDITY RANGE =====\n");
  
  const cutoffDate = "2026-02-15"; // Após parcela 1
  const facts = materializeDebtFacts(MOCK_SNAPSHOT_BRL, MOCK_CONTRACT, cutoffDate);
  
  // Parcelas circulantes: 2-12 (fev a jan/2027)
  // Horizon: 2026-02-15 + 12m = 2027-02-15
  // Parcela 12 (2027-01-15) está DENTRO do horizon
  
  const circulante = facts.liquidity.circulante;
  const naoCirculante = facts.liquidity.nao_circulante;
  
  // Circulante deveria ter 11 parcelas (2-12)
  const circulanteCorrect = circulante.parcels_count === 11;
  
  // Não circulante deveria estar vazio (todas parcelas < 12m)
  const naoCirculanteEmpty = naoCirculante.parcels_count === 0;
  
  console.log("📊 Liquidity range:");
  console.log(`   Cutoff: ${cutoffDate}`);
  console.log(`   Horizon end: ${facts.liquidity.horizon_end_date}`);
  console.log(`   Circulante (11 parcelas): ${circulanteCorrect ? "✅" : "❌"} (${circulante.parcels_count})`);
  console.log(`   Não circulante (0 parcelas): ${naoCirculanteEmpty ? "✅" : "❌"} (${naoCirculante.parcels_count})`);
  
  return {
    passed: circulanteCorrect && naoCirculanteEmpty,
    circulante,
    naoCirculante
  };
}

// ============================================
// TEST 5: DEBT MAP (basis="DUE_DATE")
// ============================================
export async function testDebtMapBasis() {
  console.log("\n🧪 ===== TEST 5: DEBT MAP BASIS =====\n");
  
  const schedule = JSON.parse(MOCK_SNAPSHOT_BRL.schedule_snapshot);
  const map = generateDebtMap(schedule);
  
  const hasBasis = map.basis !== undefined;
  const basisCorrect = map.basis === "DUE_DATE";
  const monthlyHasData = map.monthly.length > 0;
  const yearlyHasData = map.yearly.length > 0;
  
  console.log("📊 Debt map:");
  console.log(`   basis field exists: ${hasBasis ? "✅" : "❌"}`);
  console.log(`   basis === "DUE_DATE": ${basisCorrect ? "✅" : "❌"}`);
  console.log(`   Monthly data: ${monthlyHasData ? "✅" : "❌"} (${map.monthly.length} rows)`);
  console.log(`   Yearly data: ${yearlyHasData ? "✅" : "❌"} (${map.yearly.length} rows)`);
  
  return {
    passed: hasBasis && basisCorrect && monthlyHasData && yearlyHasData,
    map
  };
}

// ============================================
// TEST 6: DETERMINISM
// ============================================
export async function testDeterminism() {
  console.log("\n🧪 ===== TEST 6: DETERMINISM =====\n");
  
  const cutoffDate = "2026-06-15";
  
  // Executar 3 vezes com mesmos inputs
  const facts1 = materializeDebtFacts(MOCK_SNAPSHOT_BRL, MOCK_CONTRACT, cutoffDate);
  const facts2 = materializeDebtFacts(MOCK_SNAPSHOT_BRL, MOCK_CONTRACT, cutoffDate);
  const facts3 = materializeDebtFacts(MOCK_SNAPSHOT_BRL, MOCK_CONTRACT, cutoffDate);
  
  // Comparar campos críticos
  const positionEqual = 
    facts1.position.saldo_devedor_base === facts2.position.saldo_devedor_base &&
    facts2.position.saldo_devedor_base === facts3.position.saldo_devedor_base;
  
  const liquidityEqual = 
    facts1.liquidity.circulante.total === facts2.liquidity.circulante.total &&
    facts2.liquidity.circulante.total === facts3.liquidity.circulante.total;
  
  const interestEqual = 
    facts1.interest_by_period.by_month.length === facts2.interest_by_period.by_month.length &&
    facts2.interest_by_period.by_month.length === facts3.interest_by_period.by_month.length;
  
  console.log("📊 Determinism (3 runs):");
  console.log(`   Position equal: ${positionEqual ? "✅" : "❌"}`);
  console.log(`   Liquidity equal: ${liquidityEqual ? "✅" : "❌"}`);
  console.log(`   Interest equal: ${interestEqual ? "✅" : "❌"}`);
  console.log(`   Saldo base (run 1): ${facts1.position.saldo_devedor_base}`);
  console.log(`   Saldo base (run 2): ${facts2.position.saldo_devedor_base}`);
  console.log(`   Saldo base (run 3): ${facts3.position.saldo_devedor_base}`);
  
  return {
    passed: positionEqual && liquidityEqual && interestEqual,
    positionEqual,
    liquidityEqual,
    interestEqual
  };
}

// ============================================
// SUITE COMPLETA
// ============================================
export async function runDebtAnalytics4CTests() {
  console.log("\n🔐 ========================================");
  console.log("   DEBT ANALYTICS 4C TESTS (HARDENING)");
  console.log("========================================\n");
  
  const test1 = await testTimezoneSafeDates();
  const test2 = await testScheduleValidation();
  const test3 = await testPositionAsOf();
  const test4 = await testLiquidityRange();
  const test5 = await testDebtMapBasis();
  const test6 = await testDeterminism();
  
  console.log("\n========================================");
  console.log("📊 RESUMO:");
  console.log("========================================");
  console.log(`1️⃣ Timezone-Safe Dates:      ${test1.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`2️⃣ Schedule Validation:      ${test2.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`3️⃣ Position as-of:           ${test3.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`4️⃣ Liquidity Range:          ${test4.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`5️⃣ Debt Map Basis:           ${test5.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`6️⃣ Determinism:              ${test6.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  
  const allPassed = test1.passed && test2.passed && test3.passed && test4.passed && test5.passed && test6.passed;
  
  console.log("\n========================================");
  if (allPassed) {
    console.log("🎯 RESULTADO: ✅ 6/6 TESTES PASSARAM");
    console.log("🟢 ETAPA 4C (HARDENING) — APROVADO");
  } else {
    console.log("🎯 RESULTADO: ❌ TESTES FALHARAM");
  }
  console.log("========================================\n");
  
  return {
    passed: allPassed,
    tests: { test1, test2, test3, test4, test5, test6 }
  };
}

export default { runDebtAnalytics4CTests };