import React, { useState, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileUp, Database, ChevronLeft, ChevronRight, AlertCircle, Trash2, Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { computeBacenStartDate, todayIso } from "@/lib/bacenAutoImport";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const HEAD_CLASS = "text-[11px] font-bold text-slate-700 uppercase tracking-wide whitespace-nowrap px-2 py-2 border-b-2 border-slate-200 text-center";
const DAY_LABEL_CLASS = "text-[11px] font-semibold text-slate-500 whitespace-nowrap px-2 py-1.5 bg-slate-50 text-center sticky left-0";

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function indexByYear(rates) {
  const byYear = new Map();
  for (const r of rates) {
    const year = r.rate_date.slice(0, 4);
    const monthDay = r.rate_date.slice(5);
    if (!byYear.has(year)) byYear.set(year, new Map());
    byYear.get(year).set(monthDay, r);
  }
  return byYear;
}

// Grade calendário (dia × mês) por ano — mesmo formato de CDIImporter.jsx,
// pra série diária caber numa tela só sem paginação.
function PTAXYearGrid({ rates }) {
  const byYear = useMemo(() => indexByYear(rates), [rates]);
  const years = useMemo(() => [...byYear.keys()].sort((a, b) => b.localeCompare(a)), [byYear]);
  const [year, setYear] = useState(years[0] || String(new Date().getFullYear()));

  React.useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);

  if (!years.length) return null;

  const yearData = byYear.get(year) || new Map();
  const yearNum = Number(year);
  const yearIdx = years.indexOf(year);

  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Search className="w-4 h-4 text-blue-600" />
            Consulta de Taxas PTAX
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={yearIdx >= years.length - 1}
              onClick={() => setYear(years[yearIdx + 1])}
              title="Ano anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={yearIdx <= 0}
              onClick={() => setYear(years[yearIdx - 1])}
              title="Próximo ano"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px] text-[11px]">
            <thead>
              <tr>
                <th className={`${HEAD_CLASS} bg-slate-50`}>Dia</th>
                {MONTH_LABELS.map((label, monthIdx) => (
                  <th key={label} className={`${HEAD_CLASS} ${monthIdx % 2 === 0 ? "bg-slate-50" : "bg-slate-100"}`}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <tr key={day} className="border-b border-slate-100">
                  <td className={DAY_LABEL_CLASS}>{day}</td>
                  {MONTH_LABELS.map((_, monthIdx) => {
                    const stripe = monthIdx % 2 === 0 ? "bg-white" : "bg-slate-50";
                    const validDay = day <= daysInMonth(yearNum, monthIdx);
                    if (!validDay) {
                      return <td key={monthIdx} className={stripe} />;
                    }
                    const key = `${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const rate = yearData.get(key);
                    return (
                      <td
                        key={monthIdx}
                        className={`text-[11px] text-center px-2 py-1.5 tabular-nums text-slate-700 ${stripe}`}
                        title={rate ? `R$ ${rate.exchange_rate.toFixed(4)} — ${rate.status}` : undefined}
                      >
                        {rate ? rate.exchange_rate.toFixed(2) : <span className="text-slate-300">·</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 px-3 py-2 border-t border-slate-100">
          Valores em R$ (venda) — passe o mouse sobre uma célula pra ver a cotação completa e o status.
          "·" = sem cotação nesse dia (fim de semana ou feriado).
        </p>
      </CardContent>
    </Card>
  );
}

// Layout desta tela é o mesmo de CDIImporter.jsx (Card > upload CSV + busca
// automática no BACEN por período > Card de consulta com tabela paginada) —
// só troca a fonte (Currency/PTAX no lugar de CDIRate) e mantém o parser de
// CSV mais flexível que o PTAX do Bacen já precisava (vários formatos de
// separador, incluindo o layout de largura fixa original do Bacen).
export default function PTAXImporter() {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [importingBacen, setImportingBacen] = useState(false);
  const queryClient = useQueryClient();

  const { data: currencies, isLoading: loadingCurrencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => base44.entities.Currency.list("", 10000),
    initialData: [],
  });

  const usdRates = (currencies || []).filter((c) => c.currency_code === "USD");

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] || null);
    setResult(null);
    setError(null);
  };

  const handleImport = useCallback(async () => {
    if (!file) {
      setError("Selecione um arquivo CSV primeiro.");
      return;
    }

    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());

      const parsed = [];
      const parseErrors = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) continue;

        // Tentar múltiplos separadores: TAB, ponto-e-vírgula, pipe, espaços múltiplos
        let parts = [];

        if (line.includes("\t")) {
          parts = line.split("\t").map((p) => p.trim()).filter((p) => p);
        } else if (line.includes(";")) {
          parts = line.split(";").map((p) => p.trim()).filter((p) => p);
        } else if (line.includes("|")) {
          parts = line.split("|").map((p) => p.trim()).filter((p) => p);
        } else if (line.match(/\s{2,}/)) {
          parts = line.split(/\s{2,}/).map((p) => p.trim()).filter((p) => p);
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
          parseErrors.push(`Linha ${i + 1}: formato inválido (${parts.length} campos encontrados).`);
          continue;
        }

        const [dateStr, , , currency, ...rates] = parts;
        const buyRate = rates[0] || "";
        const sellRate = rates[1] || buyRate;

        const normalizedCurrency = (currency || "").trim().toUpperCase();
        if (normalizedCurrency !== "USD") continue; // ignora outras moedas silenciosamente

        if (dateStr.length !== 8) {
          parseErrors.push(`Linha ${i + 1}: data inválida (esperado DDMMYYYY): ${dateStr}`);
          continue;
        }

        const day = dateStr.substring(0, 2);
        const month = dateStr.substring(2, 4);
        const year = dateStr.substring(4, 8);
        const isoDate = `${year}-${month}-${day}`;

        if (isNaN(new Date(isoDate).getTime())) {
          parseErrors.push(`Linha ${i + 1}: data inválida: ${isoDate}`);
          continue;
        }

        const rate = parseFloat(sellRate.replace(",", "."));
        if (isNaN(rate) || rate <= 0) {
          parseErrors.push(`Linha ${i + 1}: taxa inválida: ${sellRate}`);
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
        setError("Nenhuma taxa USD válida encontrada no arquivo.");
        setResult({ errors: parseErrors });
        setImporting(false);
        return;
      }

      // Remover duplicatas por data (manter a última linha do arquivo)
      const uniqueByDate = parsed.reduce((acc, curr) => {
        acc[curr.rate_date] = curr;
        return acc;
      }, {});
      const uniqueParsed = Object.values(uniqueByDate);

      let inserted = 0;
      const insertErrors = [];
      for (const entry of uniqueParsed) {
        try {
          const existing = usdRates.find((c) => c.rate_date === entry.rate_date);
          if (existing) {
            await base44.entities.Currency.update(existing.id, entry);
          } else {
            await base44.entities.Currency.create(entry);
          }
          inserted++;
        } catch (err) {
          insertErrors.push(`${entry.rate_date}: ${err.message}`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["currencies"] });
      setResult({
        message: `${inserted} taxas PTAX USD importadas/atualizadas com sucesso.`,
        parsed: uniqueParsed.length,
        errors: [...parseErrors, ...insertErrors],
      });
    } catch (err) {
      setError("Erro ao processar arquivo: " + err.message);
    }
    setImporting(false);
  }, [file, usdRates, queryClient]);

  // Busca a série de PTAX (venda) direto do BACEN (Olinda — fonte oficial e
  // gratuita, mesma origem usada no "Conciliar PTAX" de contratos). Sem data
  // pra escolher: cobre sozinho da última cotação já salva até hoje (ou um
  // histórico inicial, se o cadastro estiver vazio — ver
  // computeBacenStartDate). Importa só as datas que ainda não existem no
  // cadastro de Moedas — mesma lógica de deduplicação do import por CSV.
  const handleImportFromBACEN = useCallback(async () => {
    setImportingBacen(true);
    setError(null);
    try {
      const lastKnownDate = usdRates.reduce((max, r) => (r.rate_date > max ? r.rate_date : max), "");
      const startDate = computeBacenStartDate(lastKnownDate || null, { isMonthly: false });
      const { data } = await base44.functions.invoke("getPTAXRangeFromBACEN", {
        startDate,
        endDate: todayIso(),
      });
      const parsed = data?.rates || [];
      if (parsed.length === 0) {
        setError("O BACEN não retornou cotações PTAX para esse período.");
        setImportingBacen(false);
        return;
      }

      const existingDatesSet = new Set(usdRates.map((r) => r.rate_date));
      const newRates = parsed
        .filter((r) => !existingDatesSet.has(r.rate_date))
        .map((r) => ({
          currency_code: "USD",
          currency_name: "Dólar Americano",
          exchange_rate: r.ptax_rate,
          rate_date: r.rate_date,
          status: "ativa",
        }));

      if (newRates.length === 0) {
        setError(`Todas as ${parsed.length} cotações do período já existem no cadastro. Nenhuma taxa nova foi importada.`);
        setImportingBacen(false);
        return;
      }

      const batchSize = 100;
      for (let i = 0; i < newRates.length; i += batchSize) {
        await base44.entities.Currency.bulkCreate(newRates.slice(i, i + batchSize));
      }

      queryClient.invalidateQueries({ queryKey: ["currencies"] });
      setResult({ message: `${newRates.length} novas cotações PTAX importadas do BACEN! ${parsed.length - newRates.length} já existiam no cadastro.` });
    } catch (err) {
      setError("Erro ao importar do BACEN: " + (err.message || "tente novamente"));
    }
    setImportingBacen(false);
  }, [usdRates, queryClient]);

  // Uma query só no servidor — ver comentário em CDIImporter.jsx
  // (handleClearRates) sobre por que não apaga mais linha por linha.
  const handleClearRates = useCallback(async () => {
    if (!confirm(`⚠️ Tem certeza que deseja limpar TODAS as ${usdRates.length} taxas PTAX USD?\n\nEsta ação não pode ser desfeita.`)) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const { data } = await base44.functions.invoke("clearCurrencyRates", { currencyCode: "USD" });
      queryClient.invalidateQueries({ queryKey: ["currencies"] });
      setResult({ message: `${data.deleted} taxas PTAX USD foram removidas com sucesso.` });
    } catch (err) {
      setError("Erro ao limpar taxas: " + err.message);
    }
    setImporting(false);
  }, [usdRates, queryClient]);

  return (
    <div className="space-y-6">
      {/* Upload */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <FileUp className="w-4 h-4 text-blue-600" />
            Importação de PTAX — Dólar (USD)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Lado a lado: automático (BACEN) primeiro, CSV manual depois —
              mesma ordem de prioridade em PTAXImporter e CDIImporter. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 md:divide-x md:divide-slate-200">
            <div className="space-y-2 md:pr-6">
              <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-600" />
                Atualizar automaticamente do BACEN
              </Label>
              <Button type="button" onClick={handleImportFromBACEN} disabled={importingBacen} className="h-9 gap-1.5">
                <Database className="w-3.5 h-3.5" />
                {importingBacen ? "Atualizando..." : "Atualizar PTAX"}
              </Button>
              <p className="text-[11px] text-slate-500">
                Busca a série oficial do Banco Central (PTAX venda, olinda.bcb.gov.br) até hoje, direto de onde
                parou — sem precisar informar data. Também roda sozinho todo dia (ver Configurações → Agendamento).
              </p>
            </div>

            <div className="space-y-2 md:pl-6">
              <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                <FileUp className="w-3.5 h-3.5 text-blue-600" />
                Ou importe um arquivo CSV
              </Label>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileChange}
                  className="h-9 flex-1 min-w-[180px]"
                  disabled={importing}
                />
                <Button type="button" onClick={handleImport} disabled={!file || importing || loadingCurrencies} className="h-9">
                  {importing ? "Importando..." : "Importar"}
                </Button>
              </div>
              <p className="text-[11px] text-slate-500">
                Layout: DDMMYYYY 220 A USD taxa_compra taxa_venda 1 1 — aceita separador TAB, ; ou |.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {result && (
            <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-xs space-y-1">
              {result.message && <p className="font-semibold">{result.message}</p>}
              {result.errors && result.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-medium">{result.errors.length} erros/avisos</summary>
                  <ul className="mt-1 ml-4 list-disc space-y-0.5">
                    {result.errors.slice(0, 10).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {result.errors.length > 10 && <li className="text-slate-600">... e mais {result.errors.length - 10}</li>}
                  </ul>
                </details>
              )}
            </div>
          )}

          {loadingCurrencies && (
            <Badge variant="secondary" className="text-xs">
              Carregando dados...
            </Badge>
          )}
          {!loadingCurrencies && usdRates.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {usdRates.length.toLocaleString("pt-BR")} registros PTAX USD carregados
              </Badge>
              <Button variant="destructive" size="sm" onClick={handleClearRates} disabled={importing} className="h-7 text-xs gap-1.5">
                <Trash2 className="w-3 h-3" />
                Limpar Taxas PTAX
              </Button>
            </div>
          )}
          {!loadingCurrencies && usdRates.length === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Nenhuma taxa PTAX USD encontrada no cadastro. Faça upload de um arquivo CSV ou busque no BACEN.
            </div>
          )}
        </CardContent>
      </Card>

      <PTAXYearGrid rates={usdRates} />
    </div>
  );
}
