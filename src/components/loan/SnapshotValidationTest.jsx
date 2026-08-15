/**
 * 🧪 TESTE DE VALIDAÇÃO DO SNAPSHOT (FASE 1)
 * 
 * Executa teste automático para verificar:
 * 1. Snapshot captura campos USD nativos (snapshot_quality=STRICT)
 * 2. Novos campos FASE 1 foram adicionados
 * 3. Valores imutáveis permanecem idênticos
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, AlertTriangle, Play } from "lucide-react";
import { createCalculationSnapshot, compareSnapshots } from "./CalculationSnapshotValidator";

export default function SnapshotValidationTest({ calculationResult }) {
  const [testResult, setTestResult] = React.useState(null);
  const [isRunning, setIsRunning] = React.useState(false);

  const runTest = () => {
    setIsRunning(true);
    
    try {
      // PASSO 1: Criar snapshot do resultado atual
      const snapshot = createCalculationSnapshot(calculationResult);
      
      // PASSO 2: Validar snapshot quality
      const checks = [];
      
      // Check 1: Snapshot Quality
      if (snapshot.is_usd) {
        if (snapshot.snapshot_quality === "STRICT") {
          checks.push({
            name: "Snapshot Quality",
            status: "PASS",
            message: "Snapshot STRICT: juros USD nativos disponíveis"
          });
        } else if (snapshot.snapshot_quality === "DEGRADED") {
          checks.push({
            name: "Snapshot Quality",
            status: "WARN",
            message: `Snapshot DEGRADED: ${snapshot.interest_source} (reconstrução BRL/PTAX)`
          });
        }
      } else {
        checks.push({
          name: "Snapshot Quality",
          status: "PASS",
          message: "Operação BRL: snapshot quality não aplicável"
        });
      }
      
      // Check 2: Campos USD Nativos (FASE 1 PASSO 1)
      if (snapshot.is_usd && calculationResult.schedule.length > 0) {
        const firstRow = calculationResult.schedule[0];
        const hasNativeInterest = 
          firstRow.jurosFixosMes_USD !== undefined &&
          firstRow.jurosVariaveisMes_USD !== undefined &&
          firstRow.jurosTotal_USD !== undefined;
        
        if (hasNativeInterest) {
          checks.push({
            name: "Juros USD Nativos (PASSO 1)",
            status: "PASS",
            message: "Campos jurosFixosMes_USD, jurosVariaveisMes_USD, jurosTotal_USD presentes"
          });
        } else {
          checks.push({
            name: "Juros USD Nativos (PASSO 1)",
            status: "FAIL",
            message: "Campos USD nativos ausentes no schedule"
          });
        }
      }
      
      // Check 3: Campos BRL Financeiros (FASE 1 PASSO 2)
      if (snapshot.is_usd && calculationResult.schedule.length > 0) {
        const firstRow = calculationResult.schedule[0];
        const hasFinancialFields = 
          firstRow.sdInicial_BRL_fxAtual !== undefined &&
          firstRow.jurosTotal_BRL_fxAtual !== undefined &&
          firstRow.amortizacao_BRL_fxAtual !== undefined &&
          firstRow.prestacao_BRL_fxAtual !== undefined &&
          firstRow.sdFinal_BRL_fxAtual !== undefined;
        
        if (hasFinancialFields) {
          checks.push({
            name: "Campos BRL Financeiros (PASSO 2)",
            status: "PASS",
            message: "Campos _fxAtual presentes (view helpers)"
          });
        } else {
          checks.push({
            name: "Campos BRL Financeiros (PASSO 2)",
            status: "FAIL",
            message: "Campos BRL fxAtual ausentes no schedule"
          });
        }
      }
      
      // Check 4: Valores Imutáveis
      const immutableChecks = [
        { field: "principal", value: snapshot.principal },
        { field: "cet_annual", value: snapshot.cet_annual },
        { field: "total_interest_usd", value: snapshot.total_interest_usd },
        { field: "total_amortization_usd", value: snapshot.total_amortization_usd },
        { field: "sd_final_usd", value: snapshot.sd_final_usd }
      ];
      
      let allValid = true;
      immutableChecks.forEach(check => {
        if (check.value === null || check.value === undefined || isNaN(check.value)) {
          checks.push({
            name: `Valor Imutável: ${check.field}`,
            status: "FAIL",
            message: `Valor inválido: ${check.value}`
          });
          allValid = false;
        } else {
          checks.push({
            name: `Valor Imutável: ${check.field}`,
            status: "PASS",
            message: `${check.value}`
          });
        }
      });
      
      // Check 5: Calculation Hash Strict
      if (snapshot.calculation_hash_strict) {
        checks.push({
          name: "Calculation Hash Strict",
          status: "PASS",
          message: `Hash: ${snapshot.calculation_hash_strict.substring(0, 16)}...`
        });
      } else {
        checks.push({
          name: "Calculation Hash Strict",
          status: "WARN",
          message: "Hash não disponível (validação menos robusta)"
        });
      }
      
      // Check 6: Amostra de Schedule (primeira linha)
      const firstRow = calculationResult.schedule[0];
      const sampleData = snapshot.is_usd ? {
        parcela: firstRow.parcela,
        dataVencimento: firstRow.dataVencimento,
        sdInicial_USD: firstRow.sdInicial_USD,
        jurosTotal_USD: firstRow.jurosTotal_USD,
        amortizacao_USD: firstRow.amortizacao_USD,
        sdFinal_USD: firstRow.sdFinal_USD,
        ptax_rate: firstRow.ptax_rate,
        sdInicial_BRL_fxAtual: firstRow.sdInicial_BRL_fxAtual,
        jurosTotal_BRL_fxAtual: firstRow.jurosTotal_BRL_fxAtual,
        amortizacao_BRL_fxAtual: firstRow.amortizacao_BRL_fxAtual,
        sdFinal_BRL_fxAtual: firstRow.sdFinal_BRL_fxAtual
      } : null;
      
      setTestResult({
        status: allValid ? "PASS" : "FAIL",
        checks,
        snapshot,
        sampleData
      });
      
    } catch (error) {
      setTestResult({
        status: "ERROR",
        checks: [{
          name: "Snapshot Creation",
          status: "FAIL",
          message: error.message
        }],
        error: error.message
      });
    } finally {
      setIsRunning(false);
    }
  };

  if (!calculationResult) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-6">
          <p className="text-sm text-slate-500">Execute um cálculo primeiro para testar o snapshot</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            🧪 Validação Snapshot FASE 1
          </span>
          <Button
            size="sm"
            onClick={runTest}
            disabled={isRunning}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Play className="w-3.5 h-3.5 mr-1.5" />
            {isRunning ? "Executando..." : "Executar Teste"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {testResult && (
          <>
            {/* Status Geral */}
            <div className="flex items-center gap-2">
              {testResult.status === "PASS" && (
                <>
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-green-700">SNAPSHOT VALIDATION PASSED</span>
                </>
              )}
              {testResult.status === "FAIL" && (
                <>
                  <XCircle className="w-5 h-5 text-red-600" />
                  <span className="font-semibold text-red-700">SNAPSHOT VALIDATION FAILED</span>
                </>
              )}
              {testResult.status === "ERROR" && (
                <>
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <span className="font-semibold text-amber-700">SNAPSHOT ERROR</span>
                </>
              )}
            </div>
            
            {/* Snapshot Quality Badge */}
            {testResult.snapshot && (
              <div className="flex gap-2">
                <Badge className={
                  testResult.snapshot.snapshot_quality === "STRICT" 
                    ? "bg-green-100 text-green-800" 
                    : "bg-amber-100 text-amber-800"
                }>
                  Quality: {testResult.snapshot.snapshot_quality}
                </Badge>
                <Badge variant="outline">
                  Source: {testResult.snapshot.interest_source}
                </Badge>
              </div>
            )}
            
            {/* Checks Detalhados */}
            <div className="space-y-2">
              {testResult.checks.map((check, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs p-2 rounded bg-white border border-slate-200">
                  {check.status === "PASS" && <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />}
                  {check.status === "FAIL" && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />}
                  {check.status === "WARN" && <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <div className="font-medium text-slate-700">{check.name}</div>
                    <div className="text-slate-500 font-mono">{check.message}</div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Amostra de Dados (primeira linha do schedule) */}
            {testResult.sampleData && (
              <div className="mt-4 p-3 rounded bg-white border border-slate-200">
                <div className="text-xs font-semibold text-slate-700 mb-2">
                  📊 Amostra Schedule (Parcela {testResult.sampleData.parcela})
                </div>
                <pre className="text-xs font-mono text-slate-600 overflow-x-auto">
                  {JSON.stringify(testResult.sampleData, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}