import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { base44 } from "@/api/base44Client";
import { schedulesApi } from "@/api/schedules";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eye, MoreHorizontal, Receipt, RefreshCw, Tags, Undo2, Upload } from "lucide-react";
import ClassifyTitleDialog from "../components/payables/ClassifyTitleDialog";
import TitleViewDialog from "../components/payables/TitleViewDialog";
import { erpStatusOf, ErpStatusBadge, ErpStatusLegend } from "@/lib/erpStatus";
import { useProcessing } from "@/lib/ProcessingContext";
import { useSortableRows, SortableTh } from "@/components/ui/sortable-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "—";
  const text = String(value).slice(0, 10);
  const [year, month, day] = text.split("-");
  if (!year || !month || !day) return text;
  return `${day}/${month}/${year}`;
}

function customerLabel(item) {
  const code = String(item.cliente || "").trim();
  const name = String(item.cliente_nome || "").trim();
  if (code && name) return `${code} — ${name}`;
  return name || code || "—";
}

function natureLabel(codigo, natures = []) {
  const code = String(codigo || "").trim();
  if (!code) return "—";
  const nature = natures.find((item) => item.codigo === code);
  if (nature?.descricao) return `${nature.codigo} — ${nature.descricao}`;
  return code;
}

function canIntegrate(item) {
  const status = erpStatusOf(item);
  return status !== "integrado" && status !== "baixado";
}

function canReverse(item) {
  if (erpStatusOf(item) !== "integrado") return false;
  if (item.status && item.status !== "aberto") return false;
  return Number(item.saldo) + 0.009 >= Number(item.valor);
}

function canConsult(item) {
  const status = erpStatusOf(item);
  return status === "integrado" || status === "baixado";
}

function canSelect(item) {
  return canIntegrate(item) || canReverse(item);
}

// Mesma configuração de reordenação por clique no título da tabela de
// Contratos. Checkbox e Ações ficam de fora (não fazem sentido ordenar).
const RECEIVABLE_SORT_COLUMNS = {
  erpStatus: { getValue: (row) => erpStatusOf(row) },
  entity_name: {},
  filial: {},
  filial_origem: {},
  cliente: { getValue: (row) => customerLabel(row) },
  prefixo: {},
  titulo_numero: {},
  parcela: { numeric: true, getValue: (row) => Number(row.parcela) || 0 },
  tipo: {},
  emissao: { numeric: true, getValue: (row) => (row.emissao ? new Date(row.emissao).getTime() : 0) },
  vencimento: { numeric: true, getValue: (row) => (row.vencimento ? new Date(row.vencimento).getTime() : 0) },
  valor: { numeric: true },
  saldo: { numeric: true },
  natureza: {},
  historico: {},
};

export default function AccountsReceivable() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("__all__");
  const [tipoFilter, setTipoFilter] = useState("__all__");
  const [erpFilter, setErpFilter] = useState("todas");
  const [selectedIds, setSelectedIds] = useState([]);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyTitles, setClassifyTitles] = useState([]);
  const { isProcessing: busy, withProcessing } = useProcessing();
  const [extornoItems, setExtornoItems] = useState([]);
  const [viewTitle, setViewTitle] = useState(null);
  const [viewRefreshing, setViewRefreshing] = useState(false);

  const { data: entities } = useQuery({
    queryKey: ["entities"],
    queryFn: () => base44.entities.CompanyEntity.list("entity_name", 5000),
    initialData: [],
  });

  const { data: natures } = useQuery({
    queryKey: ["natures"],
    queryFn: () => base44.entities.Nature.list("codigo", 20000),
    initialData: [],
  });

  const { data: titles, isFetching } = useQuery({
    queryKey: ["receivable-titles"],
    queryFn: async () => {
      try {
        await base44.functions.invoke("syncReceivableTitles", {});
      } catch {
        // A listagem segue mesmo se a sincronização de contratos já aprovados falhar.
      }
      return base44.entities.ReceivableTitle.list("vencimento", 20000);
    },
    initialData: [],
  });

  const entityById = useMemo(
    () => new Map((entities || []).map((entity) => [entity.id, entity])),
    [entities]
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (titles || [])
      .map((item) => ({
        ...item,
        entity_name: entityById.get(item.entity_id)?.entity_name || "",
      }))
      .filter((item) => {
        if (entityFilter !== "__all__" && item.entity_id !== entityFilter) return false;
        if (tipoFilter !== "__all__" && String(item.tipo || "").toUpperCase() !== tipoFilter) return false;
        if (erpFilter !== "todas" && erpStatusOf(item) !== erpFilter) return false;
        if (!term) return true;
        const haystack = [
          item.entity_name,
          item.titulo_numero,
          item.prefixo,
          item.tipo,
          item.parcela,
          item.natureza,
          natures.find((nature) => nature.codigo === item.natureza)?.descricao,
          item.historico,
          item.cliente,
          item.cliente_nome,
          item.filial,
          item.filial_origem,
        ].join(" ").toLowerCase();
        return haystack.includes(term);
      });
  }, [titles, natures, entityById, search, entityFilter, tipoFilter, erpFilter]);

  const tipos = useMemo(
    () => [...new Set((titles || []).map((item) => String(item.tipo || "").toUpperCase()).filter(Boolean))].sort(),
    [titles]
  );

  const selectableRows = rows.filter(canSelect);
  const selectedSet = new Set(selectedIds);
  const selectedRows = rows.filter((item) => selectedSet.has(item.id));
  const selectedToIntegrate = selectedRows.filter(canIntegrate);
  const selectedToReverse = selectedRows.filter(canReverse);
  const allSelectableChecked = selectableRows.length > 0 && selectableRows.every((item) => selectedSet.has(item.id));

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, item) => {
          acc.valor += Number(item.valor) || 0;
          acc.saldo += Number(item.saldo) || 0;
          return acc;
        },
        { valor: 0, saldo: 0 }
      ),
    [rows]
  );

  const { sortKey, sortDir, toggleSort, sortedRows } = useSortableRows(rows, RECEIVABLE_SORT_COLUMNS);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["receivable-titles"] });

  const handleConsultNow = async () => {
    await withProcessing("Consultando títulos no ERP…", async () => {
      try {
        const result = await schedulesApi.runTask("consultar_titulos_receber");
        if (result.ok) toast.success(result.message || "Títulos consultados no ERP");
        else toast.warning(result.message || "A consulta terminou com alerta");
        refresh();
      } catch (error) {
        toast.error(error.data?.error || error.message || "Não foi possível consultar os títulos");
      }
    });
  };

  useEffect(() => {
    if (!viewTitle?.id) {
      setViewRefreshing(false);
      return undefined;
    }
    const status = erpStatusOf(viewTitle);
    if (status !== "integrado" && status !== "baixado") return undefined;
    const titleId = viewTitle.id;
    let cancelled = false;
    setViewRefreshing(true);
    (async () => {
      try {
        const result = await base44.functions.invoke("refreshReceivableTitlesFromErp", {
          ids: [titleId],
          force: true,
        });
        const data = result?.data || result || {};
        const row = (data.results || []).find((item) => item.id === titleId);
        if (cancelled) return;
        if (row?.patch) {
          setViewTitle((current) => (current && current.id === titleId ? { ...current, ...row.patch } : current));
        }
        queryClient.invalidateQueries({ queryKey: ["receivable-titles"] });
      } catch {
        // A visualização segue com os dados locais se o Protheus não responder.
      } finally {
        if (!cancelled) setViewRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewTitle?.id, queryClient]);

  const handleRefreshErp = async (items) => {
    const list = (items?.length ? items : selectedRows).filter(canConsult);
    if (!list.length) {
      toast.warning("Selecione títulos já integrados para consultar no ERP");
      return;
    }
    await withProcessing(
      list.length === 1 ? "Atualizando título no ERP…" : `Atualizando ${list.length} títulos no ERP…`,
      async () => {
        try {
          const result = await base44.functions.invoke("refreshReceivableTitlesFromErp", {
            ids: list.map((item) => item.id),
            force: true,
          });
          const data = result?.data || result || {};
          if (data.unavailable) {
            toast.warning("Consulta do ERP indisponível", { description: data.message });
          } else if (data.failed) {
            const detail = data.results?.find((item) => !item.ok && !item.skipped)?.message || "";
            toast.warning("Alguns títulos não foram atualizados", {
              description: `${data.consulted || 0} atualizados · ${data.failed} com erro${detail ? ` · ${detail}` : ""}`,
            });
          } else {
            toast.success(`${data.consulted || 0} ${data.consulted === 1 ? "título atualizado" : "títulos atualizados"} do ERP`);
          }
          if (viewTitle && list.some((item) => item.id === viewTitle.id)) {
            const row = (data.results || []).find((item) => item.id === viewTitle.id);
            if (row?.patch) setViewTitle((current) => (current ? { ...current, ...row.patch } : current));
          }
          refresh();
        } catch (error) {
          toast.error(error.data?.error || error.message || "Não foi possível consultar o ERP");
        }
      }
    );
  };

  const toggleAll = (checked) => {
    if (checked) setSelectedIds(selectableRows.map((item) => item.id));
    else setSelectedIds((current) => current.filter((id) => !selectableRows.some((item) => item.id === id)));
  };

  const toggleOne = (id, checked) => {
    setSelectedIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
  };

  const openClassify = (items) => {
    const list = items?.length ? items : selectedRows;
    if (!list.length) {
      toast.warning("Selecione ao menos um título para classificar");
      return;
    }
    const entityIds = new Set(list.map((item) => item.entity_id));
    if (entityIds.size > 1) {
      toast.warning("Selecione títulos da mesma entidade para classificar");
      return;
    }
    setClassifyTitles(list);
    setClassifyOpen(true);
  };

  const handleClassify = async (payload) => {
    await withProcessing("Classificando títulos…", async () => {
      try {
        const result = await base44.functions.invoke("classifyReceivableTitles", payload);
        const updated = result?.data?.updated ?? result?.updated ?? 0;
        toast.success(`${updated} ${updated === 1 ? "título classificado" : "títulos classificados"}`);
        setClassifyOpen(false);
        setSelectedIds([]);
        refresh();
      } catch (error) {
        toast.error(error.data?.error || error.message || "Não foi possível classificar");
      }
    });
  };

  const handleIntegrate = async (items) => {
    const list = (items?.length ? items : selectedRows).filter(canIntegrate);
    if (!list.length) {
      toast.warning("Selecione títulos pendentes de integração");
      return;
    }
    const missing = list.filter((item) => !String(item.natureza || "").trim() || !String(item.cliente || "").trim());
    if (missing.length) {
      toast.warning("Classifique natureza e cliente antes de integrar");
      return;
    }
    await withProcessing(
      list.length === 1 ? "Integrando título no ERP…" : `Integrando ${list.length} títulos no ERP…`,
      async () => {
        try {
          const result = await base44.functions.invoke("integrateReceivableTitles", {
            ids: list.map((item) => item.id),
          });
          const data = result?.data || result || {};
          if (data.failed) {
            const detail = data.results?.find((item) => !item.ok && !item.skipped)?.message || "";
            toast.warning("Alguns títulos não foram para o ERP", {
              description: `${data.integrated || 0} integrados · ${data.failed} com erro${detail ? ` · ${detail}` : ""}`,
            });
          } else {
            toast.success(`${data.integrated || 0} ${data.integrated === 1 ? "título integrado" : "títulos integrados"} no ERP`);
          }
          if ((data.integrated || 0) > 0) setErpFilter("integrado");
          setSelectedIds([]);
          refresh();
        } catch (error) {
          toast.error(error.data?.error || error.message || "Não foi possível integrar com o ERP");
        }
      }
    );
  };

  const askReverse = (items) => {
    const list = (items?.length ? items : selectedRows).filter(canReverse);
    if (!list.length) {
      toast.warning("Selecione títulos já integrados para estornar");
      return;
    }
    setExtornoItems(list);
  };

  const handleReverse = async () => {
    const list = extornoItems.filter(canReverse);
    if (!list.length) {
      setExtornoItems([]);
      return;
    }
    await withProcessing(
      list.length === 1 ? "Estornando título no ERP…" : `Estornando ${list.length} títulos no ERP…`,
      async () => {
        try {
          const result = await base44.functions.invoke("reverseReceivableTitles", {
            ids: list.map((item) => item.id),
          });
          const data = result?.data || result || {};
          if (data.failed) {
            const detail = data.results?.find((item) => !item.ok && !item.skipped)?.message || "";
            toast.warning("Alguns títulos não foram estornados", {
              description: `${data.reversed || 0} estornados · ${data.failed} com erro${detail ? ` · ${detail}` : ""}`,
            });
          } else {
            toast.success(`${data.reversed || 0} ${data.reversed === 1 ? "título estornado" : "títulos estornados"} no ERP`);
          }
          if ((data.reversed || 0) > 0) setErpFilter("estornado");
          setExtornoItems([]);
          setSelectedIds([]);
          refresh();
        } catch (error) {
          toast.error(error.data?.error || error.message || "Não foi possível estornar no ERP");
        }
      }
    );
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contas a receber</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Um título por contrato, com o primeiro SD Ini BRL do cronograma. Classifique, integre, consulte e estorne no Protheus como no contas a pagar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" className="h-9 gap-1.5 border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-900" onClick={handleConsultNow} disabled={busy}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            Consultar títulos
          </Button>
          {rows.length > 0 && (
            <p className="text-xs text-slate-600">
              {rows.length} {rows.length === 1 ? "título" : "títulos"}
              <span className="mx-1.5 text-slate-300">•</span>
              Total {formatMoney(totals.valor)}
              <span className="mx-1.5 text-slate-300">•</span>
              Saldo {formatMoney(totals.saldo)}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 mb-4">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Legenda</Label>
          <div className="flex min-h-9 items-center">
            <ErpStatusLegend />
          </div>
        </div>
        <div className="space-y-1 xl:col-span-1">
          <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Busca</Label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Título, entidade, cliente ou natureza"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Entidade</Label>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              {(entities || []).map((entity) => (
                <SelectItem key={entity.id} value={entity.id}>{entity.entity_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Tipo</Label>
          <Select value={tipoFilter} onValueChange={setTipoFilter}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {tipos.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Status ERP</Label>
          <Select value={erpFilter} onValueChange={setErpFilter}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="integrado">Integrado</SelectItem>
              <SelectItem value="falha">Falha</SelectItem>
              <SelectItem value="estornado">Estornado</SelectItem>
              <SelectItem value="baixado">Baixado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-xs font-medium text-blue-800 mr-auto">
            {selectedRows.length} {selectedRows.length === 1 ? "título selecionado" : "títulos selecionados"}
          </span>
          {selectedToIntegrate.length > 0 && (
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => openClassify(selectedToIntegrate)} disabled={busy}>
              <Tags className="w-3.5 h-3.5" />
              Classificar
            </Button>
          )}
          {selectedToIntegrate.length > 0 && (
            <Button type="button" size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700" onClick={() => handleIntegrate(selectedToIntegrate)} disabled={busy}>
              <Upload className="w-3.5 h-3.5" />
              Integrar ERP
            </Button>
          )}
          {selectedToReverse.length > 0 && (
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => askReverse(selectedToReverse)} disabled={busy}>
              <Undo2 className="w-3.5 h-3.5" />
              Estornar ERP
            </Button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="border-slate-200 border-dashed">
          <CardContent className="p-12 text-center">
            <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <Receipt className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-sm text-slate-600 font-medium">
              {isFetching
                ? "Carregando títulos..."
                : (titles || []).length > 0
                  ? "Nenhum título neste filtro"
                  : "Nenhum título a receber"}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {(titles || []).length > 0
                ? "O título integrado fica em Status ERP = Integrado. Troque o filtro para Todos para ver a lista completa."
                : "Os títulos entram aqui quando o contrato é aprovado, com o primeiro SD Ini BRL do cronograma."}
            </p>
            {(titles || []).length > 0 && erpFilter !== "todas" && (
              <Button type="button" variant="outline" className="mt-4 h-8 text-xs" onClick={() => setErpFilter("todas")}>
                Ver todos os títulos
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1580px] caption-bottom text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="h-10 w-10 px-3 text-left align-middle">
                    <Checkbox
                      checked={allSelectableChecked}
                      onCheckedChange={(value) => toggleAll(value === true)}
                      aria-label="Selecionar títulos abertos"
                    />
                  </th>
                  <SortableTh sortField="erpStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Status ERP</SortableTh>
                  <SortableTh sortField="entity_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Entidade</SortableTh>
                  <SortableTh sortField="filial" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Filial</SortableTh>
                  <SortableTh sortField="filial_origem" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Fil. origem</SortableTh>
                  <SortableTh sortField="cliente" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Cliente</SortableTh>
                  <SortableTh sortField="prefixo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Prefixo</SortableTh>
                  <SortableTh sortField="titulo_numero" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Número</SortableTh>
                  <SortableTh sortField="parcela" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Parc.</SortableTh>
                  <SortableTh sortField="tipo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Tipo</SortableTh>
                  <SortableTh sortField="emissao" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Emissão</SortableTh>
                  <SortableTh sortField="vencimento" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Vencimento</SortableTh>
                  <SortableTh sortField="valor" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right>Valor</SortableTh>
                  <SortableTh sortField="saldo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right>Saldo</SortableTh>
                  <SortableTh sortField="natureza" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Natureza (código)</SortableTh>
                  <SortableTh sortField="historico" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Histórico</SortableTh>
                  <th className="h-10 px-3 text-right align-middle text-[11px] font-medium uppercase tracking-wider text-slate-600 sticky right-0 bg-slate-50 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((item) => {
                  const selectable = canSelect(item);
                  return (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-slate-50/80 cursor-pointer"
                      onDoubleClick={() => setViewTitle(item)}
                    >
                      <td
                        className="px-3 py-2.5 align-middle"
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedSet.has(item.id)}
                          disabled={!selectable}
                          onCheckedChange={(value) => toggleOne(item.id, value === true)}
                          aria-label={`Selecionar título ${item.titulo_numero} parcela ${item.parcela}`}
                        />
                      </td>
                      <td className="px-2 py-2.5 align-middle"><ErpStatusBadge item={item} /></td>
                      <td className="px-3 py-2.5 align-middle font-medium text-slate-800 max-w-[180px] truncate" title={item.entity_name || ""}>
                        {item.entity_name || "—"}
                      </td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-700" title="Empresa do título no SE1 (E1_FILIAL / M0_CODIGO)">
                        {item.filial || "—"}
                      </td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-700" title="Filial de origem (E1_FILORIG). Pode ser diferente da unidade da sessão, ex.: 0301 ou 0104">
                        {item.filial_origem || "—"}
                      </td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-700 max-w-[200px] truncate" title={customerLabel(item)}>
                        {customerLabel(item)}
                      </td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-700">{item.prefixo}</td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-700 whitespace-nowrap">{item.titulo_numero}</td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-700">{item.parcela}</td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-700">{item.tipo}</td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-600 whitespace-nowrap">{formatDate(item.emissao)}</td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-600 whitespace-nowrap">{formatDate(item.vencimento)}</td>
                      <td className="px-2 py-2.5 align-middle text-right text-xs tabular-nums whitespace-nowrap">{formatMoney(item.valor)}</td>
                      <td className="px-2 py-2.5 align-middle text-right text-xs tabular-nums whitespace-nowrap">{formatMoney(item.saldo)}</td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-600 whitespace-nowrap" title={natureLabel(item.natureza, natures)}>
                        {natureLabel(item.natureza, natures)}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-xs text-slate-600 max-w-[220px] truncate" title={item.historico || ""}>
                        {item.historico || "—"}
                      </td>
                      <td
                        className="px-3 py-2.5 align-middle text-right sticky right-0 bg-white shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]"
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-600" disabled={busy}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setViewTitle(item)}>
                                <Eye className="w-3.5 h-3.5 mr-2" />
                                Visualizar
                              </DropdownMenuItem>
                              {canConsult(item) && (
                                <DropdownMenuItem onClick={() => handleRefreshErp([item])}>
                                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                                  Atualizar no ERP
                                </DropdownMenuItem>
                              )}
                              {canIntegrate(item) && (
                                <>
                                  <DropdownMenuItem onClick={() => openClassify([item])}>
                                    <Tags className="w-3.5 h-3.5 mr-2" />
                                    Classificar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleIntegrate([item])}>
                                    <Upload className="w-3.5 h-3.5 mr-2" />
                                    Integrar ERP
                                  </DropdownMenuItem>
                                </>
                              )}
                              {canReverse(item) && (
                                <DropdownMenuItem className="text-rose-700" onClick={() => askReverse([item])}>
                                  <Undo2 className="w-3.5 h-3.5 mr-2" />
                                  Estornar ERP
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t">
                  <td className="px-3 py-2.5 text-xs font-medium text-slate-600" colSpan={12}>
                    {rows.length} {rows.length === 1 ? "título" : "títulos"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-xs font-semibold tabular-nums whitespace-nowrap text-slate-800">
                    {formatMoney(totals.valor)}
                  </td>
                  <td className="px-2 py-2.5 text-right text-xs font-semibold tabular-nums whitespace-nowrap text-slate-800">
                    {formatMoney(totals.saldo)}
                  </td>
                  <td colSpan={2} />
                  <td className="sticky right-0 bg-slate-50" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <TitleViewDialog
        open={Boolean(viewTitle)}
        onOpenChange={(open) => { if (!open) setViewTitle(null); }}
        title={viewTitle}
        natures={natures || []}
        consulting={viewRefreshing}
      />

      <ClassifyTitleDialog
        open={classifyOpen}
        onOpenChange={setClassifyOpen}
        titles={classifyTitles}
        allTitles={titles || []}
        natures={natures || []}
        entities={entities || []}
        submitting={busy}
        onSubmit={handleClassify}
        kind="receber"
      />

      <AlertDialog open={extornoItems.length > 0} onOpenChange={(open) => { if (!open && !busy) setExtornoItems([]); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Estornar {extornoItems.length === 1 ? "título" : `${extornoItems.length} títulos`} no ERP?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O título sai do Protheus somente se ainda não tiver movimentação (baixa, bordero ou saldo diferente).
              Depois disso, volta a ficar pendente de integração neste sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                handleReverse();
              }}
            >
              Estornar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
