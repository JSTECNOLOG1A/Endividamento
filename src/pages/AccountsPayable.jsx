import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
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
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Receipt, Tags, Upload } from "lucide-react";
import ClassifyTitleDialog from "../components/payables/ClassifyTitleDialog";

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

function StatusBadge({ status }) {
  const styles = {
    aberto: "bg-amber-100 text-amber-800 border-amber-200",
    baixado: "bg-green-100 text-green-800 border-green-200",
    cancelado: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const labels = { aberto: "Aberto", baixado: "Baixado", cancelado: "Cancelado" };
  return (
    <Badge className={`text-xs border ${styles[status] || styles.aberto}`}>
      {labels[status] || status || "—"}
    </Badge>
  );
}

function ErpBadge({ item }) {
  if (item.integrado_erp) {
    return (
      <Badge className="text-xs border bg-blue-100 text-blue-800 border-blue-200" title={item.erp_mensagem || ""}>
        Integrado
      </Badge>
    );
  }
  return (
    <Badge className="text-xs border bg-slate-100 text-slate-600 border-slate-200" title={item.erp_mensagem || ""}>
      Pendente
    </Badge>
  );
}

function supplierLabel(item) {
  const code = String(item.fornecedor || "").trim();
  const name = String(item.fornecedor_nome || "").trim();
  if (code && name) return `${code} — ${name}`;
  return name || code || "—";
}

function canSelect(item) {
  return item.status === "aberto" && !item.integrado_erp;
}

export default function AccountsPayable() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("abertos");
  const [tipoFilter, setTipoFilter] = useState("__all__");
  const [erpFilter, setErpFilter] = useState("pendentes");
  const [selectedIds, setSelectedIds] = useState([]);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyTitles, setClassifyTitles] = useState([]);
  const [busy, setBusy] = useState(false);

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
    queryKey: ["payable-titles"],
    queryFn: async () => {
      try {
        await base44.functions.invoke("syncPayableTitles", {});
      } catch {
        // A listagem segue mesmo se a sincronização de contratos já aprovados falhar.
      }
      return base44.entities.PayableTitle.list("vencimento", 20000);
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
        if (statusFilter === "abertos" && item.status !== "aberto") return false;
        if (statusFilter === "baixados" && item.status !== "baixado") return false;
        if (statusFilter === "cancelados" && item.status !== "cancelado") return false;
        if (tipoFilter !== "__all__" && String(item.tipo || "").toUpperCase() !== tipoFilter) return false;
        if (erpFilter === "pendentes" && item.integrado_erp) return false;
        if (erpFilter === "integrados" && !item.integrado_erp) return false;
        if (!term) return true;
        const haystack = [
          item.entity_name,
          item.titulo_numero,
          item.prefixo,
          item.tipo,
          item.parcela,
          item.natureza,
          item.historico,
          item.fornecedor,
          item.fornecedor_nome,
          item.filial,
          item.filial_origem,
        ].join(" ").toLowerCase();
        return haystack.includes(term);
      });
  }, [titles, entityById, search, entityFilter, statusFilter, tipoFilter, erpFilter]);

  const tipos = useMemo(
    () => [...new Set((titles || []).map((item) => String(item.tipo || "").toUpperCase()).filter(Boolean))].sort(),
    [titles]
  );

  const selectableRows = rows.filter(canSelect);
  const selectedSet = new Set(selectedIds);
  const selectedRows = rows.filter((item) => selectedSet.has(item.id));
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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["payable-titles"] });

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
      toast.error("Selecione ao menos um título para classificar");
      return;
    }
    const entityIds = new Set(list.map((item) => item.entity_id));
    if (entityIds.size > 1) {
      toast.error("Selecione títulos da mesma entidade para classificar");
      return;
    }
    setClassifyTitles(list);
    setClassifyOpen(true);
  };

  const handleClassify = async (payload) => {
    setBusy(true);
    try {
      const result = await base44.functions.invoke("classifyPayableTitles", payload);
      const updated = result?.data?.updated ?? result?.updated ?? 0;
      toast.success(`${updated} ${updated === 1 ? "título classificado" : "títulos classificados"}`);
      setClassifyOpen(false);
      setSelectedIds([]);
      refresh();
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível classificar");
    } finally {
      setBusy(false);
    }
  };

  const handleIntegrate = async (items) => {
    const list = (items?.length ? items : selectedRows).filter(canSelect);
    if (!list.length) {
      toast.error("Selecione títulos pendentes de integração");
      return;
    }
    const missing = list.filter((item) => !String(item.natureza || "").trim() || !String(item.fornecedor || "").trim());
    if (missing.length) {
      toast.error("Classifique natureza e fornecedor antes de integrar");
      return;
    }
    setBusy(true);
    try {
      const result = await base44.functions.invoke("integratePayableTitles", {
        ids: list.map((item) => item.id),
      });
      const data = result?.data || result || {};
      if (data.failed) {
        toast.error(`${data.integrated || 0} integrados, ${data.failed} com erro. ${data.results?.find((item) => !item.ok && !item.skipped)?.message || ""}`.trim());
      } else {
        toast.success(`${data.integrated || 0} ${data.integrated === 1 ? "título integrado" : "títulos integrados"} no ERP`);
      }
      setSelectedIds([]);
      refresh();
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível integrar com o ERP");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contas a pagar</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Títulos gerados na aprovação do contrato. Classifique a natureza e integre os pendentes no ERP.
          </p>
        </div>
        {rows.length > 0 && (
          <p className="text-xs text-slate-500">
            {rows.length} {rows.length === 1 ? "título" : "títulos"}
            <span className="mx-1.5 text-slate-300">•</span>
            Total {formatMoney(totals.valor)}
            <span className="mx-1.5 text-slate-300">•</span>
            Saldo {formatMoney(totals.saldo)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
        <div className="space-y-1 xl:col-span-1">
          <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Busca</Label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Título, entidade, fornecedor ou natureza"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Entidade</Label>
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
          <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</Label>
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
          <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Situação</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="abertos">Abertos</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="baixados">Baixados</SelectItem>
              <SelectItem value="cancelados">Cancelados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Integração ERP</Label>
          <Select value={erpFilter} onValueChange={setErpFilter}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendentes">Não integrados</SelectItem>
              <SelectItem value="integrados">Integrados</SelectItem>
              <SelectItem value="todas">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-xs font-medium text-blue-800 mr-auto">
            {selectedRows.length} {selectedRows.length === 1 ? "título selecionado" : "títulos selecionados"}
          </span>
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => openClassify(selectedRows)} disabled={busy}>
            <Tags className="w-3.5 h-3.5" />
            Classificar
          </Button>
          <Button type="button" size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700" onClick={() => handleIntegrate(selectedRows)} disabled={busy}>
            <Upload className="w-3.5 h-3.5" />
            Integrar ERP
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="border-slate-200 border-dashed">
          <CardContent className="p-12 text-center">
            <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <Receipt className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-sm text-slate-600 font-medium">
              {isFetching ? "Carregando títulos..." : "Nenhum título a pagar"}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              As parcelas entram aqui quando o contrato é aprovado.
            </p>
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
                      aria-label="Selecionar títulos não integrados"
                    />
                  </th>
                  <th className="h-10 px-3 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Entidade</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Filial</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Fil. origem</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Fornecedor</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Prefixo</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Número</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Parc.</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Tipo</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Emissão</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Vencimento</th>
                  <th className="h-10 px-2 text-right align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Valor</th>
                  <th className="h-10 px-2 text-right align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Saldo</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Natureza</th>
                  <th className="h-10 px-3 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">Histórico</th>
                  <th className="h-10 px-2 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500">ERP</th>
                  <th className="h-10 px-3 text-right align-middle text-[11px] font-medium uppercase tracking-wider text-slate-500 sticky right-0 bg-slate-50 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const selectable = canSelect(item);
                  return (
                    <tr key={item.id} className="border-b last:border-0 hover:bg-slate-50/80">
                      <td className="px-3 py-2.5 align-middle">
                        <Checkbox
                          checked={selectedSet.has(item.id)}
                          disabled={!selectable}
                          onCheckedChange={(value) => toggleOne(item.id, value === true)}
                          aria-label={`Selecionar título ${item.titulo_numero} parcela ${item.parcela}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 align-middle font-medium text-slate-800 max-w-[180px] truncate" title={item.entity_name || ""}>
                        {item.entity_name || "—"}
                      </td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-slate-700" title="Empresa (M0_CODIGO). No SE2 a filial do título é a unidade 01">
                        {item.filial || "—"}
                      </td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-slate-700" title="Filial de origem (E2_FILORIG = empresa + unidade, ex.: 0301)">
                        {item.filial_origem || "—"}
                      </td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-700 max-w-[200px] truncate" title={supplierLabel(item)}>
                        {supplierLabel(item)}
                      </td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-slate-700">{item.prefixo}</td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-slate-700 whitespace-nowrap">{item.titulo_numero}</td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-slate-700">{item.parcela}</td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-slate-700">{item.tipo}</td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-600 whitespace-nowrap">{formatDate(item.emissao)}</td>
                      <td className="px-2 py-2.5 align-middle text-xs text-slate-600 whitespace-nowrap">{formatDate(item.vencimento)}</td>
                      <td className="px-2 py-2.5 align-middle text-right text-xs tabular-nums whitespace-nowrap">{formatMoney(item.valor)}</td>
                      <td className="px-2 py-2.5 align-middle text-right text-xs tabular-nums whitespace-nowrap">{formatMoney(item.saldo)}</td>
                      <td className="px-2 py-2.5 align-middle font-mono text-xs text-slate-600">{item.natureza || "—"}</td>
                      <td className="px-3 py-2.5 align-middle text-xs text-slate-600 max-w-[220px] truncate" title={item.historico || ""}>
                        {item.historico || "—"}
                      </td>
                      <td className="px-2 py-2.5 align-middle"><ErpBadge item={item} /></td>
                      <td className="px-3 py-2.5 align-middle text-right sticky right-0 bg-white shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]">
                        <div className="flex items-center justify-end gap-2">
                          <StatusBadge status={item.status} />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-500" disabled={!selectable || busy}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openClassify([item])}>
                                <Tags className="w-3.5 h-3.5 mr-2" />
                                Classificar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleIntegrate([item])}>
                                <Upload className="w-3.5 h-3.5 mr-2" />
                                Integrar ERP
                              </DropdownMenuItem>
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
                  <td className="px-3 py-2.5 text-xs font-medium text-slate-600" colSpan={10}>
                    {rows.length} {rows.length === 1 ? "título" : "títulos"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-xs font-semibold tabular-nums whitespace-nowrap text-slate-800">
                    {formatMoney(totals.valor)}
                  </td>
                  <td className="px-2 py-2.5 text-right text-xs font-semibold tabular-nums whitespace-nowrap text-slate-800">
                    {formatMoney(totals.saldo)}
                  </td>
                  <td colSpan={3} />
                  <td className="sticky right-0 bg-slate-50" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <ClassifyTitleDialog
        open={classifyOpen}
        onOpenChange={setClassifyOpen}
        titles={classifyTitles}
        allTitles={titles || []}
        natures={natures || []}
        entities={entities || []}
        submitting={busy}
        onSubmit={handleClassify}
      />
    </div>
  );
}
