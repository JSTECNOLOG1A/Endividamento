import React, { useState, useCallback, useMemo } from "react";
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
import { Database, ChevronLeft, ChevronRight, Search, FileUp, AlertCircle, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { computeBacenStartDate, todayIso } from "@/lib/bacenAutoImport";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const HEAD_CLASS = "text-[11px] font-bold text-slate-700 uppercase tracking-wide whitespace-nowrap px-2 py-2 border-b-2 border-slate-200 text-center";
const DAY_LABEL_CLASS = "text-[11px] font-semibold text-slate-500 whitespace-nowrap px-2 py-1.5 bg-slate-50 text-center sticky left-0";

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// Agrupa a série (lista plana de {rate_date, annual_rate, daily_factor}) por
// ano → "MM-DD", pra montar a grade calendário abaixo sem varrer o array
// inteiro a cada célula.
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

// Grade calendário (dia × mês) pra um ano só — substitui a lista longa
// paginada: CDI/SELIC são taxas DIÁRIAS, então um ano inteiro vira ~250
// linhas numa lista simples; em grade cabe tudo numa tela só, sem paginação,
// e fica muito mais fácil comparar meses lado a lado.
function RateYearGrid({ rates, rateType }) {
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
            Consulta de Taxas {rateType}
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
                        title={rate ? `${rate.annual_rate.toFixed(4)}% a.a. — fator diário ${(rate.daily_factor || 0).toFixed(8)}` : undefined}
                      >
                        {rate ? rate.annual_rate.toFixed(2) : <span className="text-slate-300">·</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 px-3 py-2 border-t border-slate-100">
          Valores em % a.a. — passe o mouse sobre uma célula pra ver a taxa completa e o fator diário.
          "·" = sem cotação nesse dia (fim de semana ou feriado).
        </p>
      </CardContent>
    </Card>
  );
}

export default function CDIImporter({ rateType }) {
  const [rates, setRates] = useState([]);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totalImported, setTotalImported] = useState(0);
  const [importingBacen, setImportingBacen] = useState(false);

  const reloadRates = useCallback(async () => {
    const data = await base44.entities.CDIRate.filter({ rate_type: rateType }, "rate_date", 10000);
    const mapped = data.map((d) => ({
      rate_date: d.rate_date,
      annual_rate: d.annual_rate,
      daily_factor: d.daily_factor,
      rate_type: d.rate_type,
    }));
    setRates(mapped);
    setTotalImported(mapped.length);
    return mapped;
  }, [rateType]);

  // Auto-load from database on mount and when rateType changes
  React.useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        await reloadRates();
      } catch (err) {
        console.error("Erro ao carregar dados:", err);
      }
      setLoading(false);
    };
    loadInitialData();
  }, [reloadRates]);

  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const lines = text.split("\n").filter((l) => l.trim());

        // Parse CSV — suporta ; e ,
        const parsed = [];
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(/[;,]/);
          if (parts.length < 2) continue;

          let dateStr = parts[0].trim();
          let rateStr = parts[1].trim().replace(",", ".");

          // Normaliza data DD/MM/AAAA → YYYY-MM-DD
          if (dateStr.includes("/")) {
            const [d, m, y] = dateStr.split("/");
            dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          }

          const rate = parseFloat(rateStr);
          if (!isNaN(rate) && dateStr) {
            // Future Date Guard: impedir importação de taxas com data futura
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const rateDate = new Date(dateStr);

            if (rateDate > today) {
              console.warn(`⚠️ Taxa de ${dateStr} é futura (ignorada para integridade histórica)`);
              return; // Pular esta taxa
            }

            // Arredondar para 2 casas decimais
            const roundedRate = Math.round(rate * 100) / 100;
            parsed.push({
              rate_date: dateStr,
              annual_rate: roundedRate,
              daily_factor: parseFloat(Math.pow(1 + roundedRate / 100, 1 / 252).toFixed(9)),
              rate_type: rateType,
            });
          }
        }

        if (parsed.length === 0) {
          setError("Nenhum dado válido encontrado no arquivo.");
          setImporting(false);
          return;
        }

        // Verificar taxas existentes para evitar duplicatas
        const existingRates = await base44.entities.CDIRate.filter(
          { rate_type: rateType },
          "rate_date",
          10000
        );

        const existingDatesSet = new Set(existingRates.map(r => r.rate_date));

        // Filtrar apenas novas taxas (que não existem no banco)
        const newRates = parsed.filter(r => !existingDatesSet.has(r.rate_date));

        if (newRates.length === 0) {
          setError(`Todas as ${parsed.length} taxas já existem no banco. Nenhuma taxa nova foi importada.`);
          setImporting(false);
          return;
        }

        // Bulk insert apenas das novas taxas em lotes de 100
        const batchSize = 100;
        for (let i = 0; i < newRates.length; i += batchSize) {
          const batch = newRates.slice(i, i + batchSize);
          await base44.entities.CDIRate.bulkCreate(batch);
        }

        setError(null);
        alert(`✅ ${newRates.length} novas taxas importadas com sucesso!\n${parsed.length - newRates.length} taxas já existiam no banco.`);

        await reloadRates();
      } catch (err) {
        setError("Erro ao processar arquivo: " + err.message);
      }
      setImporting(false);
    };
    reader.readAsText(file);
  }, [rateType, reloadRates]);

  // Busca CDI/SELIC direto do BACEN (SGS — api.bcb.gov.br, fonte oficial e
  // gratuita, mesma usada pra PTAX). Sem data pra escolher: cobre sozinho da
  // última cotação já salva até hoje (ou um histórico inicial, se a tabela
  // estiver vazia — ver computeBacenStartDate). Importa só as datas que
  // ainda não existem no banco — mesma lógica de deduplicação do CSV acima.
  const handleImportFromBACEN = useCallback(async () => {
    setImportingBacen(true);
    setError(null);
    try {
      const lastKnown = await base44.entities.CDIRate.filter({ rate_type: rateType }, "-rate_date", 1);
      const startDate = computeBacenStartDate(lastKnown[0]?.rate_date, { isMonthly: false });
      const { data } = await base44.functions.invoke("getRatesFromBACEN", {
        rateType,
        startDate,
        endDate: todayIso(),
      });
      const parsed = data?.rates || [];
      if (parsed.length === 0) {
        setError("O BACEN não retornou taxas para esse período.");
        setImportingBacen(false);
        return;
      }

      const existingRates = await base44.entities.CDIRate.filter({ rate_type: rateType }, "rate_date", 10000);
      const existingDatesSet = new Set(existingRates.map((r) => r.rate_date));
      const newRates = parsed.filter((r) => !existingDatesSet.has(r.rate_date));

      if (newRates.length === 0) {
        setError(`Todas as ${parsed.length} taxas do período já existem no banco. Nenhuma taxa nova foi importada.`);
        setImportingBacen(false);
        return;
      }

      const batchSize = 100;
      for (let i = 0; i < newRates.length; i += batchSize) {
        await base44.entities.CDIRate.bulkCreate(newRates.slice(i, i + batchSize));
      }

      alert(`✅ ${newRates.length} novas taxas ${rateType} importadas do BACEN!\n${parsed.length - newRates.length} taxas já existiam no banco.`);

      await reloadRates();
    } catch (err) {
      setError("Erro ao importar do BACEN: " + (err.message || "tente novamente"));
    }
    setImportingBacen(false);
  }, [rateType, reloadRates]);

  // Uma query só no servidor (DELETE ... WHERE rate_type) — apagar linha por
  // linha via API genérica (o que essa tela fazia antes) dispara uma
  // requisição por registro e estoura o rate limit da API em séries grandes
  // (CDI/SELIC passam de 1000 registros).
  const handleClearRates = useCallback(async () => {
    if (!confirm(`⚠️ Tem certeza que deseja limpar TODAS as taxas ${rateType}?\n\nEsta ação não pode ser desfeita.`)) {
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const { data } = await base44.functions.invoke("clearCDIRatesByType", { rateType });
      setRates([]);
      setTotalImported(0);
      alert(`✅ ${data.deleted} taxas ${rateType} foram removidas com sucesso.`);
    } catch (err) {
      setError("Erro ao limpar taxas: " + err.message);
    }
    setImporting(false);
  }, [rateType]);

  return (
    <div className="space-y-6">
      {/* Upload */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <FileUp className="w-4 h-4 text-blue-600" />
            Importação de Série — {rateType}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Lado a lado: automático (BACEN) primeiro, CSV manual depois —
              mesma ordem de prioridade em CDIImporter e PTAXImporter. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 md:divide-x md:divide-slate-200">
            <div className="space-y-2 md:pr-6">
              <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-600" />
                Atualizar automaticamente do BACEN
              </Label>
              <Button type="button" onClick={handleImportFromBACEN} disabled={importingBacen} className="h-9 gap-1.5">
                <Database className="w-3.5 h-3.5" />
                {importingBacen ? "Atualizando..." : `Atualizar ${rateType}`}
              </Button>
              <p className="text-[11px] text-slate-500">
                Busca a série oficial do Banco Central (api.bcb.gov.br) até hoje, direto de onde parou — sem
                precisar informar data. Também roda sozinho todo dia (ver Configurações → Agendamento).
              </p>
            </div>

            <div className="space-y-2 md:pl-6">
              <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                <FileUp className="w-3.5 h-3.5 text-blue-600" />
                Ou envie um arquivo CSV
              </Label>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="h-9 flex-1 min-w-[180px]"
                  disabled={importing}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Layout: Data (DD/MM/AAAA); Taxa (% a.a.) — separador vírgula ou ponto-e-vírgula. Suporta séries com
                mais de 10.000 registros.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {loading && (
            <Badge variant="secondary" className="text-xs">
              Carregando dados...
            </Badge>
          )}
          {!loading && totalImported > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {totalImported.toLocaleString("pt-BR")} registros {rateType} carregados
              </Badge>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearRates}
                disabled={importing}
                className="h-7 text-xs gap-1.5"
              >
                <Trash2 className="w-3 h-3" />
                Limpar Taxas {rateType}
              </Button>
            </div>
          )}
          {!loading && totalImported === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Nenhuma taxa {rateType} encontrada no banco. Faça upload de um arquivo CSV.
            </div>
          )}
        </CardContent>
      </Card>

      <RateYearGrid rates={rates} rateType={rateType} />
    </div>
  );
}
