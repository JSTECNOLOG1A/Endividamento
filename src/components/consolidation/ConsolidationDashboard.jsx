import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSortableRows, SortableHead } from "@/components/ui/sortable-table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart } from "recharts";
import { TrendingUp, PieChart as PieChartIcon, Activity, Calendar, Download, Eye } from "lucide-react";
import { format, parseISO, isBefore, isAfter, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value || 0);
}

function calculateBalanceAtDate(contract, referenceDate) {
  if (!contract.schedule_data) return { saldoDevedor: 0, jurosFuturos: 0 };
  
  try {
    const scheduleData = JSON.parse(contract.schedule_data);
    const schedule = scheduleData.schedule || scheduleData || [];
    
    const refDate = new Date(referenceDate);
    refDate.setHours(0, 0, 0, 0);
    
    // Encontrar a última parcela paga até a data de referência
    let saldoDevedor = 0;
    let jurosFuturos = 0;
    
    for (const row of schedule) {
      const rowDate = new Date(row.dataVencimento);
      rowDate.setHours(0, 0, 0, 0);
      
      if (isBefore(rowDate, refDate) || rowDate.getTime() === refDate.getTime()) {
        // Parcela vencida ou na data de referência
        saldoDevedor = row.saldoDevedor || 0;
      } else {
        // Parcelas futuras - somar juros
        jurosFuturos += (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
      }
    }
    
    return { saldoDevedor, jurosFuturos };
  } catch (e) {
    return { saldoDevedor: 0, jurosFuturos: 0 };
  }
}

function getUpcomingPayments(contract, referenceDate, months = 12) {
  if (!contract.schedule_data) return [];
  
  try {
    const scheduleData = JSON.parse(contract.schedule_data);
    const schedule = scheduleData.schedule || scheduleData || [];
    
    const refDate = new Date(referenceDate);
    const endDate = addMonths(refDate, months);
    
    return schedule.filter(row => {
      const rowDate = new Date(row.dataVencimento);
      return isAfter(rowDate, refDate) && isBefore(rowDate, endDate);
    });
  } catch (e) {
    return [];
  }
}

// Config de ordenação das 4 tabelas abaixo — constantes fora do componente
// (referência estável entre renders), mesmo padrão de ContractsList.jsx.
const DRILLDOWN_SORT_COLUMNS = {
  operation_value: { numeric: true },
  saldoDevedor: { numeric: true },
  pctAmortizado: { numeric: true },
  jurosFuturos: { numeric: true },
};
const GROUP_SORT_COLUMNS = {
  contracts: { numeric: true },
  valorOriginal: { numeric: true },
  saldoAtual: { numeric: true },
  pctAmortizado: { numeric: true },
  jurosFuturos: { numeric: true },
};
const BANK_SORT_COLUMNS = {
  contracts: { numeric: true },
  valorOriginal: { numeric: true },
  saldoAtual: { numeric: true },
  concentration: { numeric: true },
};
const OP_SORT_COLUMNS = {
  contracts: { numeric: true },
  valorOriginal: { numeric: true },
  saldoAtual: { numeric: true },
  percentage: { numeric: true },
};

export default function ConsolidationDashboard({ contracts, groups, entities, banks }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [referenceDate, setReferenceDate] = useState(today);
  const [bankFilter, setBankFilter] = useState("all");
  const [operationFilter, setOperationFilter] = useState("all");
  const [drilldownGroup, setDrilldownGroup] = useState(null);

  const operationTypes = [
    { value: "all", label: "Todos os Tipos" },
    { value: "emprestimo", label: "Empréstimo" },
    { value: "financiamento", label: "Financiamento" },
    { value: "capital_giro", label: "Capital de Giro" },
    { value: "conta_garantida", label: "Conta Garantida" },
    { value: "FINAME", label: "FINAME" },
  ];

  // Filtrar contratos. A Consolidação é um efeito contábil (posição de
  // dívida), então só pode refletir contratos Aprovados — isso NÃO é um
  // filtro que o usuário pode desligar (diferente de Banco/Tipo abaixo,
  // que são apenas recortes de visualização). Reforçado aqui mesmo que o
  // componente pai já filtre, como segunda camada de proteção.
  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
      if (c.status !== "aprovado") return false;
      if (bankFilter !== "all" && c.bank_id !== bankFilter) return false;
      if (operationFilter !== "all" && c.operation_type !== operationFilter) return false;
      return true;
    });
  }, [contracts, bankFilter, operationFilter]);

  const consolidation = useMemo(() => {
    const byGroup = {};
    const byBank = {};
    const byBankPerGroup = {};
    const byOperationType = {};
    const upcomingPaymentsByMonth = {};

    filteredContracts.forEach((c) => {
      const groupName = groups.find((g) => g.id === c.group_id)?.group_name || "Desconhecido";
      const bankName = banks.find((b) => b.id === c.bank_id)?.bank_name || "Desconhecido";
      const entityName = entities.find((e) => e.id === c.entity_id)?.entity_name || "Desconhecido";
      
      const { saldoDevedor, jurosFuturos } = calculateBalanceAtDate(c, referenceDate);
      const upcomingPayments = getUpcomingPayments(c, referenceDate, 12);

      // Por Grupo
      if (!byGroup[groupName]) {
        byGroup[groupName] = { 
          name: groupName, 
          valorOriginal: 0, 
          saldoAtual: 0, 
          jurosFuturos: 0,
          contracts: 0,
          contractsList: []
        };
      }
      byGroup[groupName].valorOriginal += c.operation_value || 0;
      byGroup[groupName].saldoAtual += saldoDevedor;
      byGroup[groupName].jurosFuturos += jurosFuturos;
      byGroup[groupName].contracts += 1;
      byGroup[groupName].contractsList.push({ ...c, bankName, saldoDevedor, jurosFuturos });

      // Por Banco
      if (!byBank[bankName]) {
        byBank[bankName] = { 
          name: bankName, 
          valorOriginal: 0,
          saldoAtual: 0,
          contracts: 0 
        };
      }
      byBank[bankName].valorOriginal += c.operation_value || 0;
      byBank[bankName].saldoAtual += saldoDevedor;
      byBank[bankName].contracts += 1;

      // Por Tipo de Operação
      const opType = c.operation_type || "Não especificado";
      if (!byOperationType[opType]) {
        byOperationType[opType] = {
          name: opType,
          valorOriginal: 0,
          saldoAtual: 0,
          contracts: 0
        };
      }
      byOperationType[opType].valorOriginal += c.operation_value || 0;
      byOperationType[opType].saldoAtual += saldoDevedor;
      byOperationType[opType].contracts += 1;

      // Por Banco × Grupo
      const key = `${groupName}|${bankName}`;
      if (!byBankPerGroup[key]) {
        byBankPerGroup[key] = { 
          group: groupName, 
          bank: bankName, 
          valorOriginal: 0,
          saldoAtual: 0,
          contracts: 0 
        };
      }
      byBankPerGroup[key].valorOriginal += c.operation_value || 0;
      byBankPerGroup[key].saldoAtual += saldoDevedor;
      byBankPerGroup[key].contracts += 1;

      // Vencimentos por mês
      upcomingPayments.forEach(payment => {
        const month = format(new Date(payment.dataVencimento), "MMM/yy", { locale: ptBR });
        if (!upcomingPaymentsByMonth[month]) {
          upcomingPaymentsByMonth[month] = { month, principal: 0, juros: 0, total: 0 };
        }
        upcomingPaymentsByMonth[month].principal += payment.amortizacao || 0;
        upcomingPaymentsByMonth[month].juros += (payment.jurosFixosMes || 0) + (payment.jurosVariaveisMes || 0);
        upcomingPaymentsByMonth[month].total += payment.prestacao || 0;
      });
    });

    return {
      byGroup: Object.values(byGroup),
      byBank: Object.values(byBank),
      byOperationType: Object.values(byOperationType),
      byBankPerGroup: Object.values(byBankPerGroup),
      upcomingPayments: Object.values(upcomingPaymentsByMonth),
    };
  }, [filteredContracts, groups, entities, banks, referenceDate]);

  const totalValorOriginal = consolidation.byGroup.reduce((sum, g) => sum + g.valorOriginal, 0);
  const totalSaldoAtual = consolidation.byGroup.reduce((sum, g) => sum + g.saldoAtual, 0);
  const totalJurosFuturos = consolidation.byGroup.reduce((sum, g) => sum + g.jurosFuturos, 0);
  const totalContracts = filteredContracts.length;
  const amortizadoTotal = totalValorOriginal - totalSaldoAtual;

  // Linhas das 4 tabelas abaixo, já com o campo derivado (% amortizado /
  // concentração) calculado e a ordenação padrão (por saldo atual, maior pra
  // menor) aplicada — a reordenação por clique no título (useSortableRows)
  // substitui essa ordem só quando o usuário clica em algum título; os hooks
  // ficam aqui em cima, antes do "return" do drill-down, pra respeitar a
  // regra de hooks do React (sempre chamados na mesma ordem, mesmo branch).
  const drilldownGroupData = drilldownGroup ? consolidation.byGroup.find((g) => g.name === drilldownGroup) : null;
  const drilldownRows = useMemo(() => {
    return (drilldownGroupData?.contractsList || []).map((c, idx) => ({
      ...c,
      _key: c.id ?? idx,
      pctAmortizado: c.operation_value > 0 ? ((c.operation_value - c.saldoDevedor) / c.operation_value) * 100 : 0,
    }));
  }, [drilldownGroupData]);
  const drilldownSort = useSortableRows(drilldownRows, DRILLDOWN_SORT_COLUMNS);

  const groupRows = useMemo(() => {
    return [...consolidation.byGroup]
      .sort((a, b) => b.saldoAtual - a.saldoAtual)
      .map((g) => ({
        ...g,
        pctAmortizado: g.valorOriginal > 0 ? ((g.valorOriginal - g.saldoAtual) / g.valorOriginal) * 100 : 0,
      }));
  }, [consolidation]);
  const groupSort = useSortableRows(groupRows, GROUP_SORT_COLUMNS);

  const bankRows = useMemo(() => {
    return [...consolidation.byBank]
      .sort((a, b) => b.saldoAtual - a.saldoAtual)
      .map((b) => ({ ...b, concentration: totalSaldoAtual > 0 ? (b.saldoAtual / totalSaldoAtual) * 100 : 0 }));
  }, [consolidation, totalSaldoAtual]);
  const bankSort = useSortableRows(bankRows, BANK_SORT_COLUMNS);

  const opRows = useMemo(() => {
    return [...consolidation.byOperationType]
      .sort((a, b) => b.saldoAtual - a.saldoAtual)
      .map((o) => ({ ...o, percentage: totalSaldoAtual > 0 ? (o.saldoAtual / totalSaldoAtual) * 100 : 0 }));
  }, [consolidation, totalSaldoAtual]);
  const opSort = useSortableRows(opRows, OP_SORT_COLUMNS);

  const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#0891b2", "#059669"];

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload[0]) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs">
        <p className="font-semibold text-slate-700 mb-1">{data.name || data.month}</p>
        {data.valorOriginal !== undefined && (
          <p className="text-slate-600">Original: {formatCurrency(data.valorOriginal)}</p>
        )}
        {data.saldoAtual !== undefined && (
          <p className="text-blue-600 font-medium">Saldo: {formatCurrency(data.saldoAtual)}</p>
        )}
        {data.principal !== undefined && (
          <>
            <p className="text-slate-600">Principal: {formatCurrency(data.principal)}</p>
            <p className="text-amber-600">Juros: {formatCurrency(data.juros)}</p>
            <p className="text-slate-800 font-semibold">Total: {formatCurrency(data.total)}</p>
          </>
        )}
      </div>
    );
  };

  const handleExportCSV = () => {
    const headers = ["Grupo", "Banco", "Tipo Operação", "Contrato", "Valor Original", "Saldo Atual", "Status"];
    const rows = filteredContracts.map(c => {
      const groupName = groups.find(g => g.id === c.group_id)?.group_name || "";
      const bankName = banks.find(b => b.id === c.bank_id)?.bank_name || "";
      const { saldoDevedor } = calculateBalanceAtDate(c, referenceDate);
      return [
        groupName,
        bankName,
        c.operation_type || "",
        c.contract_number || "",
        c.operation_value || 0,
        saldoDevedor,
        c.status || ""
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `consolidacao_${referenceDate}.csv`;
    link.click();
  };

  if (drilldownGroup) {
    const groupData = drilldownGroupData;
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{drilldownGroup}</h2>
            <p className="text-sm text-slate-500">Contratos detalhados do grupo</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDrilldownGroup(null)}>
            ← Voltar
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500 mb-1">Contratos</p>
              <p className="text-2xl font-bold">{groupData.contracts}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500 mb-1">Valor Original</p>
              <p className="text-2xl font-bold">{formatCurrency(groupData.valorOriginal)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500 mb-1">Saldo Atual</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(groupData.saldoAtual)}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Detalhamento por Contrato</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <SortableHead sortField="bankName" sortKey={drilldownSort.sortKey} sortDir={drilldownSort.sortDir} onSort={drilldownSort.toggleSort}>Banco</SortableHead>
                    <SortableHead sortField="contract_number" sortKey={drilldownSort.sortKey} sortDir={drilldownSort.sortDir} onSort={drilldownSort.toggleSort}>Contrato</SortableHead>
                    <SortableHead sortField="operation_type" sortKey={drilldownSort.sortKey} sortDir={drilldownSort.sortDir} onSort={drilldownSort.toggleSort}>Tipo</SortableHead>
                    <SortableHead sortField="operation_value" sortKey={drilldownSort.sortKey} sortDir={drilldownSort.sortDir} onSort={drilldownSort.toggleSort} right>Valor Original</SortableHead>
                    <SortableHead sortField="saldoDevedor" sortKey={drilldownSort.sortKey} sortDir={drilldownSort.sortDir} onSort={drilldownSort.toggleSort} right>Saldo Atual</SortableHead>
                    <SortableHead sortField="pctAmortizado" sortKey={drilldownSort.sortKey} sortDir={drilldownSort.sortDir} onSort={drilldownSort.toggleSort} right>% Amortizado</SortableHead>
                    <SortableHead sortField="jurosFuturos" sortKey={drilldownSort.sortKey} sortDir={drilldownSort.sortDir} onSort={drilldownSort.toggleSort} right>Juros Futuros</SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drilldownSort.sortedRows.map((c) => (
                    <TableRow key={c._key} className="hover:bg-slate-50">
                      <TableCell className="text-xs">{c.bankName}</TableCell>
                      <TableCell className="text-xs">{c.contract_number}</TableCell>
                      <TableCell className="text-xs">{c.operation_type}</TableCell>
                      <TableCell className="text-xs text-right">{formatCurrency(c.operation_value)}</TableCell>
                      <TableCell className="text-xs text-right text-blue-600">{formatCurrency(c.saldoDevedor)}</TableCell>
                      <TableCell className="text-xs text-right">
                        <Badge variant={c.pctAmortizado > 70 ? "default" : "secondary"} className="text-xs">
                          {c.pctAmortizado.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right text-amber-600">{formatCurrency(c.jurosFuturos)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Data de Referência</label>
              <Input 
                type="date" 
                value={referenceDate} 
                onChange={(e) => setReferenceDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Status</label>
              <div className="h-9 px-3 rounded-md border border-slate-200 bg-slate-50 flex items-center">
                <Badge variant="default" className="text-xs">Aprovado</Badge>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Consolidação é um efeito contábil: sempre restrita a contratos aprovados.
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Banco</label>
              <Select value={bankFilter} onValueChange={setBankFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Bancos</SelectItem>
                  {banks.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.bank_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Tipo de Operação</label>
              <Select value={operationFilter} onValueChange={setOperationFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {operationTypes.map(op => (
                    <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-9 w-full gap-2">
                <Download className="w-4 h-4" /> Exportar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Valor Original</p>
            <p className="text-xl font-bold text-slate-900">{formatCurrency(totalValorOriginal)}</p>
            <p className="text-xs text-slate-400 mt-1">{totalContracts} contratos</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Saldo Atual</p>
            <p className="text-xl font-bold text-blue-600">{formatCurrency(totalSaldoAtual)}</p>
            <p className="text-xs text-slate-400 mt-1">em {format(new Date(referenceDate), "dd/MM/yyyy")}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Amortizado</p>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(amortizadoTotal)}</p>
            <p className="text-xs text-slate-400 mt-1">
              {totalValorOriginal > 0 ? ((amortizadoTotal / totalValorOriginal) * 100).toFixed(1) : 0}% do total
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Juros Futuros</p>
            <p className="text-xl font-bold text-amber-600">{formatCurrency(totalJurosFuturos)}</p>
            <p className="text-xs text-slate-400 mt-1">até o vencimento</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Devido</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalSaldoAtual + totalJurosFuturos)}</p>
            <p className="text-xs text-slate-400 mt-1">saldo + juros</p>
          </CardContent>
        </Card>
      </div>

      {/* Exposição por Grupo */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            Exposição por Grupo Econômico
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={consolidation.byGroup}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} angle={-45} textAnchor="end" height={80} />
                <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="valorOriginal" fill="#94a3b8" radius={[4, 4, 0, 0]} name="Original" />
                <Bar dataKey="saldoAtual" fill="#2563eb" radius={[4, 4, 0, 0]} name="Saldo Atual" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={consolidation.byGroup}
                  dataKey="saldoAtual"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {consolidation.byGroup.map((_, idx) => (
                    <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Vencimentos Futuros */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Calendar className="w-4 h-4 text-amber-600" />
            Vencimentos - Próximos 12 Meses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={consolidation.upcomingPayments}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="principal" stackId="1" stroke="#2563eb" fill="#2563eb" name="Principal" />
                <Area type="monotone" dataKey="juros" stackId="1" stroke="#f59e0b" fill="#f59e0b" name="Juros" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Tabela de Grupos com Drill-down */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Activity className="w-4 h-4 text-emerald-600" />
            Detalhamento por Grupo Econômico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortField="name" sortKey={groupSort.sortKey} sortDir={groupSort.sortDir} onSort={groupSort.toggleSort}>Grupo</SortableHead>
                  <SortableHead sortField="contracts" sortKey={groupSort.sortKey} sortDir={groupSort.sortDir} onSort={groupSort.toggleSort} right>Contratos</SortableHead>
                  <SortableHead sortField="valorOriginal" sortKey={groupSort.sortKey} sortDir={groupSort.sortDir} onSort={groupSort.toggleSort} right>Valor Original</SortableHead>
                  <SortableHead sortField="saldoAtual" sortKey={groupSort.sortKey} sortDir={groupSort.sortDir} onSort={groupSort.toggleSort} right>Saldo Atual</SortableHead>
                  <SortableHead sortField="pctAmortizado" sortKey={groupSort.sortKey} sortDir={groupSort.sortDir} onSort={groupSort.toggleSort} right>% Amortizado</SortableHead>
                  <SortableHead sortField="jurosFuturos" sortKey={groupSort.sortKey} sortDir={groupSort.sortDir} onSort={groupSort.toggleSort} right>Juros Futuros</SortableHead>
                  <SortableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupSort.sortedRows.map((group) => (
                  <TableRow key={group.name} className="hover:bg-slate-50">
                    <TableCell className="text-sm font-medium text-slate-700">{group.name}</TableCell>
                    <TableCell className="text-xs text-right">{group.contracts}</TableCell>
                    <TableCell className="text-sm text-right">{formatCurrency(group.valorOriginal)}</TableCell>
                    <TableCell className="text-sm text-right text-blue-600 font-semibold">{formatCurrency(group.saldoAtual)}</TableCell>
                    <TableCell className="text-xs text-right">
                      <Badge variant={group.pctAmortizado > 50 ? "default" : "secondary"}>
                        {group.pctAmortizado.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right text-amber-600">{formatCurrency(group.jurosFuturos)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDrilldownGroup(group.name)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Concentração por Banco */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <PieChartIcon className="w-4 h-4 text-amber-600" />
            Concentração de Crédito por Banco
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortField="name" sortKey={bankSort.sortKey} sortDir={bankSort.sortDir} onSort={bankSort.toggleSort}>Banco</SortableHead>
                  <SortableHead sortField="contracts" sortKey={bankSort.sortKey} sortDir={bankSort.sortDir} onSort={bankSort.toggleSort} right>Contratos</SortableHead>
                  <SortableHead sortField="valorOriginal" sortKey={bankSort.sortKey} sortDir={bankSort.sortDir} onSort={bankSort.toggleSort} right>Valor Original</SortableHead>
                  <SortableHead sortField="saldoAtual" sortKey={bankSort.sortKey} sortDir={bankSort.sortDir} onSort={bankSort.toggleSort} right>Saldo Atual</SortableHead>
                  <SortableHead sortField="concentration" sortKey={bankSort.sortKey} sortDir={bankSort.sortDir} onSort={bankSort.toggleSort} right>% Concentração</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bankSort.sortedRows.map((bank) => (
                  <TableRow key={bank.name} className="hover:bg-slate-50">
                    <TableCell className="text-sm font-medium text-slate-700">{bank.name}</TableCell>
                    <TableCell className="text-xs text-right">{bank.contracts}</TableCell>
                    <TableCell className="text-sm text-right">{formatCurrency(bank.valorOriginal)}</TableCell>
                    <TableCell className="text-sm text-right text-blue-600 font-semibold">
                      {formatCurrency(bank.saldoAtual)}
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      <Badge
                        variant={bank.concentration > 30 ? "default" : bank.concentration > 15 ? "secondary" : "outline"}
                        className={`text-xs ${
                          bank.concentration > 30 ? "bg-red-100 text-red-800 border-red-200" : bank.concentration > 15 ? "bg-amber-100 text-amber-800 border-amber-200" : ""
                        }`}
                      >
                        {bank.concentration.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Por Tipo de Operação */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Activity className="w-4 h-4 text-purple-600" />
            Distribuição por Tipo de Operação
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortField="name" sortKey={opSort.sortKey} sortDir={opSort.sortDir} onSort={opSort.toggleSort}>Tipo</SortableHead>
                  <SortableHead sortField="contracts" sortKey={opSort.sortKey} sortDir={opSort.sortDir} onSort={opSort.toggleSort} right>Contratos</SortableHead>
                  <SortableHead sortField="valorOriginal" sortKey={opSort.sortKey} sortDir={opSort.sortDir} onSort={opSort.toggleSort} right>Valor Original</SortableHead>
                  <SortableHead sortField="saldoAtual" sortKey={opSort.sortKey} sortDir={opSort.sortDir} onSort={opSort.toggleSort} right>Saldo Atual</SortableHead>
                  <SortableHead sortField="percentage" sortKey={opSort.sortKey} sortDir={opSort.sortDir} onSort={opSort.toggleSort} right>% do Total</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opSort.sortedRows.map((op) => (
                  <TableRow key={op.name} className="hover:bg-slate-50">
                    <TableCell className="text-sm font-medium text-slate-700">{op.name}</TableCell>
                    <TableCell className="text-xs text-right">{op.contracts}</TableCell>
                    <TableCell className="text-sm text-right">{formatCurrency(op.valorOriginal)}</TableCell>
                    <TableCell className="text-sm text-right text-blue-600 font-semibold">
                      {formatCurrency(op.saldoAtual)}
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      <Badge variant="outline">{op.percentage.toFixed(1)}%</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}