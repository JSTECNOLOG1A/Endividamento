import React, { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { buildDebtByMonth } from "./debtMapUtils";

export default function DebtMapByMonth() {
  // Carregar contratos
  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => {
      const all = await base44.entities.LoanContract.list("", 10000);
      return all.filter(c => c.status === "aprovado");
    },
    initialData: []
  });

  // Converter hierarquia para linhas de tabela
  const tableData = useMemo(() => {
    const hierarchy = buildDebtByMonth(contracts);
    const rows = [];

    Object.entries(hierarchy).forEach(([year, monthData]) => {
      Object.entries(monthData).forEach(([monthKey, banks]) => {
        Object.entries(banks).forEach(([bank, modalities]) => {
          Object.entries(modalities).forEach(([operationType, modeData]) => {
            const { totalBalance, totalRate } = modeData;
            rows.push({
              year,
              month: monthKey,
              bank: bank || "Sem Banco",
              modality: operationType || "Sem Tipo",
              balance: totalBalance,
              rate: totalRate > 0 ? totalRate / totalBalance : 0
            });
          });
        });
      });
    });

    // Ordenar por ano, depois mês
    return rows.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return a.month.localeCompare(b.month);
    });
  }, [contracts]);

  // Calcular totais
  const totals = useMemo(() => {
    const yearTotals = {};
    tableData.forEach(row => {
      if (!yearTotals[row.year]) yearTotals[row.year] = 0;
      yearTotals[row.year] += row.balance;
    });
    return yearTotals;
  }, [tableData]);

  // Exportar para Excel
  const handleExportExcel = () => {
    const csv = [
      ["Ano", "Mês", "Banco", "Modalidade", "Saldo (R$)", "Taxa (% a.a.)"].map(c => `"${c}"`).join(","),
      ...tableData.map(row =>
        [
          row.year,
          row.month,
          row.bank,
          row.modality,
          row.balance.toFixed(2),
          row.rate.toFixed(4)
        ].map(c => `"${c}"`).join(",")
      )
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `mapa_endividamento_mensal.csv`;
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
          <h1 className="text-3xl font-bold text-slate-900">Mapa Hierárquico por Período</h1>
          <p className="text-sm text-slate-500 mt-1">
            Visualize dívida organizada por Ano → Mês → Banco → Modalidade
          </p>
        </div>

        {/* Export Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleExportExcel}
            variant="outline"
            className="gap-2"
            disabled={tableData.length === 0}
          >
            <Download className="w-4 h-4" />
            Exportar Excel
          </Button>
        </div>

        {/* Totais por Ano */}
        {Object.keys(totals).length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Object.entries(totals).map(([year, balance]) => (
              <Card key={year} className="bg-blue-50 border-blue-200">
                <CardContent className="pt-6">
                  <p className="text-xs text-blue-600 uppercase font-medium">{year}</p>
                  <p className="text-xl font-bold text-blue-900 mt-2">
                    {formatCurrency(balance)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Tabela por Período */}
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Endividamento por Período</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Ano</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Mês</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Banco</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Modalidade</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Taxa (% a.a.)</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Saldo (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-slate-400">
                        Carregando contratos...
                      </td>
                    </tr>
                  ) : contracts.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-slate-400">
                        Nenhum contrato aprovado no sistema
                      </td>
                    </tr>
                  ) : tableData.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-slate-400">
                        Nenhum contrato com schedule para exibir
                      </td>
                    </tr>
                  ) : (
                    tableData.map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-200 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">{row.year}</td>
                        <td className="px-4 py-3 text-slate-700">{row.month}</td>
                        <td className="px-4 py-3 text-slate-700">{row.bank}</td>
                        <td className="px-4 py-3 text-slate-700">{row.modality}</td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {row.rate.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatCurrency(row.balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Info */}
        <div className="bg-blue-50 p-4 rounded border border-blue-200">
          <p className="text-sm text-blue-900">
            <strong>Dica:</strong> Estrutura temporal ideal para análise de sazonalidade e planejamento de fluxo de caixa.
          </p>
        </div>
      </div>
    </div>
  );
}