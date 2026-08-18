import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Percent,
  ArrowLeftRight,
  Table as TableIcon,
  Landmark,
  Clock,
  ClipboardCheck,
} from "lucide-react";
import FechamentoContabil from "./FechamentoContabil";
import {
  getDebtPositionByDate,
  getDebtMaturityBreakdown,
  getInterestByMonth,
  getInterestByPeriod,
  getFXVariationByPeriod,
  getExercicioStart,
  getPaymentFlowByBankModalityGuarantee,
  getMonthlyRollForward,
} from "./debtAnalytics";
import { OPERATION_TYPES } from "@/lib/contractOptions";

const MONTHS = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function lastDayOfMonth(year, month) {
  // month é 1-12; new Date(year, month, 0) devolve o último dia do mês "month"
  return new Date(year, month, 0).toISOString().split("T")[0];
}

function operationTypeLabel(operationType) {
  for (const list of Object.values(OPERATION_TYPES)) {
    const found = list.find((o) => o.value === operationType);
    if (found) return found.label;
  }
  return operationType || "Sem Tipo";
}

function KPICard({ icon: Icon, title, value, subtitle, color = "blue" }) {
  const colorClasses = {
    blue: "bg-blue-50 border-blue-200 text-blue-600",
    green: "bg-green-50 border-green-200 text-green-600",
    red: "bg-red-50 border-red-200 text-red-600",
    orange: "bg-orange-50 border-orange-200 text-orange-600",
    slate: "bg-slate-50 border-slate-200 text-slate-600",
  };

  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase opacity-75">{title}</p>
          <p className="text-xl font-bold mt-1 text-slate-900">{value}</p>
          {subtitle && <p className="text-xs mt-2 opacity-75">{subtitle}</p>}
        </div>
        <Icon className="w-5 h-5 opacity-50 shrink-0" />
      </div>
    </div>
  );
}

// Linha da tabela de Movimentação Contábil do Mês (roll-forward). `strong`
// deixa a linha de Saldo (abertura/fechamento) em destaque, como uma
// conciliação contábil de verdade.
function RollForwardRow({ label, bucket, strong = false, sign = null }) {
  const cellClass = `px-3 py-2 text-right font-mono ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`;
  const fmt = (v) => {
    if (sign === "+" && v > 0) return formatCurrency(v);
    if (sign === "-" && v > 0) return `(${formatCurrency(v)})`;
    return formatCurrency(v);
  };
  return (
    <tr className={strong ? "bg-slate-50 border-y border-slate-200" : "border-b border-slate-100"}>
      <td className={`px-3 py-2 ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{label}</td>
      <td className={cellClass}>{fmt(bucket.principal)}</td>
      <td className={cellClass}>{fmt(bucket.interest)}</td>
      <td className={cellClass}>{fmt(bucket.fx)}</td>
      <td className={cellClass}>{fmt(bucket.total)}</td>
    </tr>
  );
}

export default function AccountingReading() {
  const today = new Date().toISOString().split("T")[0];
  const [baseDate, setBaseDate] = useState(today);
  const [exercicioStartMonth, setExercicioStartMonth] = useState("1");
  const [entityFilter, setEntityFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [flowView, setFlowView] = useState("principal_juros"); // "principal" | "principal_juros"

  const { data: allContracts = [] } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => {
      const all = await base44.entities.LoanContract.list("", 10000);
      // Leitura contábil é um efeito contábil — só contratos Aprovados entram
      // nos números (mesma regra aplicada no resto do app).
      return all.filter((c) => c.status === "aprovado");
    },
    initialData: [],
  });

  const { data: banks = [] } = useQuery({
    queryKey: ["banks"],
    queryFn: () => base44.entities.Bank.list("", 1000),
    initialData: [],
  });

  const { data: entities = [] } = useQuery({
    queryKey: ["entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    initialData: [],
  });

  const { data: allCurrencies = [] } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => base44.entities.Currency.list("", 1000),
    initialData: [],
  });

  const bankName = (bankId) => banks.find((b) => b.id === bankId)?.bank_name || "Sem Banco";

  // Moedas únicas por código (mesma dedupe usada no Simulador) — usadas só
  // para popular as opções do filtro; BRL é sempre a opção implícita para
  // contratos sem currency_id.
  const currencyOptions = useMemo(() => {
    const unique = new Map();
    allCurrencies.forEach((c) => {
      if (!unique.has(c.currency_code)) unique.set(c.currency_code, c);
    });
    return Array.from(unique.values());
  }, [allCurrencies]);

  const currencyIdToCode = useMemo(() => {
    const map = new Map();
    allCurrencies.forEach((c) => map.set(c.id, c.currency_code));
    return map;
  }, [allCurrencies]);

  // Contratos filtrados por Empresa e Moeda — aplicado ANTES de qualquer
  // função analítica, para que todos os números da tela (cards, roll-forward,
  // fluxo futuro) reflitam consistentemente o recorte escolhido.
  const contracts = useMemo(() => {
    return allContracts.filter((c) => {
      if (entityFilter !== "all" && c.entity_id !== entityFilter) return false;
      if (currencyFilter !== "all") {
        const code = c.currency_id ? currencyIdToCode.get(c.currency_id) : "BRL";
        if (code !== currencyFilter) return false;
      }
      return true;
    });
  }, [allContracts, entityFilter, currencyFilter, currencyIdToCode]);

  const analysis = useMemo(() => {
    if (contracts.length === 0) return null;

    const baseDateObj = new Date(baseDate + "T00:00:00");
    const year = baseDateObj.getFullYear();
    const month = baseDateObj.getMonth() + 1;

    const exercicioStart = getExercicioStart(baseDate, exercicioStartMonth);
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = lastDayOfMonth(year, month);

    const position = getDebtPositionByDate(contracts, baseDate);
    const maturity = getDebtMaturityBreakdown(contracts, baseDate);
    const interestExercicio = getInterestByPeriod(contracts, exercicioStart, baseDate);
    const interestMonth = getInterestByMonth(contracts, year, month);
    const fxExercicio = getFXVariationByPeriod(contracts, exercicioStart, baseDate);
    const fxMonth = getFXVariationByPeriod(contracts, monthStart, monthEnd);
    const paymentFlow = getPaymentFlowByBankModalityGuarantee(contracts, baseDate, 5);
    const rollForward = getMonthlyRollForward(contracts, year, month);

    return {
      exercicioStart,
      monthLabel: MONTHS.find((m) => m.value === String(month))?.label,
      position,
      maturity,
      interestExercicio,
      interestMonth,
      fxExercicio,
      fxMonth,
      paymentFlow,
      rollForward,
    };
  }, [contracts, baseDate, exercicioStartMonth]);

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Módulo Contábil · Endividamento</p>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Leitura Contábil</h1>
          <p className="text-sm text-slate-500 mt-1">
            Posição, competência e fluxo futuro dos contratos aprovados
          </p>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Data-Base</Label>
              <Input
                type="date"
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
                className="h-9 mt-2"
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Empresa</Label>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="h-9 mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Consolidado do Grupo</SelectItem>
                  {entities.map((e) => (<SelectItem key={e.id} value={e.id}>{e.entity_name}</SelectItem>))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Moeda</Label>
              <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                <SelectTrigger className="h-9 mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="BRL">BRL</SelectItem>
                  {currencyOptions.filter((c) => c.currency_code !== "BRL").map((c) => (
                    <SelectItem key={c.id} value={c.currency_code}>{c.currency_code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Início do Exercício</Label>
              <Select value={exercicioStartMonth} onValueChange={setExercicioStartMonth}>
                <SelectTrigger className="h-9 mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>

        {analysis && (
          <p className="text-xs text-slate-400">
            Exercício corrente: {analysis.exercicioStart.split("-").reverse().join("/")} até {baseDate.split("-").reverse().join("/")}.
            Use Janeiro para ano civil, ou outro mês para configurar um ano-safra (ex.: Abril, Agosto etc.).
          </p>
        )}

        {!analysis && entityFilter === "all" ? (
          <div className="flex items-center justify-center min-h-64">
            <p className="text-slate-500">Nenhum contrato aprovado encontrado para os filtros selecionados.</p>
          </div>
        ) : (
          <Tabs defaultValue="posicao" className="w-full">
            <TabsList className="bg-slate-100">
              <TabsTrigger value="posicao" className="text-xs sm:text-sm gap-1.5">
                <Landmark className="w-3.5 h-3.5" /> Posição Contábil
              </TabsTrigger>
              <TabsTrigger value="competencia" className="text-xs sm:text-sm gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Competência
              </TabsTrigger>
              <TabsTrigger value="fluxo" className="text-xs sm:text-sm gap-1.5">
                <TableIcon className="w-3.5 h-3.5" /> Fluxo e Nota Explicativa
              </TabsTrigger>
              <TabsTrigger value="fechamento" className="text-xs sm:text-sm gap-1.5">
                <ClipboardCheck className="w-3.5 h-3.5" /> Fechamento Contábil
              </TabsTrigger>
            </TabsList>

            {/* SUB-ABA 1: POSIÇÃO CONTÁBIL */}
            <TabsContent value="posicao" className="mt-4 space-y-6">
              {!analysis ? (
                <p className="text-sm text-slate-500 py-10 text-center">Nenhum contrato aprovado para esta empresa.</p>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KPICard
                  icon={DollarSign}
                  title="Saldo Contábil Total"
                  value={formatCurrency(analysis.position.totalBalance)}
                  subtitle={`Posição em ${baseDate.split("-").reverse().join("/")}`}
                  color="blue"
                />
                <KPICard
                  icon={TrendingDown}
                  title="Circulante (Curto Prazo)"
                  value={formatCurrency(analysis.maturity.shortTerm.balance)}
                  subtitle="Vencimentos em até 12 meses"
                  color="orange"
                />
                <KPICard
                  icon={TrendingUp}
                  title="Não Circulante (Longo Prazo)"
                  value={formatCurrency(analysis.maturity.longTerm.balance)}
                  subtitle="Vencimentos acima de 12 meses"
                  color="green"
                />
              </div>
              )}
            </TabsContent>

            {/* SUB-ABA 2: COMPETÊNCIA */}
            <TabsContent value="competencia" className="mt-4 space-y-6">
              {!analysis ? (
                <p className="text-sm text-slate-500 py-10 text-center">Nenhum contrato aprovado para esta empresa.</p>
              ) : (
              <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  icon={Percent}
                  title="Juros do Exercício"
                  value={formatCurrency(analysis.interestExercicio.totalInterest)}
                  subtitle={`Acumulado de ${analysis.exercicioStart.split("-").reverse().join("/")} à data-base`}
                  color="slate"
                />
                <KPICard
                  icon={Percent}
                  title="Juros do Mês"
                  value={formatCurrency(analysis.interestMonth.totalInterest)}
                  subtitle={`Competência ${analysis.monthLabel?.toLowerCase()}/${analysis.rollForward.year}`}
                  color="slate"
                />
                <KPICard
                  icon={ArrowLeftRight}
                  title="Variação Cambial do Exercício"
                  value={formatCurrency(analysis.fxExercicio.totalVariation)}
                  subtitle={`Acumulado de ${analysis.exercicioStart.split("-").reverse().join("/")} à data-base`}
                  color="slate"
                />
                <KPICard
                  icon={ArrowLeftRight}
                  title="Variação Cambial do Mês"
                  value={formatCurrency(analysis.fxMonth.totalVariation)}
                  subtitle={`Competência ${analysis.monthLabel?.toLowerCase()}/${analysis.rollForward.year}`}
                  color="slate"
                />
              </div>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-slate-800">
                    Movimentação Contábil do Mês
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    Conciliação do saldo inicial ao final — {analysis.monthLabel}/{analysis.rollForward.year}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left font-medium text-slate-500 uppercase text-xs px-3 py-2">Movimento</th>
                          <th className="text-right font-medium text-slate-500 uppercase text-xs px-3 py-2">Principal</th>
                          <th className="text-right font-medium text-slate-500 uppercase text-xs px-3 py-2">Juros</th>
                          <th className="text-right font-medium text-slate-500 uppercase text-xs px-3 py-2">Variação Cambial</th>
                          <th className="text-right font-medium text-slate-700 uppercase text-xs px-3 py-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        <RollForwardRow label="Saldo Inicial" bucket={analysis.rollForward.opening} strong />
                        <RollForwardRow label="Apropriações" bucket={analysis.rollForward.accruals} sign="+" />
                        <RollForwardRow label="Pagamentos" bucket={analysis.rollForward.payments} sign="-" />
                        <RollForwardRow label="Saldo Final" bucket={analysis.rollForward.closing} strong />
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-400 mt-3">
                    Apropriações somam juros e variação cambial reconhecidos no mês (regime de competência) e
                    eventuais novas captações; Pagamentos são amortizações e juros efetivamente pagos em caixa.
                    Saldo Inicial + Apropriações − Pagamentos = Saldo Final, em cada coluna.
                  </p>
                </CardContent>
              </Card>
              </>
              )}
            </TabsContent>

            {/* SUB-ABA 3: FLUXO E NOTA EXPLICATIVA */}
            <TabsContent value="fluxo" className="mt-4">
              {!analysis ? (
                <p className="text-sm text-slate-500 py-10 text-center">Nenhum contrato aprovado para esta empresa.</p>
              ) : (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <CardTitle className="text-base font-semibold text-slate-800">
                      Fluxo de Pagamentos Futuros — por Banco, Modalidade e Garantia
                    </CardTitle>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={flowView === "principal" ? "default" : "outline"}
                        className={`h-7 text-xs ${flowView === "principal" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                        onClick={() => setFlowView("principal")}
                      >
                        Só Principal
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={flowView === "principal_juros" ? "default" : "outline"}
                        className={`h-7 text-xs ${flowView === "principal_juros" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                        onClick={() => setFlowView("principal_juros")}
                      >
                        Principal + Juros
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {analysis.paymentFlow.rows.length === 0 ? (
                    <p className="text-sm text-slate-500 py-6 text-center">
                      Nenhum pagamento futuro previsto a partir da data-base selecionada.
                    </p>
                  ) : (
                    <div className="overflow-x-auto -mx-2">
                      <table className="w-full text-sm min-w-[900px]">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Banco</th>
                            <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Modalidade</th>
                            <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Garantia</th>
                            {analysis.paymentFlow.years.map((y) => (
                              <th key={y} className="text-right font-medium text-slate-500 uppercase text-xs px-2 py-2">{y}</th>
                            ))}
                            <th className="text-right font-medium text-slate-500 uppercase text-xs px-2 py-2">{analysis.paymentFlow.catchAllLabel}</th>
                            <th className="text-right font-medium text-slate-700 uppercase text-xs px-2 py-2">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.paymentFlow.rows.map((row, idx) => {
                            const valueFor = (bucket) =>
                              flowView === "principal"
                                ? bucket.principal
                                : bucket.principal + bucket.interest;

                            const rowTotal =
                              analysis.paymentFlow.years.reduce(
                                (sum, y) => sum + valueFor(row.byYear[y] || { principal: 0, interest: 0 }),
                                0
                              ) + valueFor(row.catchAll);

                            return (
                              <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-2 py-2 text-slate-700">{bankName(row.bankId)}</td>
                                <td className="px-2 py-2 text-slate-700">{operationTypeLabel(row.operationType)}</td>
                                <td className="px-2 py-2 text-slate-700">{row.guarantee}</td>
                                {analysis.paymentFlow.years.map((y) => (
                                  <td key={y} className="px-2 py-2 text-right font-mono text-slate-700">
                                    {formatCurrency(valueFor(row.byYear[y] || { principal: 0, interest: 0 }))}
                                  </td>
                                ))}
                                <td className="px-2 py-2 text-right font-mono text-slate-700">
                                  {formatCurrency(valueFor(row.catchAll))}
                                </td>
                                <td className="px-2 py-2 text-right font-mono font-semibold text-slate-900">
                                  {formatCurrency(rowTotal)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-xs text-slate-400 mt-3">
                    Nota explicativa: valores projetados a partir do cronograma vigente de cada contrato aprovado,
                    a partir da data-base selecionada. "Garantia" combina os eixos Real (Alienação Fiduciária,
                    Hipoteca, Penhor, Cessão de Recebíveis) e Pessoal/Fidejussória (Aval, Fiança); contratos sem
                    nenhuma garantia registrada aparecem como "Não informado".
                  </p>
                </CardContent>
              </Card>
              )}
            </TabsContent>

            {/* SUB-ABA 4: FECHAMENTO CONTÁBIL */}
            <TabsContent value="fechamento" className="mt-4">
              <FechamentoContabil
                entityId={entityFilter !== "all" ? entityFilter : null}
                entityName={entities.find((e) => e.id === entityFilter)?.entity_name || ""}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
