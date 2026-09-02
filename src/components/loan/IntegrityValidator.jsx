/**
 * FASE 5 - VALIDAÇÃO AUTOMÁTICA DE INTEGRIDADE
 * 
 * Garante que nenhuma alteração UI/apresentação tenha afetado
 * os valores matemáticos validados do engine.
 * 
 * CRITICAL: Se qualquer valor divergir, BLOQUEIA exports e sinaliza erro.
 */

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";

/**
 * Valida integridade matemática entre dois resultados de cálculo
 * @param {Object} beforeResult - Resultado "antes" da mudança
 * @param {Object} afterResult - Resultado "depois" da mudança
 * @param {string} currency - "BRL" ou "USD"
 * @returns {Object} { passed, checks, summary }
 */
export function validateIntegrity(beforeResult, afterResult, currency = "BRL") {
  const checks = [];
  const TOLERANCE = 0.01; // ±1 centavo na moeda base

  // 1. CET (sempre validar)
  const cetBefore = beforeResult.cet || beforeResult.cetAnnual || 0;
  const cetAfter = afterResult.cet || afterResult.cetAnnual || 0;
  const cetDelta = Math.abs(cetAfter - cetBefore);
  checks.push({
    field: "CET",
    before: cetBefore.toFixed(4),
    after: cetAfter.toFixed(4),
    delta: cetDelta.toFixed(6),
    passed: cetDelta < TOLERANCE,
    critical: true
  });

  // 2. Principal (sempre validar)
  const principalBefore = beforeResult.principal || 0;
  const principalAfter = afterResult.principal || 0;
  const principalDelta = Math.abs(principalAfter - principalBefore);
  checks.push({
    field: "Principal",
    before: principalBefore.toFixed(2),
    after: principalAfter.toFixed(2),
    delta: principalDelta.toFixed(2),
    passed: principalDelta < TOLERANCE,
    critical: true
  });

  // 3-5. Validações USD (se aplicável)
  if (currency === "USD" || beforeResult.schedule?.[0]?.sdInicial_USD !== undefined) {
    const scheduleBefore = beforeResult.schedule || [];
    const scheduleAfter = afterResult.schedule || [];

    // 3. SD Final USD (última parcela)
    const lastRowBefore = scheduleBefore[scheduleBefore.length - 1];
    const lastRowAfter = scheduleAfter[scheduleAfter.length - 1];
    const sdFinalBefore = lastRowBefore?.sdFinal_USD || 0;
    const sdFinalAfter = lastRowAfter?.sdFinal_USD || 0;
    const sdFinalDelta = Math.abs(sdFinalAfter - sdFinalBefore);
    checks.push({
      field: "SD Final USD (última parcela)",
      before: sdFinalBefore.toFixed(2),
      after: sdFinalAfter.toFixed(2),
      delta: sdFinalDelta.toFixed(2),
      passed: sdFinalDelta < TOLERANCE,
      critical: true
    });

    // 4. Soma Amortização USD
    const totalAmortBefore = scheduleBefore.reduce((sum, r) => sum + (r.amortizacao_USD || 0), 0);
    const totalAmortAfter = scheduleAfter.reduce((sum, r) => sum + (r.amortizacao_USD || 0), 0);
    const amortDelta = Math.abs(totalAmortAfter - totalAmortBefore);
    checks.push({
      field: "Total Amortização USD",
      before: totalAmortBefore.toFixed(2),
      after: totalAmortAfter.toFixed(2),
      delta: amortDelta.toFixed(2),
      passed: amortDelta < TOLERANCE,
      critical: true
    });

    // 5. Total Juros USD
    const totalJurosBefore = scheduleBefore.reduce((sum, r) => sum + (r.jurosTotal_USD || 0), 0);
    const totalJurosAfter = scheduleAfter.reduce((sum, r) => sum + (r.jurosTotal_USD || 0), 0);
    const jurosDelta = Math.abs(totalJurosAfter - totalJurosBefore);
    checks.push({
      field: "Total Juros USD",
      before: totalJurosBefore.toFixed(2),
      after: totalJurosAfter.toFixed(2),
      delta: jurosDelta.toFixed(2),
      passed: jurosDelta < TOLERANCE,
      critical: true
    });
  }

  const allPassed = checks.every(c => c.passed);
  const criticalFailed = checks.filter(c => c.critical && !c.passed);

  return {
    passed: allPassed,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter(c => c.passed).length,
      failed: checks.filter(c => !c.passed).length,
      criticalFailed: criticalFailed.length
    }
  };
}

/**
 * Componente UI para validação de integridade
 */
export default function IntegrityValidator({ beforeResult, afterResult, currency, phaseName }) {
  const [validation, setValidation] = useState(null);

  const handleValidate = () => {
    const result = validateIntegrity(beforeResult, afterResult, currency);
    setValidation(result);
  };

  React.useEffect(() => {
    if (beforeResult && afterResult) {
      handleValidate();
    }
  }, [beforeResult, afterResult, currency]);

  if (!beforeResult || !afterResult) {
    return (
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-sm">🔐 Validação de Integridade</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-600">
            Aguardando resultados "antes" e "depois" para validar...
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border-2 ${validation?.passed ? "border-green-300 bg-green-50/30" : validation ? "border-red-400 bg-red-50/30" : "border-slate-200"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            🔐 Validação de Integridade {phaseName && `(${phaseName})`}
          </CardTitle>
          {validation && (
            <Badge variant={validation.passed ? "default" : "destructive"} className="text-xs">
              {validation.passed ? "✅ PASSED" : "❌ FAILED"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {validation && (
          <div className="space-y-3">
            {/* Summary */}
            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-600">
                Total: <strong>{validation.summary.total}</strong> checks
              </span>
              <span className="text-green-700">
                ✓ Passed: <strong>{validation.summary.passed}</strong>
              </span>
              {validation.summary.failed > 0 && (
                <span className="text-red-700">
                  ✗ Failed: <strong>{validation.summary.failed}</strong>
                </span>
              )}
            </div>

            {/* Checks */}
            <div className="space-y-2">
              {validation.checks.map((check, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-2 rounded border text-xs ${
                    check.passed
                      ? "bg-green-50/50 border-green-200"
                      : "bg-red-50 border-red-300"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-1">
                    {check.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    )}
                    <span className="font-semibold text-slate-700">{check.field}:</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="text-slate-600">{check.before}</span>
                    <span className="text-slate-500">→</span>
                    <span className={check.passed ? "text-green-700" : "text-red-700 font-bold"}>
                      {check.after}
                    </span>
                    <Badge variant={check.passed ? "outline" : "destructive"} className="text-[8px] px-1.5 py-0">
                      Δ {check.delta}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            {/* Critical Failure Warning */}
            {!validation.passed && validation.summary.criticalFailed > 0 && (
              <div className="flex items-start gap-2 p-3 bg-red-100 border-2 border-red-400 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-900">🚨 CRITICAL FAILURE</p>
                  <p className="text-xs text-red-800 mt-1">
                    {validation.summary.criticalFailed} campo(s) crítico(s) divergiram.
                    <br />
                    <strong>AÇÃO OBRIGATÓRIA:</strong> ROLLBACK imediato. Exports bloqueados.
                  </p>
                </div>
              </div>
            )}

            {/* Success Message */}
            {validation.passed && (
              <div className="flex items-center gap-2 p-2 bg-green-100 border border-green-300 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-green-700" />
                <p className="text-xs text-green-800 font-semibold">
                  ✅ Integridade matemática preservada. Mudanças seguras.
                </p>
              </div>
            )}
          </div>
        )}

        {!validation && (
          <Button size="sm" onClick={handleValidate} className="text-xs">
            Validar Integridade
          </Button>
        )}
      </CardContent>
    </Card>
  );
}