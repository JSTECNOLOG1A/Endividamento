/**
 * 🔐 BACKEND FUNCTION: Teste de Hardenings Etapa 3
 * Executa testes objetivos e retorna evidências
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Importar módulos de teste
    const { testHashDeterminism, testPtaxGapDetection, testMutationGuard, testTypedTolerances, printStaticEvidence } = await import('../components/loan/FinalHardeningTests.js');
    
    // Capturar console.log
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.log = (...args) => {
      logs.push({ level: 'log', message: args.join(' ') });
      originalLog(...args);
    };
    console.error = (...args) => {
      logs.push({ level: 'error', message: args.join(' ') });
      originalError(...args);
    };
    console.warn = (...args) => {
      logs.push({ level: 'warn', message: args.join(' ') });
      originalWarn(...args);
    };
    
    // Executar evidências estáticas
    printStaticEvidence();
    
    // Executar testes dinâmicos
    const test1 = await testHashDeterminism();
    const test2 = await testPtaxGapDetection();
    const test3 = await testMutationGuard();
    const test4 = await testTypedTolerances();
    
    // Restaurar console
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    
    const allPassed = test1.passed && test2.passed && test3.passed && test4.passed;
    
    return Response.json({
      status: allPassed ? "PASSED" : "FAILED",
      summary: {
        test1_hash_determinism: test1.passed ? "✅ PASSOU" : "❌ FALHOU",
        test2_ptax_gap: test2.passed ? "✅ PASSOU" : "❌ FALHOU",
        test3_mutation_guard: test3.passed ? "✅ PASSOU" : "❌ FALHOU",
        test4_typed_tolerances: test4.passed ? "✅ PASSOU" : "❌ FALHOU",
        overall: allPassed ? "🟢 AUTORIZADO MERGE PROD" : "🔴 MERGE BLOQUEADO"
      },
      details: {
        test1: {
          hash1_strict: test1.hash1_strict?.substring(0, 16) + "...",
          hash2_strict: test2.hash2_strict?.substring(0, 16) + "...",
          strict_equal: test1.hash1_strict === test1.hash2_strict,
          hash1_instance: test1.hash1_instance?.substring(0, 16) + "...",
          hash2_instance: test1.hash2_instance?.substring(0, 16) + "...",
          instance_different: test1.hash1_instance !== test1.hash2_instance
        },
        test2: {
          ptax_gap_flag_present: !!test2.ptaxGapFlag,
          ptax_gap_severity: test2.ptaxGapFlag?.severity || "N/A",
          ptax_gap_message: test2.ptaxGapFlag?.message || "N/A"
        },
        test3: {
          guard_activated: test3.guardActivated,
          mutation_guard_status: test3.mutationGuardInfo?.status || "N/A",
          hash_before_present: !!test3.mutationGuardInfo?.hash_before
        },
        test4: {
          money_exact_fails_on_0_01: !test4.checks.money_exact.passed,
          exchange_accepts_0_0001: test4.checks.exchange.passed,
          money_soft_accepts_0_01: test4.checks.money_soft.passed
        }
      },
      build_id: "build-20260221-bancario",
      engine_version: "1.2.0",
      logs: logs.slice(-50)  // Últimos 50 logs
    });
  } catch (error) {
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});