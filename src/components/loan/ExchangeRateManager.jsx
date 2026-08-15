import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Upload, CheckCircle2, Trash2 } from "lucide-react";

/**
 * ExchangeRateManager
 * Gerencia upload e parsing de taxas PTAX para operações em moeda estrangeira
 * FASE 1: Upload manual via CSV
 * FASE 2: API BACEN (futuro)
 */
export default function ExchangeRateManager({ onRatesLoaded, initialRates = [] }) {
  const [rates, setRates] = useState(initialRates);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  /**
   * Parser CSV
   * Espera: rate_date, ptax_rate (headers opcionais)
   * Linhas: YYYY-MM-DD, 5.10
   */
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const text = await file.text();
      const lines = text.trim().split("\n");
      
      if (lines.length < 1) {
        throw new Error("Arquivo vazio");
      }

      const parsed = [];

      // Detectar se primeira linha é header
      const firstLine = lines[0];
      const hasHeader = firstLine.match(/date|rate|taxa/i);
      const startIdx = hasHeader ? 1 : 0;

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parser flexível: suporta vírgula ou ponto-e-vírgula
        const parts = line.includes(";") 
          ? line.split(";") 
          : line.split(",");

        if (parts.length < 2) {
          throw new Error(`Linha ${i + 1}: Formato inválido. Esperado: data, taxa`);
        }

        const dateStr = parts[0].trim();
        const rateStr = parts[1].trim();

        // Validar data (YYYY-MM-DD)
        if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          throw new Error(`Linha ${i + 1}: Data inválida "${dateStr}". Use YYYY-MM-DD`);
        }

        // Validar taxa (número positivo)
        const rate = parseFloat(rateStr);
        if (isNaN(rate) || rate <= 0) {
          throw new Error(`Linha ${i + 1}: Taxa inválida "${rateStr}". Deve ser número > 0`);
        }

        // Verificar duplicatas
        if (parsed.some(p => p.rate_date === dateStr)) {
          throw new Error(`Linha ${i + 1}: Data duplicada "${dateStr}"`);
        }

        parsed.push({
          rate_date: dateStr,
          ptax_rate: roundTo(rate, 4),
          source: "MANUAL",
          created_at: new Date().toISOString(),
        });
      }

      if (parsed.length === 0) {
        throw new Error("Nenhuma taxa foi parsing");
      }

      // Ordenar CRESCENTE por data (para Nearest Past search)
      parsed.sort((a, b) => a.rate_date.localeCompare(b.rate_date));

      setRates(parsed);
      onRatesLoaded(parsed);
      setSuccess(`✅ ${parsed.length} taxa(s) carregada(s) com sucesso`);
    } catch (err) {
      setError(`❌ Erro ao processar arquivo: ${err.message}`);
      console.error("ExchangeRateManager upload error:", err);
    } finally {
      setLoading(false);
      e.target.value = ""; // Reset input
    }
  };

  const handleClear = () => {
    setRates([]);
    onRatesLoaded([]);
    setSuccess(null);
    setError(null);
  };

  const getDateRange = () => {
    if (rates.length === 0) return null;
    return {
      start: rates[0].rate_date,
      end: rates[rates.length - 1].rate_date,
      count: rates.length,
    };
  };

  const range = getDateRange();

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-blue-900">
          <Upload className="w-4 h-4 text-blue-600" />
          Gerenciador de Taxas de Câmbio (PTAX)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-blue-700 uppercase tracking-wider">
            Carregar CSV com Histórico PTAX
          </Label>
          <div className="flex gap-2">
            <Input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              disabled={loading}
              className="border-blue-300 file:bg-blue-600 file:text-white file:border-0 file:rounded-md file:px-3 file:py-1 file:text-sm file:font-medium"
            />
            {rates.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClear}
                className="border-red-300 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-blue-600">
            Formato: YYYY-MM-DD, taxa (ex: 2025-01-02, 5.10)
          </p>
        </div>

        {/* Error */}
        {error && (
          <Alert className="border-red-300 bg-red-50 text-red-700">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* Success */}
        {success && (
          <Alert className="border-green-300 bg-green-50 text-green-700">
            <CheckCircle2 className="w-4 h-4" />
            <AlertDescription className="text-xs">{success}</AlertDescription>
          </Alert>
        )}

        {/* Summary */}
        {rates.length > 0 && (
          <div className="p-3 rounded-lg bg-white border border-blue-200 space-y-2">
            <div className="text-xs font-semibold text-blue-900">
              📊 {rates.length} taxa(s) carregada(s)
            </div>
            <div className="text-xs text-blue-700 space-y-1">
              <div>📅 Período: {range.start} até {range.end}</div>
              <div>💱 Taxa mínima: {Math.min(...rates.map(r => r.ptax_rate)).toFixed(4)}</div>
              <div>💱 Taxa máxima: {Math.max(...rates.map(r => r.ptax_rate)).toFixed(4)}</div>
              <div>📈 Taxa média: {(rates.reduce((s, r) => s + r.ptax_rate, 0) / rates.length).toFixed(4)}</div>
            </div>
            <div className="text-xs text-blue-600 mt-2 p-2 bg-blue-100 rounded">
              ✅ Taxas prontas para usar no cálculo do contrato
            </div>
          </div>
        )}

        {/* Empty state */}
        {rates.length === 0 && (
          <div className="p-4 rounded-lg bg-white border border-blue-200 text-center text-xs text-blue-700">
            Nenhuma taxa carregada. Envie um CSV para começar.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function roundTo(num, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(num * f) / f;
}