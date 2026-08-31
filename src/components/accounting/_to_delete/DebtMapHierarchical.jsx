import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import {
  buildDebtHierarchy,
  formatHierarchyForDisplay,
  generateExcelData
} from "./debtMapUtils";

export default function DebtMapHierarchical() {
  const today = new Date().toISOString().split("T")[0];
  const [baseDate, setBaseDate] = useState(today);
  const [expandedRows, setExpandedRows] = useState(new Set());

  // Carregar contratos
  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => {
      const all = await base44.entities.LoanContract.list("", 10000);
      return all.filter(c => c.status === "aprovado");
    },
    initialData: []
  });

  // Construir hierarquia
  const rows = useMemo(() => {
    console.log("Building hierarchy with", contracts.length, "contracts and baseDate:", baseDate);
    const hierarchy = buildDebtHierarchy(contracts, baseDate);
    console.log("Hierarchy result:", hierarchy);
    const formatted = formatHierarchyForDisplay(hierarchy);
    console.log("Formatted rows:", formatted);
    return formatted;
  }, [contracts, baseDate]);

  // Calcular totais
  const totals = useMemo(() => {
    const circulante = rows
      .filter(r => r.level === 0 && r.label === "Circulante")
      .reduce((sum, r) => sum + r.balance, 0);

    const naoCirculante = rows
      .filter(r => r.level === 0 && r.label === "Não Circulante")
      .reduce((sum, r) => sum + r.balance, 0);

    return {
      circulante,
      naoCirculante,
      total: circulante + naoCirculante
    };
  }, [rows]);

  // Toggle expansão
  const toggleExpanded = (rowId) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(rowId)) {
      newExpanded.delete(rowId);
    } else {
      newExpanded.add(rowId);
    }
    setExpandedRows(newExpanded);
  };

  // Renderizar linhas visíveis
  const visibleRows = useMemo(() => {
    const visible = [];
    const shouldShow = (rowIdx) => {
      if (rows[rowIdx].level === 0) return true;
      const parent = rows[rowIdx].parentIdx;
      if (parent === undefined) return true;
      return expandedRows.has(rows[parent].id) && shouldShow(parent);
    };

    rows.forEach((row, idx) => {
      if (shouldShow(idx)) visible.push({ ...row, rowIdx: idx });
    });
    return visible;
  }, [rows, expandedRows]);

  // Exportar para Excel
  const handleExportExcel = () => {
    const excelRows = generateExcelData(visibleRows);

    // Criar CSV
    const csv = excelRows
      .map(row => row.map(cell => `"${cell}"`).join(","))
      .join("\n");

    // Download
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `mapa_endividamento_${baseDate}.csv`;
    link.click();
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value);
  };

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mapa Hierárquico de Endividamento</h1>
          <p className="text-sm text-slate-500 mt-1">
            Estrutura circulante/não-circulante com drill-down por banco e modalidade
          </p>
        </div>

        {/* Data Selection */}
        <Card className="border-slate-200">
          <CardContent className="pt-6">
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <Label className="text-xs font-medium text-slate-500 uppercase">
                  Data-Base
                </Label>
                <Input
                  type="date"
                  value={baseDate}
                  onChange={(e) => {
                    setBaseDate(e.target.value);
                    setExpandedRows(new Set()); // Reset expansão
                  }}
                  className="h-9 mt-2"
                />
              </div>
              <Button
                onClick={handleExportExcel}
                variant="outline"
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Exportar Excel
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Totais */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-green-50 border-green-200">
            <CardContent className="pt-6">
              <p className="text-xs text-green-600 uppercase font-medium">Circulante</p>
              <p className="text-2xl font-bold text-green-900 mt-2">
                {formatCurrency(totals.circulante)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="pt-6">
              <p className="text-xs text-orange-600 uppercase font-medium">Não Circulante</p>
              <p className="text-2xl font-bold text-orange-900 mt-2">
                {formatCurrency(totals.naoCirculante)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-6">
              <p className="text-xs text-blue-600 uppercase font-medium">Total</p>
              <p className="text-2xl font-bold text-blue-900 mt-2">
                {formatCurrency(totals.total)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Árvore Hierárquica */}
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Estrutura Detalhada</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0 font-mono text-sm">
              {isLoading ? (
                <p className="text-slate-400">Carregando contratos...</p>
              ) : contracts.length === 0 ? (
                <p className="text-slate-400">Nenhum contrato ativo no sistema</p>
              ) : visibleRows.length === 0 ? (
                <p className="text-slate-400">Nenhum contrato ativo para esta data</p>
              ) : (
                visibleRows.map((row) => (
                  <div
                    key={row.id}
                    className={`
                      flex items-center gap-2 px-3 py-2 border-b border-slate-200 hover:bg-slate-50 transition-colors
                      ${row.level === 0 ? "bg-slate-100 font-bold" : ""}
                      ${row.level === 1 ? "bg-slate-50" : ""}
                    `}
                    style={{ paddingLeft: `${row.level * 24 + 12}px` }}
                  >
                    {/* Expandir/Colapsar */}
                    {row.expandable ? (
                      <button
                        onClick={() => toggleExpanded(row.id)}
                        className="flex-shrink-0 w-5 h-5 flex items-center justify-center hover:bg-slate-200 rounded"
                      >
                        {expandedRows.has(row.id) ? (
                          <ChevronDown className="w-4 h-4 text-slate-600" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-600" />
                        )}
                      </button>
                    ) : (
                      <div className="w-5 h-5" />
                    )}

                    {/* Label */}
                    <span className="flex-1 text-slate-700">{row.label}</span>

                    {/* Taxa (apenas modalidades) */}
                    {row.rate && (
                      <span className="text-slate-500 text-xs w-20 text-right">
                        {row.rate.toFixed(2)}% a.a.
                      </span>
                    )}

                    {/* Saldo */}
                    <span className="font-bold text-slate-900 text-right w-32">
                      {formatCurrency(row.balance)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Nota para DFs */}
        <div className="bg-blue-50 p-4 rounded border border-blue-200">
          <p className="text-sm text-blue-900">
            <strong>Dica:</strong> Esta árvore está pronta para copiar como nota explicativa nas Demonstrações Financeiras.
            Exporte para Excel e formate conforme o padrão da sua DFs.
          </p>
        </div>
      </div>
    </div>
  );
}