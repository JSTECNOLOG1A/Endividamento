import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, Database, ChevronLeft, ChevronRight, ArrowUpDown, Search, FileUp, AlertCircle, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const PAGE_SIZE = 50;

export default function CDIImporter() {
  const [rates, setRates] = useState([]);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [sortAsc, setSortAsc] = useState(false);
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [rateType, setRateType] = useState("CDI");
  const [totalImported, setTotalImported] = useState(0);

  // Auto-load from database on mount and when rateType changes
  React.useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        const data = await base44.entities.CDIRate.filter(
          { rate_type: rateType },
          "rate_date",
          10000
        );
        setRates(
          data.map((d) => ({
            rate_date: d.rate_date,
            annual_rate: d.annual_rate,
            daily_factor: d.daily_factor,
            rate_type: d.rate_type,
          }))
        );
        setTotalImported(data.length);
      } catch (err) {
        console.error("Erro ao carregar dados:", err);
      }
      setLoading(false);
    };
    loadInitialData();
  }, [rateType]);

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

        // Reload from database to get fresh data
        const data = await base44.entities.CDIRate.filter(
          { rate_type: rateType },
          "rate_date",
          10000
        );
        setRates(
          data.map((d) => ({
            rate_date: d.rate_date,
            annual_rate: d.annual_rate,
            daily_factor: d.daily_factor,
            rate_type: d.rate_type,
          }))
        );
        setTotalImported(data.length);
        setPage(0);
      } catch (err) {
        setError("Erro ao processar arquivo: " + err.message);
      }
      setImporting(false);
    };
    reader.readAsText(file);
  }, [rateType]);

  const loadFromDatabase = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      const data = await base44.entities.CDIRate.filter(
        { rate_type: rateType },
        "rate_date",
        10000
      );
      setRates(
        data.map((d) => ({
          rate_date: d.rate_date,
          annual_rate: d.annual_rate,
          daily_factor: d.daily_factor,
          rate_type: d.rate_type,
        }))
      );
      setTotalImported(data.length);
      setPage(0);
    } catch (err) {
      setError("Erro ao carregar dados: " + err.message);
    }
    setImporting(false);
  }, [rateType]);

  const handleClearRates = useCallback(async () => {
    if (!confirm(`⚠️ Tem certeza que deseja limpar TODAS as taxas ${rateType}?\n\nEsta ação não pode ser desfeita.`)) {
      return;
    }
    
    setImporting(true);
    setError(null);
    try {
      // Buscar todas as taxas do tipo selecionado
      const allRates = await base44.entities.CDIRate.filter(
        { rate_type: rateType },
        "rate_date",
        10000
      );
      
      // Deletar em lotes
      for (const rate of allRates) {
        await base44.entities.CDIRate.delete(rate.id);
      }
      
      setRates([]);
      setTotalImported(0);
      setPage(0);
      alert(`✅ ${allRates.length} taxas ${rateType} foram removidas com sucesso.`);
    } catch (err) {
      setError("Erro ao limpar taxas: " + err.message);
    }
    setImporting(false);
  }, [rateType]);

  // Filter and sort
  let displayData = [...rates];
  if (filterStart) displayData = displayData.filter((r) => r.rate_date >= filterStart);
  if (filterEnd) displayData = displayData.filter((r) => r.rate_date <= filterEnd);
  if (sortAsc) {
    displayData.sort((a, b) => a.rate_date.localeCompare(b.rate_date));
  } else {
    displayData.sort((a, b) => b.rate_date.localeCompare(a.rate_date));
  }

  const totalPages = Math.ceil(displayData.length / PAGE_SIZE);
  const pageData = displayData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Upload */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <FileUp className="w-4 h-4 text-blue-600" />
            Importação de Séries — CDI / SELIC
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo de Taxa</Label>
              <Select value={rateType} onValueChange={setRateType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CDI">CDI</SelectItem>
                  <SelectItem value="SELIC">SELIC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Arquivo CSV</Label>
              <div className="relative">
                <Input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="h-9"
                  disabled={importing}
                />
              </div>
            </div>

          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-xs text-slate-500">
              <strong>Layout:</strong> Data (DD/MM/AAAA); Taxa (% a.a.) — Separador: vírgula ou ponto-e-vírgula.
              Suporta séries com mais de 10.000 registros.
            </p>
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

      {/* Consulta Paginada */}
      {rates.length > 0 && (
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
                <Search className="w-4 h-4 text-blue-600" />
                Consulta de Taxas
              </CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={filterStart}
                  onChange={(e) => { setFilterStart(e.target.value); setPage(0); }}
                  className="h-8 text-xs w-36"
                  placeholder="De"
                />
                <span className="text-xs text-slate-400">até</span>
                <Input
                  type="date"
                  value={filterEnd}
                  onChange={(e) => { setFilterEnd(e.target.value); setPage(0); }}
                  className="h-8 text-xs w-36"
                  placeholder="Até"
                />
                <Button variant="ghost" size="sm" onClick={() => setSortAsc(!sortAsc)} className="h-8 gap-1 text-xs">
                  <ArrowUpDown className="w-3 h-3" />
                  {sortAsc ? "Cresc." : "Decresc."}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-bold text-slate-700">Data</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Taxa (% a.a.)</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700 text-right">Fator Diário</TableHead>
                    <TableHead className="text-xs font-bold text-slate-700">Tipo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.map((r, idx) => (
                    <TableRow key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <TableCell className="text-xs">
                        {r.rate_date.includes("-")
                          ? format(new Date(r.rate_date + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })
                          : r.rate_date}
                      </TableCell>
                      <TableCell className="text-xs text-right font-medium">
                        {r.annual_rate.toFixed(4)}%
                      </TableCell>
                      <TableCell className="text-xs text-right text-slate-500">
                        {(r.daily_factor || Math.pow(1 + r.annual_rate / 100, 1 / 252)).toFixed(8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.rate_type}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
                <span className="text-xs text-slate-500">
                  {displayData.length.toLocaleString("pt-BR")} registros filtrados — Página {page + 1} de {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setPage(0)} disabled={page === 0} className="text-xs h-7 px-2">Primeira</Button>
                  <Button variant="ghost" size="icon" onClick={() => setPage(page - 1)} disabled={page === 0} className="h-7 w-7">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="text-xs text-slate-600 px-2 font-medium">{page + 1}</span>
                  <Button variant="ghost" size="icon" onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1} className="h-7 w-7">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="text-xs h-7 px-2">Última</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}