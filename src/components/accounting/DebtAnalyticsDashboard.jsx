import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingDown,
  TrendingUp,
  Calendar,
  Percent,
  DollarSign,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  getDebtPositionByDate,
  getDebtMaturityBreakdown,
  getInterestByMonth,
  getInterestByPeriod,
  getFXVariationByPeriod,
  getDebtAnnualMap,
  getDebtByStructure,
  getDebtMaturityCurve,
  getDebtKPIs
} from "./debtAnalytics";

export default function DebtAnalyticsDashboard() {
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedPeriodFrom, setSelectedPeriodFrom] = useState(
    new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [selectedPeriodTo, setSelectedPeriodTo] = useState(today);

  // Carregar contratos
  const { data: contracts = [] } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => {
      const all = await base44.entities.LoanContract.list("", 10000);
      return all.filter(c => c.status === "aprovado");
    },
    initialData: []
  });

  // Calcular analíticas
  const analytics = useMemo(() => {
    if (contracts.length === 0) return null;

    return {
      position: getDebtPositionByDate(contracts, selectedDate),
      maturity: getDebtMaturityBreakdown(contracts, selectedDate),
      structure: getDebtByStructure(contracts, selectedDate),
      curve: getDebtMaturityCurve(contracts),
      kpis: getDebtKPIs(contracts, selectedDate),
      interestPeriod: getInterestByPeriod(contracts, selectedPeriodFrom, selectedPeriodTo),
      fxPeriod: getFXVariationByPeriod(contracts, selectedPeriodFrom, selectedPeriodTo),
      annualMap: getDebtAnnualMap(contracts)
    };
  }, [contracts, selectedDate, selectedPeriodFrom, selectedPeriodTo]);

  if (!analytics) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <p className="text-slate-500">Carregando contratos...</p>
      </div>
    );
  }

  const KPICard = ({ icon: Icon, title, value, subtitle, color = "blue" }) => {
    const colorClasses = {
      blue: "bg-blue-50 border-blue-200 text-blue-600",
      green: "bg-green-50 border-green-200 text-green-600",
      red: "bg-red-50 border-red-200 text-red-600",
      orange: "bg-orange-50 border-orange-200 text-orange-600"
    };

    return (
      <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase opacity-75">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs mt-2 opacity-75">{subtitle}</p>}
          </div>
          <Icon className="w-5 h-5 opacity-50" />
        </div>
      </div>
    );
  };

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Analítica de Endividamento</h1>
          <p className="text-sm text-slate-500 mt-1">Consolidação de dívida para Controller/Tesouraria</p>
        </div>

        {/* Data Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <Label className="text-xs font-medium text-slate-500 uppercase">
                Data-Base (Posição)
              </Label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-9 mt-2"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <Label className="text-xs font-medium text-slate-500 uppercase">
                Período: De
              </Label>
              <Input
                type="date"
                value={selectedPeriodFrom}
                onChange={(e) => setSelectedPeriodFrom(e.target.value)}
                className="h-9 mt-2"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <Label className="text-xs font-medium text-slate-500 uppercase">
                Período: Até
              </Label>
              <Input
                type="date"
                value={selectedPeriodTo}
                onChange={(e) => setSelectedPeriodTo(e.target.value)}
                className="h-9 mt-2"
              />
            </CardContent>
          </Card>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            icon={DollarSign}
            title="Dívida Total"
            value={`R$ ${analytics.kpis.totalDebt.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
            color="blue"
          />
          <KPICard
            icon={Clock}
            title="Prazo Médio"
            value={`${analytics.kpis.averageMaturityMonths} meses`}
            color="green"
          />
          <KPICard
            icon={Percent}
            title="Custo Médio Anual"
            value={`${analytics.kpis.averageCostAnnual.toFixed(2)}% a.a.`}
            color="orange"
          />
          <KPICard
            icon={TrendingUp}
            title="Moeda Estrangeira"
            value={`${analytics.kpis.foreignCurrencyPercentage.toFixed(2)}%`}
            color={analytics.kpis.foreignCurrencyPercentage > 20 ? "red" : "blue"}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="position" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="position">Posição</TabsTrigger>
            <TabsTrigger value="maturity">Vencimentos</TabsTrigger>
            <TabsTrigger value="structure">Estrutura</TabsTrigger>
            <TabsTrigger value="curve">Curva</TabsTrigger>
          </TabsList>

          {/* 1️⃣ POSITION */}
          <TabsContent value="position">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Posição da Dívida
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded border border-slate-200">
                    <p className="text-xs text-slate-500 uppercase font-medium">Saldo Total</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">
                      R$ {analytics.position.totalBalance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded border border-blue-200">
                    <p className="text-xs text-blue-600 uppercase font-medium">Juros Apropriados</p>
                    <p className="text-2xl font-bold text-blue-900 mt-1">
                      R$ {analytics.position.totalInterestAccrued.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {/* Por Moeda */}
                <div>
                  <h3 className="font-semibold text-slate-700 mb-3">Composição por Moeda</h3>
                  <div className="space-y-2">
                    {Object.entries(analytics.position.byCurrency).map(([currency, data]) => (
                      <div key={currency} className="flex justify-between items-center p-3 bg-slate-50 rounded border border-slate-200">
                        <div>
                          <p className="font-medium text-slate-900">{currency}</p>
                          <p className="text-xs text-slate-500">{data.count} contrato(s)</p>
                        </div>
                        <p className="font-bold text-slate-900">
                          R$ {data.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 2️⃣ MATURITY */}
          <TabsContent value="maturity">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Classificação Circulante/Não Circulante
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-green-50 p-4 rounded border border-green-200">
                    <p className="text-xs text-green-600 uppercase font-medium">Circulante (0-12m)</p>
                    <p className="text-2xl font-bold text-green-900 mt-1">
                      R$ {analytics.maturity.shortTerm.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                    {analytics.maturity.shortTerm.dueDate && (
                      <p className="text-xs text-green-700 mt-2">
                        Vence até: {new Date(analytics.maturity.shortTerm.dueDate).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>

                  <div className="bg-orange-50 p-4 rounded border border-orange-200">
                    <p className="text-xs text-orange-600 uppercase font-medium">Não Circulante ({">"}12m)</p>
                    <p className="text-2xl font-bold text-orange-900 mt-1">
                      R$ {analytics.maturity.longTerm.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                    {analytics.maturity.longTerm.dueDate && (
                      <p className="text-xs text-orange-700 mt-2">
                        Vence até: {new Date(analytics.maturity.longTerm.dueDate).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                </div>

                {/* Alertas */}
                {analytics.maturity.overdue.balance > 0 && (
                  <div className="bg-red-50 p-4 rounded border border-red-200 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-900">Parcelas Vencidas</p>
                      <p className="text-sm text-red-700">
                        R$ {analytics.maturity.overdue.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                )}

                {analytics.maturity.dueSoon.balance > 0 && (
                  <div className="bg-yellow-50 p-4 rounded border border-yellow-200 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-yellow-900">Vence em menos de 30 dias</p>
                      <p className="text-sm text-yellow-700">
                        R$ {analytics.maturity.dueSoon.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 3️⃣ STRUCTURE */}
          <TabsContent value="structure">
            <Card>
              <CardHeader>
                <CardTitle>Estrutura da Dívida</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Por Tipo de Operação */}
                <div>
                  <h3 className="font-semibold text-slate-700 mb-3">Por Tipo de Operação</h3>
                  <div className="space-y-2">
                    {Object.entries(analytics.structure.byOperationType).map(([type, data]) => (
                      <div key={type} className="flex justify-between items-center p-3 bg-slate-50 rounded border border-slate-200">
                        <div>
                          <p className="font-medium text-slate-900">{type}</p>
                          <p className="text-xs text-slate-500">{data.count} contrato(s)</p>
                        </div>
                        <p className="font-bold text-slate-900">
                          R$ {data.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Por Categoria */}
                <div>
                  <h3 className="font-semibold text-slate-700 mb-3">Por Categoria</h3>
                  <div className="space-y-2">
                    {Object.entries(analytics.structure.byOperationCategory).map(([category, data]) => (
                      <div key={category} className="flex justify-between items-center p-3 bg-slate-50 rounded border border-slate-200">
                        <div>
                          <p className="font-medium text-slate-900">{category}</p>
                          <p className="text-xs text-slate-500">{data.count} contrato(s)</p>
                        </div>
                        <p className="font-bold text-slate-900">
                          R$ {data.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 4️⃣ CURVE */}
          <TabsContent value="curve">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5" />
                  Curva de Vencimentos (Próximos 36 meses)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {Object.entries(analytics.curve).map(([monthKey, data]) => (
                    <div key={monthKey} className="flex justify-between items-center p-3 bg-slate-50 rounded border border-slate-200">
                      <div>
                        <p className="font-medium text-slate-900">{monthKey}</p>
                        <p className="text-xs text-slate-500">{data.contracts.length} contrato(s)</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900">
                          R$ {data.totalPayment.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-slate-500">
                          Principal: R$ {data.principalDue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Interest & FX */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Percent className="w-5 h-5" />
                Juros por Período
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded border border-slate-200">
                  <p className="text-xs text-slate-500 uppercase font-medium">Juros Fixos</p>
                  <p className="font-bold text-slate-900 mt-1">
                    R$ {analytics.interestPeriod.fixedInterest.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-slate-50 p-3 rounded border border-slate-200">
                  <p className="text-xs text-slate-500 uppercase font-medium">Juros Variáveis</p>
                  <p className="font-bold text-slate-900 mt-1">
                    R$ {analytics.interestPeriod.variableInterest.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              <div className="bg-blue-50 p-3 rounded border border-blue-200">
                <p className="text-xs text-blue-600 uppercase font-medium">Total</p>
                <p className="font-bold text-blue-900 mt-1">
                  R$ {analytics.interestPeriod.totalInterest.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Variação Cambial
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`p-4 rounded border ${analytics.fxPeriod.totalVariation >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-xs font-medium uppercase ${analytics.fxPeriod.totalVariation >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  Var. Cambial Total
                </p>
                <p className={`text-2xl font-bold mt-1 ${analytics.fxPeriod.totalVariation >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                  R$ {analytics.fxPeriod.totalVariation.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}