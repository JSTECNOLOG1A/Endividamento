/**
 * 🔐 ZERO RISK REGRESSION TEST
 * 
 * OBJETIVO:
 * Garantir que mudanças de UI/export não alteram cálculos validados.
 * 
 * CRITÉRIOS CRÍTICOS:
 * 1. calculation_hash_strict imutável (mesmos inputs)
 * 2. schedule_usd_hash imutável (mesmo contrato)
 * 3. Total Interest USD inalterado (±0,01)
 * 4. Total Amortization USD inalterado (±0,01)
 * 5. Saldo Final USD = 0 (±0,01)
 * 6. Número de parcelas inalterado
 * 
 * VERSÃO: 1.0
 * DATA: 2026-02-23
 */

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { calculateAmortizationSchedule } from "./CalculationEngine";

// 🔐 GOLDEN INPUT (Referência Imutável)
const GOLDEN_INPUT = {
  operationValue: 15000000,
  amount_foreign: 2573531.00,
  currencyId: "USD",
  exchangeLag: 1,
  fixedRate: 8.5,
  indexer: "NA",
  indexerSpread: 0,
  operationDate: "2025-01-31",
  principalGraceMonths: 0,
  interestGraceMonths: 0,
  graceInterestBehavior: "CAPITALIZAR",
  amortizationTrigger: "END_OF_GRACE",
  principalInstallments: 60,
  interestInstallments: 60,
  principalFrequency: "1",
  interestFrequency: "1",
  calculationSystem: "SAC",
  totalTermMonths: 60,
  finalMaturityDate: "2030-01-31",
  
  // Exchange Rates (mock para teste)
  exchangeRates: [
    { rate_date: "2025-01-30", ptax_rate: 5.8275, source: "BCB", created_at: "2025-01-30T18:00:00Z" },
    { rate_date: "2025-01-31", ptax_rate: 5.8300, source: "BCB", created_at: "2025-01-31T18:00:00Z" },
    { rate_date: "2025-02-28", ptax_rate: 5.8400, source: "BCB", created_at: "2025-02-28T18:00:00Z" },
    { rate_date: "2025-03-31", ptax_rate: 5.8500, source: "BCB", created_at: "2025-03-31T18:00:00Z" },
    // ... adicionar mais taxas se necessário, ou usar replicate_last_rate
  ],
  
  cdiRates: [],
  holidays: [],
  
  // Flags de governança
  enable_precision_audit: true,
  enable_integrity_checks: true,
  enable_audit_log: true,
  fail_on_integrity_error: false,
  fail_on_precision_error: false,
  simulation_mode: true,
  contract_status: "SIMULATION",
};

// 🔐 EXPECTED VALUES (Valores de Referência Esperados)
// ATENÇÃO: Preencher com valores reais após primeira execução bem-sucedida
const EXPECTED_VALUES = {
  // CRITICAL: Hashes (byte-a-byte, sem tolerância)
  calculation_hash_strict: null, // Preencher após primeira execução
  schedule_usd_hash: null,       // Preencher após primeira execução
  
  // Financial Values (tolerância ±0,01)
  total_interest_usd: null,      // Preencher após primeira execução
  total_amortization_usd: 2573531.00, // Deve igualar amount_foreign
  final_balance_usd: 0.00,
  
  // Schedule Structure
  schedule_length: 60,
  
  // Metadata
  engine_version: "1.2.1",
  snapshot_quality: "STRICT",
  interest_source: "USD_NATIVE",
};

export default function ZeroRiskRegressionTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [testResults, setTestResults] = useState([]);
  
  const runTest = async () => {
    setRunning(true);
    setTestResults([]);
    
    const checks = [];
    
    try {
      // EXECUTAR CÁLCULO
      const calcResult = await calculateAmortizationSchedule(GOLDEN_INPUT);
      
      if (!calcResult || !calcResult.schedule) {
        checks.push({
          name: "Execução do Motor",
          status: "FAIL",
          message: "Motor falhou ao calcular schedule",
          critical: true
        });
        
        setTestResults(checks);
        setResult({ error: "Motor falhou" });
        setRunning(false);
        return;
      }
      
      setResult(calcResult);
      
      // =====================================
      // CHECK 1: Schedule Length (Estrutura)
      // =====================================
      const scheduleLength = calcResult.schedule.length;
      checks.push({
        name: "Estrutura: Número de Parcelas",
        status: scheduleLength === EXPECTED_VALUES.schedule_length ? "PASS" : "FAIL",
        expected: EXPECTED_VALUES.schedule_length,
        actual: scheduleLength,
        message: scheduleLength === EXPECTED_VALUES.schedule_length 
          ? "✓ Schedule length correto"
          : `✗ Schedule length mudou: esperado ${EXPECTED_VALUES.schedule_length}, obtido ${scheduleLength}`,
        critical: true
      });
      
      // =====================================
      // CHECK 2: Saldo Final USD = 0
      // =====================================
      const lastRow = calcResult.schedule[calcResult.schedule.length - 1];
      const finalBalanceUSD = lastRow?.sdFinal_USD || 0;
      const finalBalanceOK = Math.abs(finalBalanceUSD) <= 0.01;
      
      checks.push({
        name: "Convergência: Saldo Final USD",
        status: finalBalanceOK ? "PASS" : "FAIL",
        expected: "~0.00",
        actual: finalBalanceUSD.toFixed(4),
        message: finalBalanceOK
          ? "✓ Saldo final USD = 0 (convergência OK)"
          : `✗ Saldo final USD não é zero: ${finalBalanceUSD.toFixed(4)}`,
        critical: true
      });
      
      // =====================================
      // CHECK 3: Total Amortization USD
      // =====================================
      const totalAmortUSD = calcResult.schedule.reduce((s, r) => s + (r.amortizacao_USD || 0), 0);
      const amortDiff = Math.abs(totalAmortUSD - EXPECTED_VALUES.total_amortization_usd);
      const amortOK = amortDiff <= 0.01;
      
      checks.push({
        name: "Integridade: Total Amortização USD",
        status: amortOK ? "PASS" : "FAIL",
        expected: EXPECTED_VALUES.total_amortization_usd.toFixed(2),
        actual: totalAmortUSD.toFixed(2),
        diff: amortDiff.toFixed(4),
        message: amortOK
          ? "✓ Total amortização = Principal USD"
          : `✗ Divergência de ${amortDiff.toFixed(4)} USD`,
        critical: true
      });
      
      // =====================================
      // CHECK 4: Total Interest USD (se esperado preenchido)
      // =====================================
      const totalInterestUSD = calcResult.schedule.reduce((s, r) => s + (r.jurosTotal_USD || 0), 0);
      
      if (EXPECTED_VALUES.total_interest_usd !== null) {
        const interestDiff = Math.abs(totalInterestUSD - EXPECTED_VALUES.total_interest_usd);
        const interestOK = interestDiff <= 0.01;
        
        checks.push({
          name: "Imutabilidade: Total Interest USD",
          status: interestOK ? "PASS" : "FAIL",
          expected: EXPECTED_VALUES.total_interest_usd.toFixed(2),
          actual: totalInterestUSD.toFixed(2),
          diff: interestDiff.toFixed(4),
          message: interestOK
            ? "✓ Total juros USD inalterado"
            : `✗ Total juros USD mudou: diff ${interestDiff.toFixed(4)}`,
          critical: true
        });
      } else {
        checks.push({
          name: "Imutabilidade: Total Interest USD",
          status: "INFO",
          expected: "N/A (primeira execução)",
          actual: totalInterestUSD.toFixed(2),
          message: `ℹ️ Total Interest USD calculado: ${totalInterestUSD.toFixed(2)} (preencher EXPECTED_VALUES)`,
          critical: false
        });
      }
      
      // =====================================
      // CHECK 5: Calculation Hash Strict (CRITICAL)
      // =====================================
      const actualHashStrict = calcResult.calculation_metadata?.calculation_hash_strict;
      
      if (EXPECTED_VALUES.calculation_hash_strict !== null) {
        const hashMatch = actualHashStrict === EXPECTED_VALUES.calculation_hash_strict;
        
        checks.push({
          name: "CRITICAL: Calculation Hash Strict",
          status: hashMatch ? "PASS" : "FAIL",
          expected: EXPECTED_VALUES.calculation_hash_strict.substring(0, 16) + "...",
          actual: actualHashStrict?.substring(0, 16) + "...",
          message: hashMatch
            ? "✓ Hash de cálculo idêntico (motor não mudou)"
            : "🚨 CRITICAL: Hash de cálculo mudou! ROLLBACK NECESSÁRIO!",
          critical: true
        });
      } else {
        checks.push({
          name: "CRITICAL: Calculation Hash Strict",
          status: "INFO",
          expected: "N/A (primeira execução)",
          actual: actualHashStrict?.substring(0, 16) + "...",
          message: `ℹ️ Hash gerado: ${actualHashStrict} (preencher EXPECTED_VALUES)`,
          critical: false
        });
      }
      
      // =====================================
      // CHECK 6: Schedule USD Hash (CRITICAL)
      // =====================================
      const actualScheduleHash = calcResult.snapshot?.schedule_usd_hash;
      
      if (EXPECTED_VALUES.schedule_usd_hash !== null) {
        const schedHashMatch = actualScheduleHash === EXPECTED_VALUES.schedule_usd_hash;
        
        checks.push({
          name: "CRITICAL: Schedule USD Hash",
          status: schedHashMatch ? "PASS" : "FAIL",
          expected: EXPECTED_VALUES.schedule_usd_hash?.substring(0, 16) + "...",
          actual: actualScheduleHash?.substring(0, 16) + "...",
          message: schedHashMatch
            ? "✓ Schedule USD hash idêntico (resultado inalterado)"
            : "🚨 CRITICAL: Schedule USD hash mudou! ROLLBACK NECESSÁRIO!",
          critical: true
        });
      } else {
        checks.push({
          name: "CRITICAL: Schedule USD Hash",
          status: "INFO",
          expected: "N/A (primeira execução)",
          actual: actualScheduleHash?.substring(0, 16) + "...",
          message: actualScheduleHash 
            ? `ℹ️ Hash gerado: ${actualScheduleHash} (preencher EXPECTED_VALUES)`
            : "⚠️ Schedule USD hash não encontrado (preencher snapshot)",
          critical: false
        });
      }
      
      // =====================================
      // CHECK 7: Engine Version
      // =====================================
      const actualEngineVersion = calcResult.calculation_metadata?.engine_version;
      const versionMatch = actualEngineVersion === EXPECTED_VALUES.engine_version;
      
      checks.push({
        name: "Metadata: Engine Version",
        status: versionMatch ? "PASS" : "WARN",
        expected: EXPECTED_VALUES.engine_version,
        actual: actualEngineVersion,
        message: versionMatch
          ? "✓ Engine version correto"
          : `⚠️ Engine version mudou: ${actualEngineVersion} (verificar CHANGELOG)`,
        critical: false
      });
      
      // =====================================
      // CHECK 8: Snapshot Quality
      // =====================================
      const actualQuality = calcResult.snapshot?.snapshot_quality;
      const qualityMatch = actualQuality === EXPECTED_VALUES.snapshot_quality;
      
      checks.push({
        name: "Snapshot: Quality",
        status: qualityMatch ? "PASS" : "WARN",
        expected: EXPECTED_VALUES.snapshot_quality,
        actual: actualQuality || "N/A",
        message: qualityMatch
          ? "✓ Snapshot quality STRICT"
          : `⚠️ Snapshot quality: ${actualQuality} (esperado ${EXPECTED_VALUES.snapshot_quality})`,
        critical: false
      });
      
      // =====================================
      // CHECK 9: Interest Source
      // =====================================
      const actualInterestSource = calcResult.snapshot?.interest_source;
      const sourceMatch = actualInterestSource === EXPECTED_VALUES.interest_source;
      
      checks.push({
        name: "Snapshot: Interest Source",
        status: sourceMatch ? "PASS" : "WARN",
        expected: EXPECTED_VALUES.interest_source,
        actual: actualInterestSource || "N/A",
        message: sourceMatch
          ? "✓ Interest source = USD_NATIVE"
          : `⚠️ Interest source: ${actualInterestSource} (esperado ${EXPECTED_VALUES.interest_source})`,
        critical: false
      });
      
      setTestResults(checks);
    } catch (error) {
      checks.push({
        name: "Execução do Motor",
        status: "ERROR",
        message: `Erro: ${error.message}`,
        critical: true
      });
      
      setTestResults(checks);
      setResult({ error: error.message });
    } finally {
      setRunning(false);
    }
  };
  
  // Calcular status geral
  const criticalFails = testResults.filter(t => t.critical && t.status === "FAIL").length;
  const allPassed = testResults.every(t => t.status === "PASS" || t.status === "INFO" || t.status === "WARN");
  const overallStatus = criticalFails > 0 ? "ROLLBACK" : allPassed ? "PASS" : "WARN";
  
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold text-slate-900">
              🔐 Zero Risk Regression Test
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Garante que mudanças de UI/export não alteram cálculos validados
            </p>
          </div>
          
          <Button
            onClick={runTest}
            disabled={running}
            variant={overallStatus === "ROLLBACK" ? "destructive" : "default"}
            className="gap-2"
          >
            <PlayCircle className="w-4 h-4" />
            {running ? "Executando..." : "Rodar Teste"}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent>
        {testResults.length > 0 && (
          <div className="space-y-4">
            {/* Status Geral */}
            <div className={`p-4 rounded-lg border-2 ${
              overallStatus === "PASS" 
                ? "bg-green-50 border-green-300" 
                : overallStatus === "ROLLBACK"
                ? "bg-red-50 border-red-400"
                : "bg-yellow-50 border-yellow-300"
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {overallStatus === "PASS" && <CheckCircle2 className="w-6 h-6 text-green-600" />}
                  {overallStatus === "ROLLBACK" && <XCircle className="w-6 h-6 text-red-600" />}
                  {overallStatus === "WARN" && <AlertTriangle className="w-6 h-6 text-yellow-600" />}
                  
                  <div>
                    <h3 className="font-bold text-sm">
                      {overallStatus === "PASS" && "✓ TESTE PASSOU"}
                      {overallStatus === "ROLLBACK" && "🚨 ROLLBACK NECESSÁRIO"}
                      {overallStatus === "WARN" && "⚠️ AVISOS DETECTADOS"}
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {overallStatus === "PASS" && "Todos os checks críticos passaram. Motor não foi alterado."}
                      {overallStatus === "ROLLBACK" && `${criticalFails} checks críticos falharam. Desfaça as mudanças.`}
                      {overallStatus === "WARN" && "Checks não-críticos falharam. Revisar mudanças."}
                    </p>
                  </div>
                </div>
                
                <Badge variant={
                  overallStatus === "PASS" ? "default" : 
                  overallStatus === "ROLLBACK" ? "destructive" : 
                  "secondary"
                } className="text-xs">
                  {testResults.filter(t => t.status === "PASS").length}/{testResults.length} PASS
                </Badge>
              </div>
            </div>
            
            {/* Detalhes dos Checks */}
            <div className="space-y-2">
              {testResults.map((check, idx) => (
                <div key={idx} className={`p-3 rounded-lg border ${
                  check.status === "PASS" 
                    ? "bg-green-50 border-green-200" 
                    : check.status === "FAIL"
                    ? "bg-red-50 border-red-300"
                    : check.status === "INFO"
                    ? "bg-blue-50 border-blue-200"
                    : "bg-yellow-50 border-yellow-200"
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {check.status === "PASS" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                        {check.status === "FAIL" && <XCircle className="w-4 h-4 text-red-600" />}
                        {check.status === "ERROR" && <XCircle className="w-4 h-4 text-red-600" />}
                        {check.status === "INFO" && <AlertTriangle className="w-4 h-4 text-blue-500" />}
                        {check.status === "WARN" && <AlertTriangle className="w-4 h-4 text-yellow-600" />}
                        
                        <span className="font-semibold text-xs text-slate-800">
                          {check.name}
                          {check.critical && <span className="ml-2 text-red-600">[CRITICAL]</span>}
                        </span>
                      </div>
                      
                      <p className="text-xs text-slate-600 ml-6">{check.message}</p>
                      
                      {check.expected && (
                        <div className="text-[10px] text-slate-500 ml-6 mt-1 space-y-0.5">
                          <div>Esperado: <span className="">{check.expected}</span></div>
                          <div>Obtido: <span className="">{check.actual}</span></div>
                          {check.diff && <div>Diferença: <span className="">{check.diff}</span></div>}
                        </div>
                      )}
                    </div>
                    
                    <Badge variant={
                      check.status === "PASS" ? "default" : 
                      check.status === "FAIL" || check.status === "ERROR" ? "destructive" : 
                      check.status === "INFO" ? "secondary" :
                      "outline"
                    } className="text-[9px] px-1.5 py-0.5">
                      {check.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Instruções de Primeira Execução */}
            {testResults.some(t => t.status === "INFO") && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-xs text-blue-800 mb-2">
                  📝 PRIMEIRA EXECUÇÃO - Preencher EXPECTED_VALUES
                </h4>
                <p className="text-xs text-blue-700 mb-2">
                  Este é o baseline. Copie os valores abaixo para <code>EXPECTED_VALUES</code>:
                </p>
                <pre className="text-[10px] bg-white p-2 rounded border border-blue-200 overflow-x-auto">
{`calculation_hash_strict: "${result?.calculation_metadata?.calculation_hash_strict}",
schedule_usd_hash: "${result?.snapshot?.schedule_usd_hash || 'N/A'}",
total_interest_usd: ${result?.schedule?.reduce((s, r) => s + (r.jurosTotal_USD || 0), 0).toFixed(2)},`}
                </pre>
              </div>
            )}
          </div>
        )}
        
        {testResults.length === 0 && !running && (
          <div className="text-center py-8 text-slate-400">
            <PlayCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Clique em "Rodar Teste" para iniciar validação</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}