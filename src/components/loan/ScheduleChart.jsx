import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ComposedChart,
  Line,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatCurrency(value) {
  if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}k`;
  return `R$ ${value.toFixed(0)}`;
}

export default function ScheduleChart({ schedule }) {
  if (!schedule || schedule.length === 0) return null;

  const chartData = schedule.map((row) => ({
    name: row.parcela.toString(),
    date: format(new Date(row.dataVencimento + "T12:00:00"), "MM/yy"),
    saldo: row.sdFinal,
    amortizacao: row.amortizacao,
    juros: row.jurosFixosMes + row.jurosVariaveisMes,
    prestacao: row.prestacao,
  }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload) return null;
    return (
      <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs">
        <p className="font-semibold text-slate-700 mb-1.5">Parcela {label}</p>
        {payload.map((entry, i) => (
          <p key={i} className="flex justify-between gap-4" style={{ color: entry.color }}>
            <span>{entry.name}:</span>
            <span className="font-medium">
              R$ {entry.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Saldo Devedor */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            Evolução do Saldo Devedor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorSaldo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} interval="preserveStartEnd" />
                <YAxis tickFormatter={formatCurrency} tick={{ fontSize: 10, fill: "#94a3b8" }} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="saldo" name="Saldo" stroke="#2563eb" strokeWidth={2} fill="url(#colorSaldo)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Composição da Prestação */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            Composição da Prestação
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} interval="preserveStartEnd" />
                <YAxis tickFormatter={formatCurrency} tick={{ fontSize: 10, fill: "#94a3b8" }} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "11px" }}
                  iconSize={10}
                />
                <Bar dataKey="amortizacao" name="Amortização" stackId="a" fill="#2563eb" radius={[0, 0, 0, 0]} />
                <Bar dataKey="juros" name="Juros" stackId="a" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Line type="monotone" dataKey="prestacao" name="Prestação" stroke="#10b981" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}