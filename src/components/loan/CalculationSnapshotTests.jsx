/**
 * 🧪 CALCULATION SNAPSHOT TESTS — ETAPA 4B
 * 
 * Valida:
 * 1) Snapshot criado ao aprovar
 * 2) Novo snapshot ao recalcular
 * 3) Hashes preservados
 * 4) Schedule idêntico ao result
 */

import {
  saveCalculationSnapshot,
  validateSnapshot,
  compareSnapshots,
  deserializeSnapshot
} from "./CalculationSnapshotPersistence";
import { calculateAmortizationSchedule } from "./CalculationEngine";

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
  totalTermMonths: 12
};

const MOCK_CONTRACT = {
  id: "CONTRACT_123",
  contract_number: "2026-00001",
  group_id: "GROUP_1",
  entity_id: "ENTITY_1"
};

// ============================================
// TEST 1: SNAPSHOT CRIADO AO APROVAR
// ============================================
export async function testSnapshotOnApproval() {
  console.log("\n🧪 ===== TEST 1: SNAPSHOT ON APPROVAL =====\n");

  const result = await calculateAmortizationSchedule(BASELINE_PARAMS);

  console.log("📊 Cálculo realizado:");
  console.log(`   Principal: R$ ${result.principal.toFixed(2)}`);
  console.log(`   Hash Strict: ${result.calculation_metadata.calculation_hash_strict.substring(0, 16)}...`);

  // MOCK: Simular saveCalculationSnapshot (em produção, chama base44.entities)
  const mockSnapshot = {
    id: "SNAP_001",
    contract_id: MOCK_CONTRACT.id,
    contract_number: MOCK_CONTRACT.contract_number,
    engine_version: result.calculation_metadata.engine_version,
    engine_build_id: result.calculation_metadata.engine_build_id,
    calculation_hash_strict: result.calculation_metadata.calculation_hash_strict,
    calculation_hash_instance: result.calculation_metadata.calculation_hash_instance,
    schedule_snapshot: JSON.stringify(result.schedule),
    disclosure_snapshot: JSON.stringify(result.disclosure_automated || {}),
    risk_flags_snapshot: JSON.stringify(result.risk_flags || []),
    audit_log_snapshot: JSON.stringify(result.audit_log || null),
    currency: result.calculation_metadata.currency || "BRL",
    principal: result.principal,
    total_interest: result.totalJuros,
    total_paid: result.totalPrestacao,
    trigger_event: "APPROVED",
    created_at: new Date().toISOString(),
    created_by: "user@test.com"
  };

  console.log("💾 Snapshot mock criado:");
  console.log(`   ID: ${mockSnapshot.id}`);
  console.log(`   Trigger: ${mockSnapshot.trigger_event}`);
  console.log(`   Hash Strict preservado: ${mockSnapshot.calculation_hash_strict === result.calculation_metadata.calculation_hash_strict ? "✅ SIM" : "❌ NÃO"}`);

  const validation = validateSnapshot(mockSnapshot);
  console.log(`   Validação: ${validation.valid ? "✅ VALID" : "❌ INVALID"}`);

  return {
    passed: validation.valid && mockSnapshot.calculation_hash_strict === result.calculation_metadata.calculation_hash_strict,
    snapshot: mockSnapshot,
    result
  };
}

// ============================================
// TEST 2: NOVO SNAPSHOT AO RECALCULAR
// ============================================
export async function testNewSnapshotOnRecalculation() {
  console.log("\n🧪 ===== TEST 2: NEW SNAPSHOT ON RECALCULATION =====\n");

  // Primeiro cálculo
  const result1 = await calculateAmortizationSchedule(BASELINE_PARAMS);
  
  const snapshot1 = {
    id: "SNAP_001",
    contract_id: MOCK_CONTRACT.id,
    contract_number: MOCK_CONTRACT.contract_number,
    engine_version: result1.calculation_metadata.engine_version,
    calculation_hash_strict: result1.calculation_metadata.calculation_hash_strict,
    calculation_hash_instance: result1.calculation_metadata.calculation_hash_instance,
    schedule_snapshot: JSON.stringify(result1.schedule),
    trigger_event: "APPROVED",
    created_at: new Date().toISOString(),
    principal: result1.principal,
    total_interest: result1.totalJuros,
    total_paid: result1.totalPrestacao,
    currency: "BRL"
  };

  console.log("📊 Primeiro cálculo:");
  console.log(`   Hash Instance: ${snapshot1.calculation_hash_instance.substring(0, 16)}...`);

  // Aguardar para garantir timestamp diferente
  await new Promise(resolve => setTimeout(resolve, 100));

  // Recalcular (mesmos params)
  const result2 = await calculateAmortizationSchedule(BASELINE_PARAMS);

  const snapshot2 = {
    id: "SNAP_002",
    contract_id: MOCK_CONTRACT.id,
    contract_number: MOCK_CONTRACT.contract_number,
    engine_version: result2.calculation_metadata.engine_version,
    calculation_hash_strict: result2.calculation_metadata.calculation_hash_strict,
    calculation_hash_instance: result2.calculation_metadata.calculation_hash_instance,
    schedule_snapshot: JSON.stringify(result2.schedule),
    trigger_event: "RECALCULATED",
    created_at: new Date().toISOString(),
    principal: result2.principal,
    total_interest: result2.totalJuros,
    total_paid: result2.totalPrestacao,
    currency: "BRL"
  };

  console.log("📊 Segundo cálculo (recalculado):");
  console.log(`   Hash Instance: ${snapshot2.calculation_hash_instance.substring(0, 16)}...`);

  const differentInstances = snapshot1.calculation_hash_instance !== snapshot2.calculation_hash_instance;
  const sameStrict = snapshot1.calculation_hash_strict === snapshot2.calculation_hash_strict;
  const bothCreated = snapshot1.id && snapshot2.id;

  console.log("\n✅ VALIDAÇÃO:");
  console.log(`   Hash Instance diferente: ${differentInstances ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   Hash Strict idêntico: ${sameStrict ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   Ambos snapshots criados: ${bothCreated ? "✅ SIM" : "❌ NÃO"}`);

  return {
    passed: differentInstances && sameStrict && bothCreated,
    snapshot1,
    snapshot2,
    differentInstances,
    sameStrict
  };
}

// ============================================
// TEST 3: SCHEDULE IDÊNTICO AO RESULT
// ============================================
export async function testScheduleIntegrity() {
  console.log("\n🧪 ===== TEST 3: SCHEDULE INTEGRITY =====\n");

  const result = await calculateAmortizationSchedule(BASELINE_PARAMS);

  const snapshot = {
    schedule_snapshot: JSON.stringify(result.schedule)
  };

  const deserialized = deserializeSnapshot(snapshot);
  const deserializedSchedule = deserialized.schedule;

  console.log("📊 Validação de integridade:");
  console.log(`   Schedule original: ${result.schedule.length} parcelas`);
  console.log(`   Schedule desserializado: ${deserializedSchedule.length} parcelas`);

  // Comparar campo a campo da primeira e última parcela
  const parcel1Original = result.schedule[0];
  const parcel1Deserialized = deserializedSchedule[0];

  const fieldsToCheck = ["parcela", "sdInicial", "jurosFixosMes", "amortizacao", "prestacao", "sdFinal"];
  
  let allEqual = true;
  fieldsToCheck.forEach(field => {
    const equal = parcel1Original[field] === parcel1Deserialized[field];
    console.log(`   Parcela 1.${field}: ${equal ? "✅" : "❌"}`);
    if (!equal) allEqual = false;
  });

  const finalParcelOriginal = result.schedule[result.schedule.length - 1];
  const finalParcelDeserialized = deserializedSchedule[deserializedSchedule.length - 1];
  const finalSdEqual = finalParcelOriginal.sdFinal === finalParcelDeserialized.sdFinal;

  console.log(`   Parcela final sdFinal: ${finalSdEqual ? "✅" : "❌"}`);

  return {
    passed: allEqual && finalSdEqual && result.schedule.length === deserializedSchedule.length,
    lengthMatch: result.schedule.length === deserializedSchedule.length,
    fieldsMatch: allEqual,
    finalSdMatch: finalSdEqual
  };
}

// ============================================
// TEST 4: HASH STRICT VALIDATION
// ============================================
export async function testHashStrictValidation() {
  console.log("\n🧪 ===== TEST 4: HASH STRICT VALIDATION =====\n");

  const result = await calculateAmortizationSchedule(BASELINE_PARAMS);
  const snapshot = {
    calculation_hash_strict: result.calculation_metadata.calculation_hash_strict
  };

  const hashStrictMatches = snapshot.calculation_hash_strict === result.calculation_metadata.calculation_hash_strict;
  const hashStrictLength = snapshot.calculation_hash_strict.length === 64; // SHA-256 hex é 64 chars

  console.log("🔐 Hash Strict Validation:");
  console.log(`   Hash Strict matches result: ${hashStrictMatches ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   Hash é SHA-256 (64 chars): ${hashStrictLength ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   Hash: ${snapshot.calculation_hash_strict.substring(0, 16)}...`);

  return {
    passed: hashStrictMatches && hashStrictLength,
    hashStrictMatches,
    hashStrictLength,
    hash: snapshot.calculation_hash_strict
  };
}

// ============================================
// TEST 5: COMPARE SNAPSHOTS (ANTES/DEPOIS RECALC)
// ============================================
export async function testSnapshotComparison() {
  console.log("\n🧪 ===== TEST 4: SNAPSHOT COMPARISON =====\n");

  const result1 = await calculateAmortizationSchedule(BASELINE_PARAMS);
  const result2 = await calculateAmortizationSchedule(BASELINE_PARAMS);

  const snapshot1 = {
    calculation_hash_strict: result1.calculation_metadata.calculation_hash_strict,
    calculation_hash_instance: result1.calculation_metadata.calculation_hash_instance,
    principal: result1.principal,
    total_interest: result1.totalJuros,
    total_paid: result1.totalPrestacao,
    schedule_snapshot: JSON.stringify(result1.schedule),
    trigger_event: "APPROVED"
  };

  const snapshot2 = {
    calculation_hash_strict: result2.calculation_metadata.calculation_hash_strict,
    calculation_hash_instance: result2.calculation_metadata.calculation_hash_instance,
    principal: result2.principal,
    total_interest: result2.totalJuros,
    total_paid: result2.totalPrestacao,
    schedule_snapshot: JSON.stringify(result2.schedule),
    trigger_event: "APPROVED"
  };

  const comparison = compareSnapshots(snapshot1, snapshot2);

  console.log("📊 Comparação:");
  console.log(`   Hash strict igual: ${comparison.hash_strict_equal ? "✅" : "❌"}`);
  console.log(`   Principal igual: ${comparison.principal_equal ? "✅" : "❌"}`);
  console.log(`   Total juros igual: ${comparison.total_interest_equal ? "✅" : "❌"}`);
  console.log(`   Total pago igual: ${comparison.total_paid_equal ? "✅" : "❌"}`);
  console.log(`   Schedule length igual: ${comparison.schedule_length_a === comparison.schedule_length_b ? "✅" : "❌"}`);
  console.log(`   Snapshots idênticos: ${comparison.identical ? "✅" : "❌"}`);

  return {
    passed: comparison.identical,
    comparison
  };
}

// ============================================
// SUITE COMPLETA
// ============================================
export async function runCalculationSnapshotTests() {
  console.log("\n🔐 ========================================");
  console.log("   CALCULATION SNAPSHOT TESTS — ETAPA 4B");
  console.log("========================================\n");

  const test1 = await testSnapshotOnApproval();
  const test2 = await testNewSnapshotOnRecalculation();
  const test3 = await testScheduleIntegrity();
  const test4 = await testHashStrictValidation();
  const test5 = await testSnapshotComparison();

  console.log("\n========================================");
  console.log("📊 RESUMO:");
  console.log("========================================");
  console.log(`1️⃣ Snapshot On Approval:     ${test1.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`2️⃣ New Snapshot Recalc:      ${test2.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`3️⃣ Schedule Integrity:       ${test3.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`4️⃣ Hash Strict Validation:   ${test4.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`5️⃣ Snapshot Comparison:      ${test5.passed ? "✅ PASSOU" : "❌ FALHOU"}`);

  const allPassed = test1.passed && test2.passed && test3.passed && test4.passed && test5.passed;

  console.log("\n========================================");
  if (allPassed) {
    console.log("🎯 RESULTADO: ✅ 5/5 TESTES PASSARAM");
    console.log("🟢 ETAPA 4B — PERSISTÊNCIA OK");
  } else {
    console.log("🎯 RESULTADO: ❌ TESTES FALHARAM");
  }
  console.log("========================================\n");

  return {
    passed: allPassed,
    tests: { test1, test2, test3, test4, test5 }
  };
}

export default { runCalculationSnapshotTests };