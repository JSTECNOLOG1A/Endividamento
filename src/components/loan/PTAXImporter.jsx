import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Upload, Trash2, DollarSign, Search, Calendar } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function PTAXImporter() {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [filterDate, setFilterDate] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [viewLimit, setViewLimit] = useState(10);
  const queryClient = useQueryClient();

  const { data: currencies, isLoading: loadingCurrencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => base44.entities.Currency.list("", 1000),
    initialData: [],
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const allRates = await base44.entities.Currency.list("", 10000);
      const usdRates = allRates.filter(r => r.currency_code === "USD");
      for (const rate of usdRates) {
        await base44.entities.Currency.delete(rate.id);
      }
      return usdRates.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["currencies"] });
      setResult({ success: true, message: `${count} taxas PTAX USD removidas com sucesso.` });
    },
    onError: (error) => {
      setResult({ success: false, message: `Erro ao remover taxas: ${error.message}` });
    }
  });

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setResult(null);
  };

  const handleImport = async () => {
    if (!file) {
      setResult({ success: false, message: "Selecione um arquivo CSV primeiro." });
      return;
    }

    setImporting(true);
    setResult(null);

    try {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());

      const parsed = [];
      const errors = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) continue;

        // Tentar múltiplos separadores: TAB, ponto-e-vírgula, pipe, espaços múltiplos
        let parts = [];
        
        if (line.includes('\t')) {
          parts = line.split('\t').map(p => p.trim()).filter(p => p);
        } else if (line.includes(';')) {
          parts = line.split(';').map(p => p.trim()).filter(p => p);
        } else if (line.includes('|')) {
          parts = line.split('|').map(p => p.trim()).filter(p => p);
        } else if (line.match(/\s{2,}/)) {
          // Múltiplos espaços
          parts = line.split(/\s{2,}/).map(p => p.trim()).filter(p => p);
        } else {
          // Colunas de largura fixa (formato original BACEN)
          const dateStr = line.substring(0, 8).trim();
          const code = line.substring(8, 12).trim();
          const type = line.substring(12, 13).trim();
          const currency = line.substring(13, 17).trim();
          const buyRate = line.substring(17, 25).trim();
          const sellRate = line.substring(25, 33).trim();
          
          if (dateStr && currency && buyRate) {
            parts = [dateStr, code, type, currency, buyRate, sellRate];
          }
        }
        
        if (parts.length < 4) {
          errors.push(`Linha ${i + 1}: formato inválido (${parts.length} campos encontrados). Linha: "${line.substring(0, 50)}..."`);
          continue;
        }

        const [dateStr, code, type, currency, ...rates] = parts;
        const buyRate = rates[0] || '';
        const sellRate = rates[1] || buyRate;

        // Debug primeira linha
        if (i === 0) {
          console.log('🔍 Primeira linha parseada:', { 
            dateStr, 
            code, 
            type, 
            currency, 
            buyRate, 
            sellRate,
            partsLength: parts.length,
            rawLine: line.substring(0, 100)
          });
        }

        // Validar moeda USD (case insensitive e trim)
        const normalizedCurrency = (currency || '').trim().toUpperCase();
        if (normalizedCurrency !== "USD") {
          if (i < 5) console.log(`Linha ${i + 1} ignorada: moeda="${currency}" normalizada="${normalizedCurrency}"`);
          continue; // Ignora outras moedas silenciosamente
        }

        // Parse data DDMMYYYY → YYYY-MM-DD
        if (dateStr.length !== 8) {
          errors.push(`Linha ${i + 1}: data inválida (esperado DDMMYYYY): ${dateStr}`);
          continue;
        }

        const day = dateStr.substring(0, 2);
        const month = dateStr.substring(2, 4);
        const year = dateStr.substring(4, 8);
        const isoDate = `${year}-${month}-${day}`;

        // Validar data
        const dateObj = new Date(isoDate);
        if (isNaN(dateObj.getTime())) {
          errors.push(`Linha ${i + 1}: data inválida: ${isoDate}`);
          continue;
        }

        // Parse taxa (usar taxa de venda - PTAX venda)
        const rate = parseFloat(sellRate.replace(",", "."));
        if (isNaN(rate) || rate <= 0) {
          errors.push(`Linha ${i + 1}: taxa inválida: ${sellRate}`);
          continue;
        }

        parsed.push({
          currency_code: "USD",
          currency_name: "Dólar Americano",
          exchange_rate: rate,
          rate_date: isoDate,
          status: "ativa",
        });
      }

      if (parsed.length === 0) {
        setResult({ 
          success: false, 
          message: "Nenhuma taxa USD válida encontrada no arquivo.",
          errors 
        });
        setImporting(false);
        return;
      }

      // Remover duplicatas por data (manter o último)
      const uniqueByDate = parsed.reduce((acc, curr) => {
        acc[curr.rate_date] = curr;
        return acc;
      }, {});

      const uniqueParsed = Object.values(uniqueByDate);

      // Inserir no banco
      let inserted = 0;
      const insertErrors = [];

      for (const entry of uniqueParsed) {
        try {
          // Verificar se já existe
          const existing = currencies.find(
            c => c.currency_code === "USD" && c.rate_date === entry.rate_date
          );

          if (existing) {
            // Atualizar
            await base44.entities.Currency.update(existing.id, entry);
          } else {
            // Criar
            await base44.entities.Currency.create(entry);
          }
          inserted++;
        } catch (err) {
          insertErrors.push(`${entry.rate_date}: ${err.message}`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["currencies"] });

      setResult({
        success: true,
        message: `${inserted} taxas PTAX USD importadas/atualizadas com sucesso.`,
        parsed: uniqueParsed.length,
        errors: [...errors, ...insertErrors],
      });
    } catch (error) {
      setResult({ success: false, message: `Erro ao processar arquivo: ${error.message}` });
    } finally {
      setImporting(false);
    }
  };

  const usdRates = currencies?.filter(c => c.currency_code === "USD") || [];
  
  // Aplicar filtros
  const filteredRates = usdRates.filter(rate => {
    if (filterDate) {
      const normalizedDate = rate.rate_date;
      if (!normalizedDate.includes(filterDate)) return false;
    }
    if (filterMonth) {
      const monthStr = rate.rate_date.substring(5, 7);
      if (monthStr !== filterMonth) return false;
    }
    if (filterYear) {
      const yearStr = rate.rate_date.substring(0, 4);
      if (yearStr !== filterYear) return false;
    }
    return true;
  });
  
  const sortedRates = [...filteredRates].sort((a, b) => b.rate_date.localeCompare(a.rate_date));

  return (
    <Card className="border-green-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-green-800">
          <DollarSign className="w-4 h-4 text-green-600" />
          Importar PTAX USD (Bacen)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Arquivo CSV do Bacen (PTAX USD)
          </Label>
          <Input
            type="file"
            accept=".csv,.txt"
            onChange={handleFileChange}
            className="h-9"
          />
          <p className="text-xs text-slate-500">
            Formato esperado: <code className="bg-slate-100 px-1 rounded">DDMMYYYY TAB 220 TAB A TAB USD TAB taxa_compra TAB taxa_venda TAB 1 TAB 1</code>
          </p>
          <p className="text-xs text-slate-400">
            Exemplo: <code className="bg-slate-100 px-1 rounded">02012026	220	A	USD	5,4366	5,4372	1	1</code>
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleImport}
            disabled={!file || importing || loadingCurrencies}
            className="bg-green-600 hover:bg-green-700"
          >
            <Upload className="w-4 h-4 mr-2" />
            {importing ? "Importando..." : "Importar PTAX USD"}
          </Button>
          {usdRates.length > 0 && (
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Limpar Todas USD
            </Button>
          )}
        </div>

        {result && (
          <div
            className={`p-3 rounded-lg border ${
              result.success
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-red-50 border-red-200 text-red-800"
            }`}
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold">{result.message}</p>
                {result.parsed && <p>Total de taxas únicas: {result.parsed}</p>}
                {result.errors && result.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-medium">
                      {result.errors.length} erros/avisos
                    </summary>
                    <ul className="mt-1 ml-4 list-disc space-y-0.5">
                      {result.errors.slice(0, 10).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                      {result.errors.length > 10 && (
                        <li className="text-slate-500">... e mais {result.errors.length - 10}</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}

        {usdRates.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Taxas Carregadas: {usdRates.length} {filteredRates.length !== usdRates.length && `(${filteredRates.length} filtradas)`}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFilterDate("");
                  setFilterMonth("");
                  setFilterYear("");
                }}
                className="h-7 text-xs"
              >
                Limpar Filtros
              </Button>
            </div>

            {/* Filtros */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-500">Data Específica (YYYY-MM-DD)</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="2026-01-15"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>
              
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-500">Mês (01-12)</Label>
                <div className="relative">
                  <Calendar className="absolute left-2 top-2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="01"
                    maxLength={2}
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>
              
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-500">Ano</Label>
                <div className="relative">
                  <Calendar className="absolute left-2 top-2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="2026"
                    maxLength={4}
                    value={filterYear}
                    onChange={(e) => setFilterYear(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Tabela de taxas */}
            <div className="bg-slate-50 rounded-lg p-3 text-xs space-y-1 max-h-96 overflow-y-auto">
              <div className="grid grid-cols-3 gap-2 sticky top-0 bg-slate-50 pb-1">
                <span className="font-semibold">Data</span>
                <span className="font-semibold text-right">Taxa (PTAX Venda)</span>
                <span className="font-semibold text-right">Status</span>
              </div>
              {sortedRates.slice(0, viewLimit).map((rate) => (
                <div key={rate.id} className="grid grid-cols-3 gap-2 text-slate-700 hover:bg-white/50 transition-colors px-1 py-0.5 rounded">
                  <span className="font-mono">{new Date(rate.rate_date).toLocaleDateString("pt-BR")}</span>
                  <span className="font-mono text-right">{rate.exchange_rate ? rate.exchange_rate.toFixed(4) : "—"}</span>
                  <span className="text-right text-green-600">{rate.status}</span>
                </div>
              ))}
              {sortedRates.length === 0 && (
                <p className="text-slate-500 text-center py-4">Nenhuma taxa encontrada com os filtros aplicados</p>
              )}
              {sortedRates.length > viewLimit && (
                <div className="text-center pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setViewLimit(prev => prev + 20)}
                    className="h-7 text-xs"
                  >
                    Carregar mais ({sortedRates.length - viewLimit} restantes)
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}