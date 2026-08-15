import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, TrendingUp, BarChart3 } from "lucide-react";
import AccountingAnalysis from "../components/accounting/AccountingAnalysis";
import DebtAnalyticsDashboard from "../components/accounting/DebtAnalyticsDashboard";
import DebtMapHierarchical from "../components/accounting/DebtMapHierarchical";
import DebtMapByMonth from "../components/accounting/DebtMapByMonth";

export default function Accounting() {
  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().split("T")[0];
  
  const [startDate, setStartDate] = useState(monthStartStr);
  const [endDate, setEndDate] = useState(today);
  const [analysisData, setAnalysisData] = useState(null);

  const { data: contracts, isLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => {
      const all = await base44.entities.LoanContract.list("", 10000);
      return all.filter(c => c.status === "aprovado");
    },
    initialData: [],
  });

  const handleAnalyze = async () => {
    if (!startDate || !endDate || contracts.length === 0) return;

    const startDateObj = new Date(startDate + "T12:00:00");
    const endDateObj = new Date(endDate + "T12:00:00");

    const analysis = {
      startDate,
      endDate,
      metrics: {
        principalDue12m: 0,
        principalDueOver12m: 0,
        interestMonth: 0,
        interestYear: 0,
        interestAccumulated: 0,
        totalDebt: 0,
      },
      contracts: [],
    };

    contracts.forEach((contract) => {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      let contractMetrics = {
        principalDue12m: 0,
        principalDueOver12m: 0,
        interestMonth: 0,
        interestYear: 0,
        interestAccumulated: 0,
      };

      for (let idx = 0; idx < schedule.length; idx++) {
        const row = schedule[idx];
        const rowDate = new Date(row.dataVencimento + "T12:00:00");

        // Incluir linhas até a data final
        if (rowDate <= endDateObj) {
          const monthInterest = (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);

          // Juros dentro do range
          if (rowDate >= startDateObj && rowDate <= endDateObj) {
            contractMetrics.interestAccumulated += monthInterest;
          }

          // Saldo final da linha = dívida pendente
          if (idx === schedule.length - 1 || schedule[idx + 1].dataVencimento > row.dataVencimento) {
            // Próximos pagamentos de principal
            for (let j = idx + 1; j < schedule.length; j++) {
              const futureRow = schedule[j];
              const futureDate = new Date(futureRow.dataVencimento + "T12:00:00");
              const monthsAhead = (futureDate.getFullYear() - endDateObj.getFullYear()) * 12 + (futureDate.getMonth() - endDateObj.getMonth());

              if (futureRow.amortizacao > 0) {
                if (monthsAhead > 0 && monthsAhead <= 12) {
                  contractMetrics.principalDue12m += futureRow.amortizacao;
                } else if (monthsAhead > 12) {
                  contractMetrics.principalDueOver12m += futureRow.amortizacao;
                }
              }
            }
            break;
          }
        }
      }

      // Calcular saldo total do contrato até a data final
      const lastRowBeforeDate = schedule.reverse().find((row) => {
        const rowDate = new Date(row.dataVencimento + "T12:00:00");
        return rowDate <= endDateObj;
      });

      if (lastRowBeforeDate) {
        contractMetrics.totalDebt = lastRowBeforeDate.sdFinal || 0;
      }

      analysis.metrics.principalDue12m += contractMetrics.principalDue12m;
      analysis.metrics.principalDueOver12m += contractMetrics.principalDueOver12m;
      analysis.metrics.interestMonth += contractMetrics.interestMonth;
      analysis.metrics.interestYear += contractMetrics.interestYear;
      analysis.metrics.interestAccumulated += contractMetrics.interestAccumulated;
      analysis.metrics.totalDebt += contractMetrics.totalDebt;

      analysis.contracts.push({
        id: contract.id,
        contract_number: contract.contract_number,
        bank: contract.bank_id,
        ...contractMetrics,
      });
    });

    setAnalysisData(analysis);
  };

  return (
    <div className="w-full">
      <Tabs defaultValue="analytics" className="w-full">
        <div className="sticky top-14 z-40 bg-white border-b border-slate-200 px-4 sm:px-6 overflow-x-auto">
          <div className="max-w-7xl mx-auto">
            <TabsList className="grid w-full grid-cols-4 h-auto bg-transparent border-b border-slate-200">
              <TabsTrigger 
                value="analytics" 
                className="flex items-center gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 px-4 py-3 text-xs sm:text-sm"
              >
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Analítica</span>
                <span className="sm:hidden">Analytics</span>
              </TabsTrigger>
              <TabsTrigger 
                value="mapa" 
                className="flex items-center gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 px-4 py-3 text-xs sm:text-sm"
              >
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Mapa Clássico</span>
                <span className="sm:hidden">Clássico</span>
              </TabsTrigger>
              <TabsTrigger 
                value="periodo" 
                className="flex items-center gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 px-4 py-3 text-xs sm:text-sm"
              >
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Mapa Período</span>
                <span className="sm:hidden">Período</span>
              </TabsTrigger>
              <TabsTrigger 
                value="endividamento" 
                className="flex items-center gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 px-4 py-3 text-xs sm:text-sm"
              >
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Tradicional</span>
                <span className="sm:hidden">Trad.</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* TAB 1: DEBT ANALYTICS */}
        <TabsContent value="analytics" className="mt-0">
          <DebtAnalyticsDashboard />
        </TabsContent>

        {/* TAB 2: HIERARCHICAL MAP */}
        <TabsContent value="mapa" className="mt-0">
          <DebtMapHierarchical />
        </TabsContent>

        {/* TAB 3: BY MONTH MAP */}
        <TabsContent value="periodo" className="mt-0">
          <DebtMapByMonth />
        </TabsContent>

        {/* TAB 4: TRADITIONAL ANALYSIS */}
        <TabsContent value="endividamento" className="mt-0">
          <div className="w-full px-4 sm:px-6 py-8">
            <div className="max-w-7xl mx-auto space-y-8">
              {/* Header */}
              <div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Análise de Endividamento</h1>
                <p className="text-sm text-slate-500 mt-1">Análise de juros e posição por período</p>
              </div>

              {/* Date Selection */}
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
                    <Calendar className="w-4 h-4 text-blue-600" />
                    Data-Base da Análise
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Data Inicial
                      </Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Data Final
                      </Label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <Button onClick={handleAnalyze} className="bg-blue-600 hover:bg-blue-700 h-9 gap-2 w-full md:w-auto">
                    <TrendingUp className="w-4 h-4" />
                    Analisar
                  </Button>
                </CardContent>
              </Card>

              {/* Results */}
              {analysisData && <AccountingAnalysis data={analysisData} />}

              {!analysisData && !isLoading && (
                <div className="flex items-center justify-center min-h-96">
                  <div className="text-center">
                    <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                      <TrendingUp className="w-10 h-10 text-slate-300" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-700">Nenhuma análise realizada</h3>
                    <p className="text-sm text-slate-400 mt-1">Selecione uma data e clique em "Analisar"</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}