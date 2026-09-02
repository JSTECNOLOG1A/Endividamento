/**
 * 🧪 SUITE DE TESTES INSTITUCIONAL DO MOTOR DE CÁLCULO
 * 
 * OBJETIVO:
 * Garantir que o motor mantém integridade matemática em todos os cenários críticos.
 * 
 * CRITÉRIOS DE SUCESSO:
 * - Saldo final = 0 (tolerância ≤ 0.10 por arredondamentos)
 * - Soma das amortizações = principal (tolerância ≤ 1.00)
 * - Nenhum valor NaN ou Infinity
 * - Nenhum saldo devedor negativo indevido
 * - Parcelas consistentes com sistema de amortização
 * 
 * STATUS: OBRIGATÓRIO
 * Qualquer mudança no motor deve passar em 100% dos testes.
 */

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle, Play } from "lucide-react";
import { calculateAmortizationSchedule } from "./CalculationEngine";

/**
 * 📋 CASOS DE TESTE INSTITUCIONAIS
 */
const TESTS = [
  {
    id: "PRICE_SEM_CARENCIA",
    name: "PRICE sem carência",
    description: "Sistema PRICE puro, 12 parcelas, sem carência",
    scenario: {
      operationValue: 100000,
      fixedRate: 1.5,
      operationDate: "2026-01-15",
      principalInstallments: 12,
      interestInstallments: 12,
      principalFrequency: "1",
      interestFrequency: "1",
      calculationSystem: "PRICE",
      principalGraceMonths: 0,
      interestGraceMonths: 0,
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      // Saldo final deve ser zero
      checks.push({
        name: "Saldo final = 0",
        passed: Math.abs(lastRow.sdFinal) < 0.10,
        value: lastRow.sdFinal
      });
      
      // Soma das amortizações = principal
      const totalAmort = result.schedule.reduce((s, r) => s + r.amortizacao, 0);
      checks.push({
        name: "Σ Amortizações = Principal",
        passed: Math.abs(totalAmort - result.principal) < 1.00,
        value: `${totalAmort.toFixed(2)} vs ${result.principal.toFixed(2)}`
      });
      
      // Nenhum NaN ou Infinity
      const hasInvalid = result.schedule.some(r => 
        !Number.isFinite(r.prestacao) || !Number.isFinite(r.sdFinal)
      );
      checks.push({
        name: "Sem NaN/Infinity",
        passed: !hasInvalid,
        value: hasInvalid ? "DETECTADO" : "OK"
      });
      
      return checks;
    }
  },
  {
    id: "PRICE_CARENCIA_CAPITALIZADA",
    name: "PRICE com carência capitalizada",
    description: "PRICE com 6 meses de carência, juros capitalizados",
    scenario: {
      operationValue: 100000,
      fixedRate: 1.5,
      operationDate: "2026-01-15",
      principalInstallments: 12,
      interestInstallments: 12,
      principalFrequency: "1",
      interestFrequency: "1",
      calculationSystem: "PRICE",
      principalGraceMonths: 6,
      interestGraceMonths: 6,
      graceInterestBehavior: "CAPITALIZAR",
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      checks.push({
        name: "Saldo final = 0",
        passed: Math.abs(lastRow.sdFinal) < 0.10,
        value: lastRow.sdFinal
      });
      
      // Verificar que houve capitalização (SD cresceu nos primeiros 6 meses)
      const hasCapitalization = result.schedule.slice(0, 6).some(r => r.jurosCapitalizados > 0);
      checks.push({
        name: "Juros capitalizados na carência",
        passed: hasCapitalization,
        value: hasCapitalization ? "OK" : "FALHOU"
      });
      
      return checks;
    }
  },
  {
    id: "SAC_PADRAO",
    name: "SAC padrão",
    description: "Sistema SAC, 24 parcelas, sem carência",
    scenario: {
      operationValue: 100000,
      fixedRate: 1.5,
      operationDate: "2026-01-15",
      principalInstallments: 24,
      interestInstallments: 24,
      principalFrequency: "1",
      interestFrequency: "1",
      calculationSystem: "SAC",
      principalGraceMonths: 0,
      interestGraceMonths: 0,
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      checks.push({
        name: "Saldo final = 0",
        passed: Math.abs(lastRow.sdFinal) < 0.10,
        value: lastRow.sdFinal
      });
      
      // SAC: Amortização constante (exceto carência)
      const amortizations = result.schedule.filter(r => r.amortizacao > 0).map(r => r.amortizacao);
      const firstAmort = amortizations[0];
      const allEqual = amortizations.every(a => Math.abs(a - firstAmort) < 1.00);
      checks.push({
        name: "Amortização constante (SAC)",
        passed: allEqual,
        value: allEqual ? "OK" : "VARIÁVEL"
      });
      
      return checks;
    }
  },
  {
    id: "BULLET",
    name: "BULLET",
    description: "Pagamento único no vencimento (principal + juros)",
    scenario: {
      operationValue: 100000,
      fixedRate: 1.5,
      operationDate: "2026-01-15",
      finalMaturityDate: "2027-01-15",
      principalInstallments: 1,
      interestInstallments: 1,
      principalFrequency: "bullet",
      interestFrequency: "bullet",
      calculationSystem: "BULLET",
      totalTermMonths: 12,
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      checks.push({
        name: "Saldo final = 0",
        passed: Math.abs(lastRow.sdFinal) < 0.10,
        value: lastRow.sdFinal
      });
      
      // BULLET: Apenas última parcela tem amortização
      const amortizationCount = result.schedule.filter(r => r.amortizacao > 0).length;
      checks.push({
        name: "Pagamento único (BULLET)",
        passed: amortizationCount === 1,
        value: `${amortizationCount} pagamentos`
      });
      
      return checks;
    }
  },
  {
    id: "AMERICANO",
    name: "AMERICANO (juros periódicos)",
    description: "Juros mensais, principal no vencimento",
    scenario: {
      operationValue: 100000,
      fixedRate: 1.5,
      operationDate: "2026-01-15",
      finalMaturityDate: "2027-01-15",
      principalInstallments: 1,
      interestInstallments: 12,
      principalFrequency: "bullet",
      interestFrequency: "1",
      calculationSystem: "AMERICANO",
      totalTermMonths: 12,
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      checks.push({
        name: "Saldo final = 0",
        passed: Math.abs(lastRow.sdFinal) < 0.10,
        value: lastRow.sdFinal
      });
      
      // AMERICANO: Apenas última parcela tem amortização, demais têm juros
      const amortizationCount = result.schedule.filter(r => r.amortizacao > 0).length;
      const interestCount = result.schedule.filter(r => r.prestacao > 0 && r.amortizacao === 0).length;
      checks.push({
        name: "Juros periódicos + Principal final",
        passed: amortizationCount === 1 && interestCount >= 11,
        value: `${interestCount} juros, ${amortizationCount} principal`
      });
      
      return checks;
    }
  },
  {
    id: "OPERACAO_LONGA",
    name: "Operação longa (360 meses)",
    description: "Financiamento de 30 anos",
    scenario: {
      operationValue: 500000,
      fixedRate: 0.8,
      operationDate: "2026-01-15",
      principalInstallments: 360,
      interestInstallments: 360,
      principalFrequency: "1",
      interestFrequency: "1",
      calculationSystem: "SAC",
      principalGraceMonths: 0,
      interestGraceMonths: 0,
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      checks.push({
        name: "Saldo final = 0",
        passed: Math.abs(lastRow.sdFinal) < 0.10,
        value: lastRow.sdFinal
      });
      
      checks.push({
        name: "360 parcelas geradas",
        passed: result.schedule.length === 360,
        value: result.schedule.length
      });
      
      // Nenhum saldo negativo indevido
      const hasNegative = result.schedule.some(r => r.sdFinal < -0.10);
      checks.push({
        name: "Sem saldos negativos",
        passed: !hasNegative,
        value: hasNegative ? "DETECTADO" : "OK"
      });
      
      return checks;
    }
  },
  {
    id: "TAXA_ZERO",
    name: "Taxa zero",
    description: "Operação sem juros (0% a.a.)",
    scenario: {
      operationValue: 100000,
      fixedRate: 0,
      operationDate: "2026-01-15",
      principalInstallments: 12,
      interestInstallments: 12,
      principalFrequency: "1",
      interestFrequency: "1",
      calculationSystem: "SAC",
      principalGraceMonths: 0,
      interestGraceMonths: 0,
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      checks.push({
        name: "Saldo final = 0",
        passed: Math.abs(lastRow.sdFinal) < 0.10,
        value: lastRow.sdFinal
      });
      
      // Juros devem ser zero
      const totalJuros = result.schedule.reduce((s, r) => s + r.jurosFixosMes + r.jurosVariaveisMes, 0);
      checks.push({
        name: "Juros totais = 0",
        passed: Math.abs(totalJuros) < 0.10,
        value: totalJuros.toFixed(2)
      });
      
      return checks;
    }
  },
  {
    id: "CARENCIA_LONGA",
    name: "Carência longa (24 meses)",
    description: "2 anos de carência com capitalização",
    scenario: {
      operationValue: 100000,
      fixedRate: 1.5,
      operationDate: "2026-01-15",
      principalInstallments: 12,
      interestInstallments: 12,
      principalFrequency: "1",
      interestFrequency: "1",
      calculationSystem: "PRICE",
      principalGraceMonths: 24,
      interestGraceMonths: 24,
      graceInterestBehavior: "CAPITALIZAR",
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      checks.push({
        name: "Saldo final = 0",
        passed: Math.abs(lastRow.sdFinal) < 0.10,
        value: lastRow.sdFinal
      });
      
      // Verificar que SD cresceu durante carência
      const row24 = result.schedule[23]; // Mês 24
      checks.push({
        name: "SD cresceu na carência",
        passed: row24.sdFinal > result.principal,
        value: `${row24.sdFinal.toFixed(2)} > ${result.principal.toFixed(2)}`
      });
      
      return checks;
    }
  },
  {
    id: "USD_CAMBIO",
    name: "Operação em USD com câmbio",
    description: "Financiamento em dólar com PTAX",
    scenario: {
      operationValue: 100000,
      amount_foreign: 20000,
      currencyId: "USD",
      exchangeLag: 1,
      exchangeRates: [
        { rate_date: "2026-01-14", ptax_rate: 5.0, source: "BCB" },
        { rate_date: "2026-02-13", ptax_rate: 5.1, source: "BCB" },
        { rate_date: "2026-03-13", ptax_rate: 5.2, source: "BCB" },
        { rate_date: "2026-04-13", ptax_rate: 5.15, source: "BCB" }
      ],
      fixedRate: 1.5,
      operationDate: "2026-01-15",
      principalInstallments: 3,
      interestInstallments: 3,
      principalFrequency: "1",
      interestFrequency: "1",
      calculationSystem: "SAC",
      principalGraceMonths: 0,
      interestGraceMonths: 0,
      cdiRates: [],
      holidays: []
    },
    validate: (result) => {
      const checks = [];
      const lastRow = result.schedule[result.schedule.length - 1];
      
      checks.push({
        name: "Saldo final USD = 0",
        passed: Math.abs(lastRow.sdFinal_USD || 0) < 0.10,
        value: (lastRow.sdFinal_USD || 0).toFixed(2)
      });
      
      // Verificar que houve variação cambial
      const hasVarCambial = result.schedule.some(r => Math.abs(r.varCambial || 0) > 0.01);
      checks.push({
        name: "Variação cambial detectada",
        passed: hasVarCambial,
        value: hasVarCambial ? "OK" : "AUSENTE"
      });
      
      return checks;
    }
  }
];

/**
 * Componente de Suite de Testes
 */
export default function EngineTestSuite() {
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);

  const runTest = async (test) => {
    try {
      const result = await calculateAmortizationSchedule(test.scenario);
      const checks = test.validate(result);
      const passed = checks.every(c => c.passed);
      
      return {
        id: test.id,
        name: test.name,
        passed,
        checks,
        schedule: result.schedule.slice(0, 10), // Primeiras 10 linhas
        error: null
      };
    } catch (error) {
      return {
        id: test.id,
        name: test.name,
        passed: false,
        checks: [],
        error: error.message
      };
    }
  };

  const runAllTests = async () => {
    setRunning(true);
    const testResults = [];
    
    for (const test of TESTS) {
      const result = await runTest(test);
      testResults.push(result);
    }
    
    setResults(testResults);
    setRunning(false);
  };

  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-800">
            🧪 Suite de Testes Institucional
          </CardTitle>
          <Button
            onClick={runAllTests}
            disabled={running}
            size="sm"
            className="gap-1.5 text-xs"
          >
            <Play className="w-3.5 h-3.5" />
            {running ? "Executando..." : "Executar Testes"}
          </Button>
        </div>
        {results.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <Badge variant={passedCount === totalCount ? "default" : "destructive"}>
              {passedCount} / {totalCount} Passaram
            </Badge>
            {passedCount === totalCount && (
              <span className="text-xs text-green-600 font-medium">✓ Motor validado</span>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {results.length === 0 && (
          <p className="text-xs text-slate-600 text-center py-4">
            Clique em "Executar Testes" para validar o motor
          </p>
        )}
        {results.map((result) => (
          <TestResult key={result.id} result={result} />
        ))}
      </CardContent>
    </Card>
  );
}

function TestResult({ result }) {
  const [expanded, setExpanded] = React.useState(false);
  
  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          {result.passed ? (
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          )}
          <div>
            <p className="text-xs font-medium text-slate-800">{result.name}</p>
            {result.error && (
              <p className="text-xs text-red-600 mt-1">{result.error}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="text-xs h-6 px-2"
        >
          {expanded ? "Ocultar" : "Ver detalhes"}
        </Button>
      </div>
      
      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-2">
          {result.checks.map((check, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <span className={check.passed ? "text-slate-600" : "text-red-600"}>
                {check.passed ? "✓" : "✗"} {check.name}
              </span>
              <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{check.value}</code>
            </div>
          ))}
          
          {result.schedule && result.schedule.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-slate-600 mb-1">Primeiras 10 parcelas:</p>
              <div className="bg-slate-50 rounded p-2 overflow-x-auto">
                <table className="text-[11px] w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left pb-1">Parc</th>
                      <th className="text-right pb-1">SD Ini</th>
                      <th className="text-right pb-1">Amort</th>
                      <th className="text-right pb-1">PMT</th>
                      <th className="text-right pb-1">SD Fin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.schedule.map((row) => (
                      <tr key={row.parcela}>
                        <td className="py-0.5">{row.parcela}</td>
                        <td className="text-right">{row.sdInicial.toFixed(2)}</td>
                        <td className="text-right">{row.amortizacao.toFixed(2)}</td>
                        <td className="text-right">{row.prestacao.toFixed(2)}</td>
                        <td className="text-right">{row.sdFinal.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}