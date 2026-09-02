import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, Calendar, DollarSign, PieChart } from "lucide-react";

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

const MetricCard = ({ label, value, icon: Icon, color }) => (
  <Card className="border-slate-200 shadow-sm">
    <CardContent className="pt-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{formatCurrency(value)}</p>
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </CardContent>
  </Card>
);

export default function AccountingAnalysis({ data }) {
  const startDateObj = new Date(data.startDate + "T12:00:00");
  const endDateObj = new Date(data.endDate + "T12:00:00");
  const dateRange = `${startDateObj.toLocaleDateString("pt-BR")} a ${endDateObj.toLocaleDateString("pt-BR")}`;

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">
          Período: {dateRange}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard
            label="Saldo Total Devedor"
            value={data.metrics.totalDebt}
            icon={DollarSign}
            color="bg-red-100 text-red-600"
          />
          <MetricCard
            label="Principal ≤ 12 meses"
            value={data.metrics.principalDue12m}
            icon={TrendingUp}
            color="bg-orange-100 text-orange-600"
          />
          <MetricCard
            label="Principal > 12 meses"
            value={data.metrics.principalDueOver12m}
            icon={Calendar}
            color="bg-blue-100 text-blue-600"
          />
          <MetricCard
            label="Juros do Período"
            value={data.metrics.interestAccumulated}
            icon={PieChart}
            color="bg-green-100 text-green-600"
          />
        </div>
      </div>

      {/* Detailed View by Contract */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800">Detalhamento por Contrato</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Contrato</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Principal ≤ 12m</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Principal {">"} 12m</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Juros Período</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.contracts.map((contract) => (
                  <tr key={contract.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700">{contract.contract_number}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(contract.principalDue12m)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(contract.principalDueOver12m)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(contract.interestAccumulated)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                <tr className="font-semibold">
                  <td className="px-4 py-3 text-slate-900">TOTAL</td>
                  <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(data.metrics.principalDue12m)}</td>
                  <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(data.metrics.principalDueOver12m)}</td>
                  <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(data.metrics.interestAccumulated)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}