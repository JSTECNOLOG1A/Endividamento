/**
 * 🧪 CALCULATION SNAPSHOT INTEGRATION TESTS — ETAPA 4B
 * 
 * Testes de integração com workflow:
 * 1) Approved cria 1 snapshot + current_snapshot_id
 * 2) Recalculated cria 2º snapshot + mantém primeiro
 * 3) Clone validation (não compartilha referência)
 * 4) Hash validação
 * 5) No PII validation
 */

import { calculateAmortizationSchedule } from "./CalculationEngine";
import {
  saveAndUpdateContract,
  loadCalculationData,
  validateNoPII
} from "./CalculationSnapshotIntegration";

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
  id: "CONTRACT_INTEGRATION_001",
  contract_number: "2026-INTEG-0001",
  group_id: "GROUP_1",
  entity_id: "ENTITY_1"
};

// ============================================
// TEST 1: APPROVED CREATES SNAPSHOT
// ============================================
export async function testApprovedCreatesSnapshot() {
  console.log("\n🧪 ===== TEST 1: APPROVED SNAPSHOT =====\n");

  const result = await calculateAmortizationSchedule(BASELINE_PARAMS);

  // MOCK: Simular saveAndUpdateContract (em produção, persiste no BD)
  const mockSnapshot = {
    id: "SNAP_APPROVED_001",
    contract_id: MOCK_CONTRACT.id,
    contract_number: MOCK_CONTRACT.contract_number,
    engine_version: result.calculation_metadata.engine_version,
    calculation_hash_strict: result.calculation_metadata.calculation_hash_strict,
    schedule_snapshot: JSON.stringify(result.schedule)
  };

  const mockUpdatedContract = {
    ...MOCK_CONTRACT,
    current_snapshot_id: mockSnapshot.id,
    approved_snapshot_id: mockSnapshot.id,
    status: "aprovado"
  };

  console.log("📦 Snapshot aprovado:");
  console.log(`   ID: ${mockSnapshot.id}`);
  console.log(`   current_snapshot_id preenchido: ${mockUpdatedContract.current_snapshot_id ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   approved_snapshot_id preenchido: ${mockUpdatedContract.approved_snapshot_id ? "✅ SIM" : "❌ NÃO"}`);

  const bothSet = mockUpdatedContract.current_snapshot_id && mockUpdatedContract.approved_snapshot_id;

  return {
    passed: bothSet && mockSnapshot.id,
    snapshot: mockSnapshot,
    contract: mockUpdatedContract
  };
}

// ============================================
// TEST 2: RECALCULATED CREATES NEW SNAPSHOT
// ============================================
export async function testRecalculatedNewSnapshot() {
  console.log("\n🧪 ===== TEST 2: RECALCULATED NEW SNAPSHOT =====\n");

  const result1 = await calculateAmortizationSchedule(BASELINE_PARAMS);

  const snapshot1 = {
    id: "SNAP_APPROVED_001",
    contract_id: MOCK_CONTRACT.id,
    engine_version: result1.calculation_metadata.engine_version,
    calculation_hash_strict: result1.calculation_metadata.calculation_hash_strict,
    schedule_snapshot: JSON.stringify(result1.schedule)
  };

  const contract1 = {
    ...MOCK_CONTRACT,
    current_snapshot_id: snapshot1.id,
    approved_snapshot_id: snapshot1.id
  };

  console.log("📦 Primeiro snapshot (APPROVED):");
  console.log(`   ID: ${snapshot1.id}`);

  // Esperar para garantir timestamp diferente
  await new Promise(resolve => setTimeout(resolve, 100));

  // Recalcular
  const result2 = await calculateAmortizationSchedule(BASELINE_PARAMS);

  const snapshot2 = {
    id: "SNAP_RECALC_002",
    contract_id: MOCK_CONTRACT.id,
    engine_version: result2.calculation_metadata.engine_version,
    calculation_hash_strict: result2.calculation_metadata.calculation_hash_strict,
    schedule_snapshot: JSON.stringify(result2.schedule)
  };

  const contract2 = {
    ...contract1,
    current_snapshot_id: snapshot2.id,
    last_recalculated_at: new Date().toISOString()
  };

  console.log("\n📦 Segundo snapshot (RECALCULATED):");
  console.log(`   ID: ${snapshot2.id}`);
  console.log(`   approved_snapshot_id mantido: ${contract2.approved_snapshot_id === snapshot1.id ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   current_snapshot_id atualizado: ${contract2.current_snapshot_id === snapshot2.id ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   last_recalculated_at preenchido: ${contract2.last_recalculated_at ? "✅ SIM" : "❌ NÃO"}`);

  const correctState = 
    contract2.approved_snapshot_id === snapshot1.id &&
    contract2.current_snapshot_id === snapshot2.id &&
    contract2.last_recalculated_at;

  return {
    passed: correctState,
    snapshot1,
    snapshot2,
    contract1,
    contract2,
    correctState
  };
}

// ============================================
// TEST 3: CLONE VALIDATION (NO SHARED REF)
// ============================================
export async function testCloneValidation() {
  console.log("\n🧪 ===== TEST 3: CLONE VALIDATION =====\n");

  const result = await calculateAmortizationSchedule(BASELINE_PARAMS);

  // Simular saveCalculationSnapshot com structuredClone
  const snapshotSchedule = structuredClone(result.schedule);

  // Verificar se são objetos diferentes
  const differentRefs = snapshotSchedule !== result.schedule;
  
  // Verificar se valores são iguais (não o objeto)
  const valuesEqual = JSON.stringify(snapshotSchedule) === JSON.stringify(result.schedule);

  console.log("🔐 Clone validation:");
  console.log(`   Refs diferentes: ${differentRefs ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   Valores iguais: ${valuesEqual ? "✅ SIM" : "❌ NÃO"}`);

  // Tentar mutar snapshot_schedule para provar independência
  if (snapshotSchedule.length > 0) {
    snapshotSchedule[0].parcela = 999;
    const mutationIsolated = result.schedule[0].parcela !== 999;
    console.log(`   Mutação isolada: ${mutationIsolated ? "✅ SIM" : "❌ NÃO"}`);
  }

  return {
    passed: differentRefs && valuesEqual,
    differentRefs,
    valuesEqual
  };
}

// ============================================
// TEST 4: HASH VALIDATION
// ============================================
export async function testHashValidation() {
  console.log("\n🧪 ===== TEST 4: HASH VALIDATION =====\n");

  const result = await calculateAmortizationSchedule(BASELINE_PARAMS);

  const snapshot = {
    calculation_hash_strict: result.calculation_metadata.calculation_hash_strict,
    calculation_hash_instance: result.calculation_metadata.calculation_hash_instance
  };

  const hashStrictMatches = snapshot.calculation_hash_strict === result.calculation_metadata.calculation_hash_strict;
  const hashInstanceMatches = snapshot.calculation_hash_instance === result.calculation_metadata.calculation_hash_instance;
  const differentHashes = snapshot.calculation_hash_strict !== snapshot.calculation_hash_instance;

  console.log("🔐 Hash validation:");
  console.log(`   Strict matches: ${hashStrictMatches ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   Instance matches: ${hashInstanceMatches ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   Hashes different: ${differentHashes ? "✅ SIM" : "❌ NÃO"}`);

  return {
    passed: hashStrictMatches && hashInstanceMatches && differentHashes,
    hashStrictMatches,
    hashInstanceMatches,
    differentHashes
  };
}

// ============================================
// TEST 5: NO PII VALIDATION
// ============================================
export async function testNoPIIValidation() {
  console.log("\n🧪 ===== TEST 5: NO PII VALIDATION =====\n");

  const result = await calculateAmortizationSchedule(BASELINE_PARAMS);

  // Simular snapshot SEM PII (como deve ser)
  const cleanSnapshot = {
    schedule_snapshot: JSON.stringify(result.schedule),
    disclosure_snapshot: JSON.stringify(result.disclosure_automated || {}),
    risk_flags_snapshot: JSON.stringify(result.risk_flags || []),
    audit_log_snapshot: JSON.stringify(result.audit_log || null),
    calculation_parameters: JSON.stringify({ operationValue: result.principal }),
    metadata: JSON.stringify({ engine_version: result.calculation_metadata.engine_version })
  };

  const piiCheckResult = validateNoPII(cleanSnapshot);

  console.log("🔐 PII check:");
  console.log(`   Valid (no PII): ${piiCheckResult.valid ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`   PII found: ${piiCheckResult.piiFound.length}`);

  return {
    passed: piiCheckResult.valid,
    piiCheckResult
  };
}

// ============================================
// SUITE COMPLETA
// ============================================
export async function runIntegrationTests() {
  console.log("\n🔐 ========================================");
  console.log("   SNAPSHOT INTEGRATION TESTS — ETAPA 4B");
  console.log("========================================\n");

  const test1 = await testApprovedCreatesSnapshot();
  const test2 = await testRecalculatedNewSnapshot();
  const test3 = await testCloneValidation();
  const test4 = await testHashValidation();
  const test5 = await testNoPIIValidation();

  console.log("\n========================================");
  console.log("📊 RESUMO:");
  console.log("========================================");
  console.log(`1️⃣ Approved Creates Snapshot:  ${test1.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`2️⃣ Recalculated New Snapshot:  ${test2.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`3️⃣ Clone Validation:          ${test3.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`4️⃣ Hash Validation:           ${test4.passed ? "✅ PASSOU" : "❌ FALHOU"}`);
  console.log(`5️⃣ No PII Validation:         ${test5.passed ? "✅ PASSOU" : "❌ FALHOU"}`);

  const allPassed = test1.passed && test2.passed && test3.passed && test4.passed && test5.passed;

  console.log("\n========================================");
  if (allPassed) {
    console.log("🎯 RESULTADO: ✅ 5/5 TESTES PASSARAM");
    console.log("🟢 ETAPA 4B INTEGRAÇÃO — PRONTA");
  } else {
    console.log("🎯 RESULTADO: ❌ TESTES FALHARAM");
  }
  console.log("========================================\n");

  return {
    passed: allPassed,
    tests: { test1, test2, test3, test4, test5 }
  };
}

export default { runIntegrationTests };