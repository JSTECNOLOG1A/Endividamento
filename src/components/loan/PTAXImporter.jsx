import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSortableRows, SortableHead } from "@/components/ui/sortable-table";
import { Badge } from "@/components/ui/badge";
import { FileUp, Database, ChevronLeft, ChevronRight, AlertCircle, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE = 50;

// Colunas ordenáveis por clique no título (mesma configuração da tabela de
// Contratos) — exchange_rate ordena como número, o resto como texto.
const PTAX_SORT_COLUMNS = {
  exchange_rate: { numeric: true },
};

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
  const [page, setPage] = useState(0);
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [bacenStart, setBacenStart] = useState("");
  const [bacenEnd, setBacenEnd] = useState("");
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
      setPage(0);
    } catch (err) {
      setError("Erro ao processar arquivo: " + err.message);
    }
    setImporting(false);
  }, [file, usdRates, queryClient]);

  // Busca a série de PTAX (venda) direto do BACEN (Olinda — fonte oficial e
  // gratuita, mesma origem usada no "Conciliar PTAX" de contratos) pro
  // período informado, e importa só as datas que ainda não existem no
  // cadastro de Moedas — mesma lógica de deduplicação do import por CSV.
  const handleImportFromBACEN = useCallback(async () => {
    if (!bacenStart || !bacenEnd) {
      setError("Informe o período (data inicial e final) para buscar no BACEN.");
      return;
    }
    setImportingBacen(true);
    setError(null);
    try {
      const { data } = await base44.functions.invoke("getPTAXRangeFromBACEN", {
        startDate: bacenStart,
        endDate: bacenEnd,
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
      setPage(0);
    } catch (err) {
      setError("Erro ao importar do BACEN: " + (err.message || "tente novamente"));
    }
    setImportingBacen(false);
  }, [bacenStart, bacenEnd, usdRates, queryClient]);

  const handleClearRates = useCallback(async () => {
    if (!confirm(`⚠️ Tem certeza que deseja limpar TODAS as ${usdRates.length} taxas PTAX USD?\n\nEsta ação não pode ser desfeita.`)) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      for (const rate of usdRates) {
        await base44.entities.Currency.delete(rate.id);
      }
      queryClient.invalidateQueries({ queryKey: ["currencies"] });
      setResult({ message: `${usdRates.length} taxas PTAX USD foram removidas com sucesso.` });
      setPage(0);
    } catch (err) {
      setError("Erro ao limpar taxas: " + err.message);
    }
    setImporting(false);
  }, [usdRates, queryClient]);

  // Filter (ordenação por coluna vem do useSortableRows abaixo — mesma
  // configuração da tabela de Contratos). Ordem padrão sem coluna
  // selecionada: data mais recente primeiro.
  let filteredData = [...usdRates];
  if (filterStart) filteredData = filteredData.filter((r) => r.rate_date >= filterStart);
  if (filterEnd) filteredData = filteredData.filter((r) => r.rate_date <= filterEnd);
  filteredData.sort((a, b) => b.rate_date.localeCompare(a.rate_date));

  const { sortKey, sortDir, toggleSort, sortedRows: displayData } = useSortableRows(filteredData, PTAX_SORT_COLUMNS);

  const totalPages = Math.ceil(displayData.length / PAGE_SIZE);
  const pageData = displayData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Arquivo CSV do Bacen (PTAX USD)</Label>
            <Input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileChange}
              className="h-9"
              disabled={importing}
            />
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-xs text-slate-500">
              <strong>Layout:</strong> DDMMYYYY TAB 220 TAB A TAB USD TAB taxa_compra TAB taxa_venda TAB 1 TAB 1 —
              também aceita separador por ; ou | . Exemplo: <code className="bg-slate-100 px-1 rounded">02012026	220	A	USD	5,4366	5,4372	1	1</code>
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={handleImport} disabled={!file || importing || loadingCurrencies} className="h-9">
              <FileUp className="w-4 h-4 mr-2" />
              {importing ? "Importando..." : "Importar PTAX USD"}
            </Button>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
              Ou importar automaticamente do BACEN
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Data Inicial</Label>
                <Input type="date" value={bacenStart} onChange={(e) => setBacenStart(e.target.value)} className="h-9" disabled={importingBacen} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Data Final</Label>
                <Input type="date" value={bacenEnd} onChange={(e) => setBacenEnd(e.target.value)} className="h-9" disabled={importingBacen} />
              </div>
              <Button type="button" onClick={handleImportFromBACEN} disabled={importingBacen} className="h-9 gap-1.5">
                <Database className="w-3.5 h-3.5" />
                {importingBacen ? "Buscando..." : "Buscar PTAX no BACEN"}
              </Button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Busca a série oficial do Banco Central (PTAX venda, olinda.bcb.gov.br) pro período informado e importa
              só as datas que ainda não estão no cadastro.
            </p>
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
                    {result.errors.length > 10 && <li className="text-slate-500">... e mais {result.errors.length - 10}</li>}
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

      {/* Consulta Paginada */}
      {usdRates.length > 0 && (
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
                <Database className="w-4 h-4 text-blue-600" />
                Consulta de Taxas PTAX
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <SortableHead sortField="rate_date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Data</SortableHead>
                    <SortableHead sortField="exchange_rate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right>Cotação PTAX (R$)</SortableHead>
                    <SortableHead sortField="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Status</SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.map((r) => (
                    <TableRow key={r.id} className="hover:bg-slate-50">
                      <TableCell className="text-xs">
                        {new Date(`${r.rate_date}T12:00:00`).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-xs text-right font-medium">
                        {r.exchange_rate ? r.exchange_rate.toFixed(4) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.status}</Badge>
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
