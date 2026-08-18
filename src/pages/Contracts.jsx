import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileText, Edit, Clock, CheckCircle, RotateCcw } from "lucide-react";
import ContractsList from "../components/loan/ContractsList";
import AmortizationTable from "../components/loan/AmortizationTable";
import ScheduleChart from "../components/loan/ScheduleChart";
import ContractWorkflow from "../components/loan/ContractWorkflow";
import ContractSummary from "../components/loan/ContractSummary";
import { createPageUrl } from "../utils";
import { statusLabel } from "../lib/contractStatus";
import { toBRDecimalString } from "../lib/brNumber";
import { computeContractCET } from "../lib/cetFromSchedule";

export default function Contracts() {
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [bankFilter, setBankFilter] = useState("all");
  // Controla o painel lateral com o PDF do contrato (conferência lado a
  // lado no modo de revisão). Começa aberto automaticamente sempre que um
  // contrato com PDF anexado é selecionado.
  const [showPdf, setShowPdf] = useState(false);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    setShowPdf(!!selected?.contract?.contract_pdf_url);
  }, [selected?.contract?.id]);

  const { data: contracts, isLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => base44.entities.LoanContract.list("-created_date", 1000),
    initialData: [],
  });

  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: banks } = useQuery({
    queryKey: ["banks"],
    queryFn: () => base44.entities.Bank.list("", 100),
    initialData: [],
  });

  // Grupo/Entidade/Moeda — necessários para resolver nomes na aba "Dados do
  // Contrato" (visão somente-leitura completa usada na revisão/aprovação).
  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("", 100),
    initialData: [],
  });

  const { data: entities } = useQuery({
    queryKey: ["entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 100),
    initialData: [],
  });

  const { data: currencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => base44.entities.Currency.list("", 100),
    initialData: [],
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.LoanContract.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setSelected(null);
    },
  });

  const statusCounts = {
    all: contracts.length,
    rascunho: contracts.filter(c => c.status === "rascunho").length,
    pendente_aprovacao: contracts.filter(c => c.status === "pendente_aprovacao").length,
    aprovado: contracts.filter(c => c.status === "aprovado").length,
    cancelado: contracts.filter(c => c.status === "cancelado").length,
  };

  const filteredContracts = contracts.filter(c => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (bankFilter !== "all" && c.bank_id !== bankFilter) return false;
    return true;
  });

  const handleView = (contract) => {
    const scheduleData = contract.schedule_data ? JSON.parse(contract.schedule_data) : {};
    const schedule = scheduleData.schedule || scheduleData || [];
    // O CET e a Taxa Nominal não ficam salvos em schedule_data (só o
    // cronograma é persistido) — por isso são recalculados aqui a partir do
    // próprio contrato + cronograma já salvos, sem precisar rodar o motor
    // de cálculo completo. Ver src/lib/cetFromSchedule.js.
    const { cet, fixedRateNominal } = computeContractCET(contract, schedule);
    setSelected({
      contract,
      result: {
        principal: contract.operation_value - (contract.signal_value || 0)
          + (contract.iof_financed ? (contract.iof_value || 0) : 0)
          + (contract.encargo_garantia_financed ? (contract.encargo_garantia_value || 0) : 0)
          + (contract.other_fees_financed ? (contract.other_fees || 0) : 0),
        schedule,
        totalJuros: schedule.reduce((s, r) => s + (r.jurosFixosMes || 0) + (r.jurosVariaveisMes || 0), 0),
        totalPrestacao: schedule.reduce((s, r) => s + (r.prestacao || 0), 0),
        cet,
        fixedRateNominal,
      },
    });
  };

  const handleEdit = (contract) => {
    window.location.href = createPageUrl("Simulator") + "?edit=" + contract.id;
  };

  const handleDuplicate = (contract) => {
    // ⚠️ Os campos abaixo alimentam diretamente o `initialData` do
    // <ContractForm>, cujo parser no submit assume formato BR (vírgula
    // decimal). Números "crus" do banco (ponto decimal) inflariam o valor
    // em 10x-1000x ou quebrariam o cálculo — mesmo bug corrigido no fluxo
    // de reabrir/editar um contrato (ver Simulator.jsx/loadContractForEdit).
    const contractData = encodeURIComponent(JSON.stringify({
      group_id: contract.group_id,
      entity_id: contract.entity_id,
      bank_id: contract.bank_id,
      currency_id: contract.currency_id,
      contract_number: "",
      operation_type: contract.operation_type,
      guarantee_real_type: contract.guarantee_real_type || "",
      guarantee_personal_type: contract.guarantee_personal_type || "",
      operation_value: contract.operation_value,
      signal_value: toBRDecimalString(contract.signal_value ?? 0),
      iof_value: toBRDecimalString(contract.iof_value ?? 0),
      iof_financed: contract.iof_financed,
      encargo_garantia_value: toBRDecimalString(contract.encargo_garantia_value ?? 0),
      encargo_garantia_financed: contract.encargo_garantia_financed,
      other_fees: toBRDecimalString(contract.other_fees ?? 0),
      other_fees_financed: contract.other_fees_financed,
      fixed_rate: toBRDecimalString(contract.fixed_rate),
      indexer: contract.indexer,
      indexer_spread: toBRDecimalString(contract.indexer_spread ?? 0),
      operation_date: contract.operation_date,
      first_payment_date: contract.first_payment_date,
      principal_grace_months: contract.principal_grace_months,
      interest_grace_months: contract.interest_grace_months,
      grace_action: contract.grace_action,
      principal_installments: contract.principal_installments,
      interest_installments: contract.interest_installments,
      principal_frequency: contract.principal_frequency,
      interest_frequency: contract.interest_frequency,
      calculation_system: contract.calculation_system,
    }));
    window.location.href = createPageUrl("Simulator") + "?reopen=" + contractData;
  };

  if (selected) {
    const bankName = banks.find(b => b.id === selected.contract.bank_id)?.bank_name || "N/A";
    const hasPdf = !!selected.contract.contract_pdf_url;
    const pdfVisible = showPdf && hasPdf;

    return (
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="gap-1.5 text-xs">
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </Button>
          {hasPdf && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPdf((v) => !v)}
              className="gap-1.5 text-xs"
            >
              <FileText className="w-3.5 h-3.5" />
              {pdfVisible ? "Ocultar PDF" : "Ver PDF do Contrato"}
            </Button>
          )}
        </div>

        {/* Com o PDF visível, divide a tela em duas colunas — PDF de um
            lado, dados calculados do outro — para facilitar a conferência
            lado a lado durante a revisão/aprovação. */}
        <div className={pdfVisible ? "grid grid-cols-1 xl:grid-cols-2 gap-6 items-start" : ""}>
          <div className="space-y-6 min-w-0">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-3">
                    {bankName} — {selected.contract.contract_number}
                    <Badge variant={selected.contract.status === "aprovado" ? "default" : "secondary"}>
                      {statusLabel(selected.contract.status)}
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-slate-500 mt-1">
                    {selected.contract.calculation_system} • {selected.contract.fixed_rate}% a.a.
                    {selected.contract.indexer !== "NA" ? ` + ${selected.contract.indexer}` : ""}
                  </p>
                </div>
                <ContractWorkflow
                  contract={selected.contract}
                  user={user}
                  onStatusChange={() => {
                    queryClient.invalidateQueries(["contracts"]);
                    setSelected(null);
                  }}
                  onDuplicate={() => handleDuplicate(selected.contract)}
                />
              </CardHeader>
              {selected.contract.status === "cancelado" && selected.contract.rejection_comments && (
                <CardContent className="pt-0">
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <span className="font-semibold">Motivo da devolução: </span>
                    {selected.contract.rejection_comments}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* "Dados do Contrato" vem como aba padrão: no modo de revisão,
                o aprovador precisa ver tudo que foi cadastrado
                (Identificação, valores, taxas, prazos) antes de checar a
                memória de cálculo — sem precisar clicar em "Editar" só para
                conferir. É somente leitura; a edição continua isolada no
                botão "Editar" (Simulador). */}
            <Tabs defaultValue="dados">
              <TabsList className="bg-slate-100">
                <TabsTrigger value="dados" className="text-xs">Dados do Contrato</TabsTrigger>
                <TabsTrigger value="tabela" className="text-xs">Memória de Cálculo</TabsTrigger>
                <TabsTrigger value="graficos" className="text-xs">Gráficos</TabsTrigger>
              </TabsList>
              <TabsContent value="dados" className="mt-4">
                <ContractSummary
                  contract={selected.contract}
                  groups={groups}
                  entities={entities}
                  banks={banks}
                  currencies={currencies}
                />
              </TabsContent>
              <TabsContent value="tabela" className="mt-4">
                <AmortizationTable result={selected.result} params={selected.contract} />
              </TabsContent>
              <TabsContent value="graficos" className="mt-4">
                <ScheduleChart schedule={selected.result.schedule} />
              </TabsContent>
            </Tabs>
          </div>

          {pdfVisible && (
            <div className="xl:sticky xl:top-4">
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <CardTitle className="text-sm font-semibold text-slate-800">PDF do Contrato</CardTitle>
                  <a
                    href={selected.contract.contract_pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Abrir em nova aba
                  </a>
                </CardHeader>
                <CardContent className="p-0">
                  <iframe
                    src={selected.contract.contract_pdf_url}
                    title="PDF do Contrato"
                    className="w-full border-0"
                    style={{ height: "calc(100vh - 220px)" }}
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contratos</h1>
        <p className="text-sm text-slate-500 mt-0.5">Visualize e gerencie os contratos cadastrados</p>
      </div>

      {/* Dashboard Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("all")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              <div className="text-xs text-slate-500">Total</div>
            </div>
            <div className="text-2xl font-bold mt-1">{statusCounts.all}</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("rascunho")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Edit className="w-4 h-4 text-blue-500" />
              <div className="text-xs text-slate-500">Rascunho</div>
            </div>
            <div className="text-2xl font-bold mt-1 text-blue-600">{statusCounts.rascunho}</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("pendente_aprovacao")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <div className="text-xs text-slate-500">Pendente</div>
            </div>
            <div className="text-2xl font-bold mt-1 text-amber-600">{statusCounts.pendente_aprovacao}</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("aprovado")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <div className="text-xs text-slate-500">Aprovado</div>
            </div>
            <div className="text-2xl font-bold mt-1 text-green-600">{statusCounts.aprovado}</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("cancelado")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-red-500" />
              <div className="text-xs text-slate-500">Devolvido</div>
            </div>
            <div className="text-2xl font-bold mt-1 text-red-600">{statusCounts.cancelado}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="w-48">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Filtrar por status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              <SelectItem value="rascunho">Rascunho</SelectItem>
              <SelectItem value="pendente_aprovacao">Pendente</SelectItem>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="cancelado">Devolvido para Correção</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={bankFilter} onValueChange={setBankFilter}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Filtrar por banco" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Bancos</SelectItem>
              {banks.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.bank_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ContractsList
        contracts={filteredContracts}
        banks={banks}
        onView={handleView}
        onEdit={handleEdit}
        onDelete={(id) => deleteMutation.mutate(id)}
        onDuplicate={handleDuplicate}
        isLoading={isLoading}
      />
    </div>
  );
}