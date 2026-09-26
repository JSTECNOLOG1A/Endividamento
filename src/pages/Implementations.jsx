import React, { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { usePlatform } from "@/lib/PlatformContext";
import { toast } from "@/lib/notify";
import { implementationsApi } from "@/api/implementations";
import { BRAND_CYAN, createPdfHelpers, drawFooterPages, slugify } from "@/lib/pdfBrand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, Plus, ArrowLeft, Search, ChevronDown, ChevronRight, Pencil,
  FileText, Download, Printer, CheckCircle2, AlertTriangle,
} from "lucide-react";

function formatDateBR(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

function formatDateTimeBR(isoTimestamp) {
  if (!isoTimestamp) return "—";
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

const IMPLEMENTATION_STATUS_LABELS = {
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

function implementationStatusVariant(status) {
  if (status === "concluida") return "default";
  if (status === "cancelada") return "destructive";
  return "outline";
}

const ACTIVITY_STATUS_LABELS = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  aguardando_validacao: "Aguardando validação",
  atrasada: "Atrasada",
};

function activityStatusVariant(status) {
  if (status === "concluida") return "default";
  if (status === "atrasada") return "destructive";
  if (status === "aguardando_validacao") return "secondary";
  return "outline";
}

const HISTORY_LABELS = {
  concluida: "Concluída",
  reaberta: "Reaberta",
  prazo_alterado: "Prazo alterado",
  observacao_atualizada: "Observação atualizada",
  sinalizada_revalidacao: "Sinalizada para revalidação",
};

// PDF do cronograma — reaproveita a mesma identidade visual (cabeçalho,
// cores, tipografia, rodapé) já usada na Proposta Comercial / Termo de
// Contratação, via os helpers compartilhados em src/lib/pdfBrand.js.
function buildImplementationDoc(detail, mode) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const footerH = 66;
  const contentW = pageW - margin * 2;
  const {
    addTitle, addCenteredTitle, addBoldLine, addParagraph, addFieldBlock,
    addDivider, addValueRow, addGap, drawHeaderBar, ensureSpace, getY, setY,
  } = createPdfHelpers(doc, { margin, contentW, pageW, pageH, footerH });

  const subtitle = mode === "andamento" ? "Relatório de Andamento — Implantação" : "Cronograma de Implantação";
  drawHeaderBar(subtitle);
  addCenteredTitle(`IMPLANTAÇÃO — ${(detail.tenant_name || "").toUpperCase()}`);
  setY(getY() + 8);

  addValueRow("Data de início", formatDateBR(detail.data_inicio));
  if (detail.previsao_conclusao) addValueRow("Previsão de conclusão", formatDateBR(detail.previsao_conclusao));
  addValueRow("Percentual geral", `${detail.progress.percentual}%`, { bold: true, size: 12, color: BRAND_CYAN });
  addValueRow("Status", IMPLEMENTATION_STATUS_LABELS[detail.status] || detail.status);
  addDivider();

  if (mode === "andamento") {
    addTitle("Resumo do andamento", 12);
    addValueRow("Atividades concluídas", `${detail.progress.concluidas} de ${detail.progress.total}`);
    addValueRow("Atividades atrasadas", String(detail.progress.atrasadas));
    addValueRow("Atividades pendentes", String(detail.progress.pendentes));
    addDivider();
  }

  for (const stage of detail.stages) {
    addTitle(stage.stage_name, 12.5);
    addValueRow(
      "Progresso da etapa",
      `${stage.progress.percentual}% (${stage.progress.concluidas}/${stage.progress.total})`,
      { size: 9.5 }
    );
    addGap(2);
    for (const activity of stage.activities) {
      ensureSpace(70);
      addBoldLine(`${activity.activity_code}  ${activity.activity_name}`, 10);
      const statusLabel = ACTIVITY_STATUS_LABELS[activity.display_status] || activity.display_status;
      const statusColor = mode === "andamento"
        ? (activity.display_status === "concluida" ? [22, 101, 52]
          : activity.display_status === "atrasada" ? [185, 28, 28]
            : [71, 85, 105])
        : [71, 85, 105];
      addParagraph(
        `Status: ${statusLabel}   |   Responsável: ${activity.responsavel || "—"}   |   Prazo: ${activity.prazo ? formatDateBR(activity.prazo) : "—"}   |   Concluído em: ${activity.data_conclusao ? formatDateTimeBR(activity.data_conclusao) : "—"}`,
        9,
        statusColor
      );
      if (activity.observacoes) addFieldBlock("Observações", activity.observacoes, 9);
      addGap(4);
    }
    addDivider();
  }

  drawFooterPages(doc, { margin, pageW, pageH, footerH });
  return doc;
}

function ActivityEditDialog({ activity, saving, onClose, onSave }) {
  const [responsavel, setResponsavel] = useState(activity.responsavel || "");
  const [prazo, setPrazo] = useState(activity.prazo ? String(activity.prazo).slice(0, 10) : "");
  const [observacoes, setObservacoes] = useState(activity.observacoes || "");
  const [justificativa, setJustificativa] = useState("");
  const [pendingStatus, setPendingStatus] = useState(activity.status);

  const isReopening = activity.status === "concluida" && pendingStatus !== "concluida";
  const isCompleting = activity.status !== "concluida" && pendingStatus === "concluida";

  const handleSave = () => {
    const payload = { responsavel, prazo: prazo || null, observacoes };
    if (pendingStatus !== activity.status) {
      payload.status = pendingStatus;
      if (justificativa) payload.justificativa = justificativa;
    }
    onSave(payload);
  };

  return (
    <div className="space-y-4">
      {activity.needs_revalidation && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          A configuração que originou esta conclusão automática não foi mais encontrada no sistema — revise e confirme novamente.
        </div>
      )}

      <div className="text-xs text-slate-500">
        {activity.auto_check_key
          ? "Esta atividade pode ser concluída automaticamente pelo sistema."
          : "Esta atividade só pode ser concluída manualmente."}
        {activity.completion_mode && (
          <>
            {" — "}
            {activity.completion_mode === "automatica" ? "concluída automaticamente" : "concluída manualmente"}
            {activity.completed_by ? ` por ${activity.completed_by}` : ""}
            {activity.data_conclusao ? ` em ${formatDateTimeBR(activity.data_conclusao)}` : ""}
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Responsável</Label>
          <Input className="h-8 text-sm" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Nome do responsável" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Prazo</Label>
          <Input className="h-8 text-sm" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-slate-500">Observações</Label>
        <Textarea
          className="min-h-[70px] text-sm"
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Pendências do cliente, problemas de integração, correções necessárias..."
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-slate-500">Status</Label>
        <Select value={pendingStatus} onValueChange={setPendingStatus}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nao_iniciada">Não iniciada</SelectItem>
            <SelectItem value="em_andamento">Em andamento</SelectItem>
            <SelectItem value="aguardando_validacao">Aguardando validação</SelectItem>
            <SelectItem value="concluida">Concluída</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(isReopening || isCompleting) && (
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">
            Justificativa {isReopening ? "(obrigatória para reabrir)" : "(opcional)"}
          </Label>
          <Textarea className="min-h-[60px] text-sm" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
        </div>
      )}

      {activity.history?.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Histórico</Label>
          <div className="max-h-32 overflow-y-auto text-xs text-slate-600 space-y-1.5 border border-slate-200 rounded p-2 bg-slate-50">
            {activity.history.map((h) => (
              <div key={h.id}>
                <span className="text-slate-400">{formatDateTimeBR(h.occurred_at)}</span>
                {" — "}
                <span className="font-medium">{HISTORY_LABELS[h.event_type] || h.event_type}</span>
                {h.actor ? ` (${h.actor})` : ""}
                {h.note ? `: ${h.note}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="button" disabled={saving || (isReopening && !justificativa.trim())} onClick={handleSave}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function Implementations() {
  const { isMaster } = usePlatform();
  const queryClient = useQueryClient();

  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newTenantId, setNewTenantId] = useState("");
  const [newDataInicio, setNewDataInicio] = useState(() => new Date().toISOString().slice(0, 10));
  const [newPrevisao, setNewPrevisao] = useState("");

  const [editingActivity, setEditingActivity] = useState(null);
  const [expandedStages, setExpandedStages] = useState({});
  const expandInitRef = useRef(null);

  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfMode, setPdfMode] = useState("completo");
  const docRef = useRef(null);
  const pdfIframeRef = useRef(null);

  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  const { data: list, isLoading: loadingList } = useQuery({
    queryKey: ["implementations", search, statusFilter],
    queryFn: () => implementationsApi.list({ q: search, status: statusFilter === "all" ? undefined : statusFilter }),
    enabled: isMaster,
    initialData: [],
  });

  const { data: availableTenants } = useQuery({
    queryKey: ["implementations-available-tenants"],
    queryFn: implementationsApi.availableTenants,
    enabled: isMaster && newDialogOpen,
    initialData: [],
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ["implementation-detail", selectedId],
    queryFn: () => implementationsApi.get(selectedId),
    enabled: isMaster && !!selectedId && view === "detail",
  });

  useEffect(() => {
    if (!detail || expandInitRef.current === detail.id) return;
    expandInitRef.current = detail.id;
    const initial = {};
    detail.stages.forEach((s) => { initial[s.stage_code] = s.progress.percentual < 100; });
    setExpandedStages(initial);
  }, [detail]);

  const createMutation = useMutation({
    mutationFn: (payload) => implementationsApi.create(payload),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["implementations"] });
      toast.success("Implantação criada — cronograma gerado a partir do modelo padrão.");
      setNewDialogOpen(false);
      setNewTenantId("");
      setNewPrevisao("");
      setSelectedId(created.id);
      setView("detail");
    },
    onError: (error) => toast.error(error.data?.error || error.message || "Erro ao criar implantação"),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => implementationsApi.update(selectedId, { status: "concluida" }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["implementation-detail", selectedId], updated);
      queryClient.invalidateQueries({ queryKey: ["implementations"] });
      toast.success("Implantação finalizada.");
    },
    onError: (error) => toast.error(error.data?.error || error.message || "Erro ao finalizar implantação"),
  });

  const updateActivityMutation = useMutation({
    mutationFn: ({ activityId, payload }) => implementationsApi.updateActivity(selectedId, activityId, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(["implementation-detail", selectedId], updated);
      queryClient.invalidateQueries({ queryKey: ["implementations"] });
      toast.success("Atividade atualizada.");
      setEditingActivity(null);
    },
    onError: (error) => toast.error(error.data?.error || error.message || "Erro ao atualizar atividade"),
  });

  const openDetail = (id) => {
    setSelectedId(id);
    setView("detail");
  };

  const backToList = () => {
    setView("list");
    setSelectedId(null);
    expandInitRef.current = null;
  };

  const openPdfPreview = (mode) => {
    if (!detail) return;
    const doc = buildImplementationDoc(detail, mode);
    docRef.current = doc;
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(doc.output("bloburl"));
    setPdfMode(mode);
    setPdfOpen(true);
  };

  const downloadPdf = () => {
    if (!docRef.current || !detail) return;
    docRef.current.save(`Implantacao-${slugify(detail.tenant_name)}-${pdfMode}.pdf`);
  };

  const printPdf = () => {
    pdfIframeRef.current?.contentWindow?.print();
  };

  if (!isMaster) {
    return (
      <div className="w-full px-4 sm:px-6 py-8">
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-500">
            Acesso restrito ao usuário master.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === "detail") {
    return (
      <div className="w-full px-4 sm:px-6 py-8">
        <div className="mb-6">
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para implantações
          </button>

          {loadingDetail || !detail ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando cronograma...
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{detail.tenant_name}</h1>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Início em {formatDateBR(detail.data_inicio)}
                    {detail.previsao_conclusao ? ` · Previsão de conclusão em ${formatDateBR(detail.previsao_conclusao)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={implementationStatusVariant(detail.status)}>
                    {IMPLEMENTATION_STATUS_LABELS[detail.status] || detail.status}
                  </Badge>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => openPdfPreview("completo")}>
                    <FileText className="w-3.5 h-3.5" /> Cronograma completo
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => openPdfPreview("andamento")}>
                    <FileText className="w-3.5 h-3.5" /> Relatório de andamento
                  </Button>
                  {detail.status === "em_andamento" && detail.progress.percentual === 100 && (
                    <Button type="button" size="sm" className="gap-1.5" disabled={finalizeMutation.isPending} onClick={() => finalizeMutation.mutate()}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Finalizar implantação
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Progress value={detail.progress.percentual} className="h-2 flex-1" />
                <span className="text-sm font-semibold text-slate-700 w-12 text-right">{detail.progress.percentual}%</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {detail.progress.concluidas} de {detail.progress.total} atividades concluídas
                {detail.progress.atrasadas > 0 ? ` · ${detail.progress.atrasadas} atrasada(s)` : ""}
              </div>
            </>
          )}
        </div>

        {detail && (
          <div className="space-y-4">
            {detail.stages.map((stage) => (
              <Card key={stage.stage_code}>
                <Collapsible
                  open={!!expandedStages[stage.stage_code]}
                  onOpenChange={(open) => setExpandedStages((prev) => ({ ...prev, [stage.stage_code]: open }))}
                >
                  <CollapsibleTrigger asChild>
                    <button type="button" className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left">
                      <div className="flex items-center gap-2">
                        {expandedStages[stage.stage_code] ? (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span className="font-semibold text-sm text-slate-800">{stage.stage_name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-slate-500">
                          {stage.progress.concluidas}/{stage.progress.total}
                        </span>
                        <div className="w-24 hidden sm:block">
                          <Progress value={stage.progress.percentual} className="h-1.5" />
                        </div>
                        <span className="text-xs font-medium text-slate-600 w-9 text-right">{stage.progress.percentual}%</span>
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      <div className="border-t border-slate-100">
                        {stage.activities.map((activity) => (
                          <div key={activity.id} className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
                            <div className="w-12 shrink-0 text-xs font-mono text-slate-400">{activity.activity_code}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-slate-800 truncate">{activity.activity_name}</div>
                              <div className="text-xs text-slate-500 flex flex-wrap gap-x-3">
                                {activity.responsavel && <span>Responsável: {activity.responsavel}</span>}
                                {activity.prazo && <span>Prazo: {formatDateBR(activity.prazo)}</span>}
                                {activity.data_conclusao && <span>Concluído em: {formatDateTimeBR(activity.data_conclusao)}</span>}
                              </div>
                            </div>
                            {activity.needs_revalidation && (
                              <Badge variant="destructive" className="text-[10px] whitespace-nowrap shrink-0">
                                Revalidar
                              </Badge>
                            )}
                            <Badge variant={activityStatusVariant(activity.display_status)} className="shrink-0 whitespace-nowrap">
                              {ACTIVITY_STATUS_LABELS[activity.display_status] || activity.display_status}
                            </Badge>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Editar atividade" onClick={() => setEditingActivity(activity)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={!!editingActivity} onOpenChange={(v) => { if (!v) setEditingActivity(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingActivity?.activity_code} — {editingActivity?.activity_name}</DialogTitle>
            </DialogHeader>
            {editingActivity && (
              <ActivityEditDialog
                key={editingActivity.id}
                activity={editingActivity}
                saving={updateActivityMutation.isPending}
                onClose={() => setEditingActivity(null)}
                onSave={(payload) => updateActivityMutation.mutate({ activityId: editingActivity.id, payload })}
              />
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
          <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>
                Pré-visualização — {pdfMode === "andamento" ? "Relatório de Andamento" : "Cronograma Completo"}
                {detail?.tenant_name ? ` · ${detail.tenant_name}` : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 rounded-md border border-slate-200 overflow-hidden bg-slate-100">
              {pdfUrl && (
                <iframe ref={pdfIframeRef} title="Pré-visualização do cronograma de implantação" src={pdfUrl} className="w-full h-full" />
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPdfOpen(false)}>Fechar</Button>
              <Button type="button" variant="outline" className="gap-1.5" onClick={printPdf}>
                <Printer className="w-4 h-4" />
                Imprimir
              </Button>
              <Button type="button" className="gap-1.5" onClick={downloadPdf}>
                <Download className="w-4 h-4" />
                Baixar PDF
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Implantações</h1>
          <p className="text-sm text-slate-600 mt-0.5">Acompanhe a implantação do AllDebt em cada cliente.</p>
        </div>
        <Button className="gap-1.5 shrink-0" onClick={() => setNewDialogOpen(true)}>
          <Plus className="w-4 h-4" />
          Nova implantação
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-3 pb-3">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-8 text-sm pl-8"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por cliente..."
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-sm w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as situações</SelectItem>
              <SelectItem value="em_andamento">Em andamento</SelectItem>
              <SelectItem value="concluida">Concluída</SelectItem>
              <SelectItem value="cancelada">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {loadingList ? (
            <div className="text-sm text-slate-500 py-10 text-center">Carregando...</div>
          ) : !list.length ? (
            <div className="text-sm text-slate-500 py-10 text-center">
              {search || statusFilter !== "all" ? "Nenhuma implantação encontrada." : "Nenhuma implantação criada ainda."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Previsão de conclusão</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-56">Progresso</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.tenant_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateBR(item.data_inicio)}</TableCell>
                      <TableCell className="whitespace-nowrap">{item.previsao_conclusao ? formatDateBR(item.previsao_conclusao) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={implementationStatusVariant(item.status)}>
                          {IMPLEMENTATION_STATUS_LABELS[item.status] || item.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={item.percentual} className="h-1.5 flex-1" />
                          <span className="text-xs font-medium text-slate-600 w-9 text-right">{item.percentual}%</span>
                        </div>
                        {item.atividades_atrasadas > 0 && (
                          <div className="text-[11px] text-red-600 mt-0.5">{item.atividades_atrasadas} atrasada(s)</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => openDetail(item.id)}>
                          Abrir cronograma
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova implantação</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Cliente</Label>
              {availableTenants.length ? (
                <Select value={newTenantId} onValueChange={setNewTenantId}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                  <SelectContent>
                    {availableTenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.tenant_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-xs text-slate-500 border border-slate-200 rounded px-3 py-2 bg-slate-50">
                  Todos os clientes já possuem uma implantação em andamento.
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Data de início</Label>
                <Input className="h-9 text-sm" type="date" value={newDataInicio} onChange={(e) => setNewDataInicio(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Previsão de conclusão</Label>
                <Input className="h-9 text-sm" type="date" value={newPrevisao} onChange={(e) => setNewPrevisao(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewDialogOpen(false)}>Cancelar</Button>
            <Button
              type="button"
              disabled={!newTenantId || !newDataInicio || createMutation.isPending}
              onClick={() => createMutation.mutate({ tenant_id: newTenantId, data_inicio: newDataInicio, previsao_conclusao: newPrevisao || null })}
            >
              {createMutation.isPending ? "Criando..." : "Criar implantação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
