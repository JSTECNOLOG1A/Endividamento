import React, { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Database, FileUp, AlertCircle, Trash2, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { computeBacenStartDate, todayIso } from "@/lib/bacenAutoImport";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const HEAD_CLASS = "text-[11px] font-bold text-slate-700 uppercase tracking-wide whitespace-nowrap px-2 py-2 border-b-2 border-slate-200 text-center";
const YEAR_LABEL_CLASS = "text-[11px] font-semibold text-slate-500 whitespace-nowrap px-2 py-1.5 bg-slate-50 text-center sticky left-0";

// Agrupa a série (lista plana de {rate_date, annual_rate}) por ano → mês
// (1-12) — mesma ideia de indexByYear em CDIImporter.jsx, mas por MÊS em vez
// de dia (IPCA/INPC/IGP-M são publicados uma vez por mês, não diariamente).
function indexByYearMonth(rates) {
  const byYear = new Map();
  for (const r of rates) {
    const year = r.rate_date.slice(0, 4);
    const month = Number(r.rate_date.slice(5, 7));
    if (!byYear.has(year)) byYear.set(year, new Map());
    byYear.get(year).set(month, r);
  }
  return byYear;
}

// Grade ano × mês — equivalente mensal da grade dia × mês de CDI/SELIC/PTAX
// (ver RateYearGrid em CDIImporter.jsx e PTAXYearGrid em PTAXImporter.jsx).
// Como a série é mensal (só ~12 pontos por ano, não ~250), cabem TODOS os
// anos disponíveis numa tabela só, sem precisar de navegação por ano.
function MonthlyIndexGrid({ rates, label }) {
  const byYear = useMemo(() => indexByYearMonth(rates), [rates]);
  const years = useMemo(() => [...byYear.keys()].sort((a, b) => b.localeCompare(a)), [byYear]);

  if (!years.length) return null;

  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <Search className="w-4 h-4 text-blue-600" />
          Consulta de Taxas {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px] text-[11px]">
            <thead>
              <tr>
                <th className={`${HEAD_CLASS} bg-slate-50`}>Ano</th>
                {MONTH_LABELS.map((monthLabel, monthIdx) => (
                  <th key={monthLabel} className={`${HEAD_CLASS} ${monthIdx % 2 === 0 ? "bg-slate-50" : "bg-slate-100"}`}>{monthLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((year) => {
                const yearData = byYear.get(year);
                return (
                  <tr key={year} className="border-b border-slate-100">
                    <td className={YEAR_LABEL_CLASS}>{year}</td>
                    {MONTH_LABELS.map((_, monthIdx) => {
                      const stripe = monthIdx % 2 === 0 ? "bg-white" : "bg-slate-50";
                      const rate = yearData.get(monthIdx + 1);
                      return (
                        <td
                          key={monthIdx}
                          className={`text-[11px] text-center px-2 py-1.5 tabular-nums text-slate-700 ${stripe}`}
                          title={rate ? `${rate.annual_rate.toFixed(4)}% no mês` : undefined}
                        >
                          {rate ? rate.annual_rate.toFixed(2) : <span className="text-slate-300">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 px-3 py-2 border-t border-slate-100">
          Variação mensal (%), publicada uma vez por mês — passe o mouse sobre uma célula pra ver o valor completo.
          "·" = mês ainda sem divulgação.
        </p>
      </CardContent>
    </Card>
  );
}

// Importador genérico pra índices de preços MENSAIS (IPCA, INPC, IGP-M) —
// mesmo layout e mesma lógica de CDIImporter.jsx (Card de importação
// automática do BACEN + CSV manual + Card de consulta), só troca a fonte
// (rate_type) e a função do BACEN, e a tabela de consulta é por ano × mês
// em vez de dia × mês (esses índices são mensais, não diários).
export default function MonthlyIndexImporter({ rateType, label, bacenFunction }) {
  const [rates, setRates] = useState([]);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totalImported, setTotalImported] = useState(0);
  const [importingBacen, setImportingBacen] = useState(false);

  const reloadRates = useCallback(async () => {
    const data = await base44.entities.CDIRate.filter({ rate_type: rateType }, "rate_date", 10000);
    const mapped = data.map((d) => ({ rate_date: d.rate_date, annual_rate: d.annual_rate, rate_type: d.rate_type }));
    setRates(mapped);
    setTotalImported(mapped.length);
    return mapped;
  }, [rateType]);

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

    try {
      const text = await file.text();
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l);
      const parsed = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(/[;,]/);
        if (parts.length < 2) continue;

        let dateStr = parts[0].trim();
        const rateStr = parts[1].trim().replace(",", ".");

        // Normaliza DD/MM/AAAA ou MM/AAAA → 1º dia do mês (YYYY-MM-01) —
        // mesma convenção de rate_date usada pelo BACEN pra índices mensais.
        if (dateStr.includes("/")) {
          const segs = dateStr.split("/");
          if (segs.length === 3) {
            dateStr = `${segs[2]}-${segs[1].padStart(2, "0")}-01`;
          } else if (segs.length === 2) {
            dateStr = `${segs[1]}-${segs[0].padStart(2, "0")}-01`;
          }
        } else if (/^\d{4}-\d{2}$/.test(dateStr)) {
          dateStr = `${dateStr}-01`;
        }

        const rate = parseFloat(rateStr);
        if (!isNaN(rate) && /^\d{4}-\d{2}-01$/.test(dateStr)) {
          parsed.push({ rate_date: dateStr, annual_rate: Math.round(rate * 100) / 100, rate_type: rateType });
        }
      }

      if (parsed.length === 0) {
        setError("Nenhum dado válido encontrado no arquivo.");
        setImporting(false);
        return;
      }

      const existingRates = await base44.entities.CDIRate.filter({ rate_type: rateType }, "rate_date", 10000);
      const existingDatesSet = new Set(existingRates.map((r) => r.rate_date));
      const newRates = parsed.filter((r) => !existingDatesSet.has(r.rate_date));

      if (newRates.length === 0) {
        setError(`Todas as ${parsed.length} taxas já existem no banco. Nenhuma taxa nova foi importada.`);
        setImporting(false);
        return;
      }

      await base44.entities.CDIRate.bulkCreate(newRates);
      alert(`✅ ${newRates.length} novas taxas importadas com sucesso!\n${parsed.length - newRates.length} taxas já existiam no banco.`);
      await reloadRates();
    } catch (err) {
      setError("Erro ao processar arquivo: " + err.message);
    }
    setImporting(false);
  }, [rateType, reloadRates]);

  // Sem data pra escolher: cobre sozinho do último mês já salvo até hoje (ou
  // um histórico inicial, se a tabela estiver vazia — ver
  // computeBacenStartDate, janela mensal).
  const handleImportFromBACEN = useCallback(async () => {
    setImportingBacen(true);
    setError(null);
    try {
      const lastKnown = await base44.entities.CDIRate.filter({ rate_type: rateType }, "-rate_date", 1);
      const startDate = computeBacenStartDate(lastKnown[0]?.rate_date, { isMonthly: true });
      const { data } = await base44.functions.invoke(bacenFunction, { startDate, endDate: todayIso() });
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

      await base44.entities.CDIRate.bulkCreate(newRates);
      alert(`✅ ${newRates.length} novas taxas ${label} importadas do BACEN!\n${parsed.length - newRates.length} taxas já existiam no banco.`);
      await reloadRates();
    } catch (err) {
      setError("Erro ao importar do BACEN: " + (err.message || "tente novamente"));
    }
    setImportingBacen(false);
  }, [rateType, label, bacenFunction, reloadRates]);

  // Uma query só no servidor — ver comentário em CDIImporter.jsx
  // (handleClearRates) sobre por que não apaga mais linha por linha.
  const handleClearRates = useCallback(async () => {
    if (!confirm(`⚠️ Tem certeza que deseja limpar TODAS as taxas ${label}?\n\nEsta ação não pode ser desfeita.`)) return;
    setImporting(true);
    setError(null);
    try {
      const { data } = await base44.functions.invoke("clearCDIRatesByType", { rateType });
      setRates([]);
      setTotalImported(0);
      alert(`✅ ${data.deleted} taxas ${label} foram removidas com sucesso.`);
    } catch (err) {
      setError("Erro ao limpar taxas: " + err.message);
    }
    setImporting(false);
  }, [rateType, label]);

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <FileUp className="w-4 h-4 text-blue-600" />
            Importação de Série — {label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 md:divide-x md:divide-slate-200">
            <div className="space-y-2 md:pr-6">
              <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-600" />
                Atualizar automaticamente do BACEN
              </Label>
              <Button type="button" onClick={handleImportFromBACEN} disabled={importingBacen} className="h-9 gap-1.5">
                <Database className="w-3.5 h-3.5" />
                {importingBacen ? "Atualizando..." : `Atualizar ${label}`}
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
                Layout: Mês (MM/AAAA ou DD/MM/AAAA); Taxa (%) — separador vírgula ou ponto-e-vírgula.
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
            <Badge variant="secondary" className="text-xs">Carregando dados...</Badge>
          )}
          {!loading && totalImported > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {totalImported.toLocaleString("pt-BR")} registros {label} carregados
              </Badge>
              <Button variant="destructive" size="sm" onClick={handleClearRates} disabled={importing} className="h-7 text-xs gap-1.5">
                <Trash2 className="w-3 h-3" />
                Limpar Taxas {label}
              </Button>
            </div>
          )}
          {!loading && totalImported === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Nenhuma taxa {label} encontrada no banco. Busque no BACEN ou faça upload de um arquivo CSV.
            </div>
          )}
        </CardContent>
      </Card>

      <MonthlyIndexGrid rates={rates} label={label} />
    </div>
  );
}
