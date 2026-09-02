import React, { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/notify";
import { useProcessing } from "@/lib/ProcessingContext";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { base44 } from "@/api/base44Client";
import { useSortableRows, SortableHead } from "@/components/ui/sortable-table";
import AccountTypeBadge from "@/components/shared/AccountTypeBadge";
import {
  SubscreenBody,
  SubscreenCancelButton,
  SubscreenDescription,
  SubscreenDialogContent,
  SubscreenFilterPanel,
  SubscreenFilterSelect,
  SubscreenFooter,
  SubscreenHeader,
  SubscreenLoading,
  SubscreenMeta,
  SubscreenPrimaryButton,
  SubscreenSearchInput,
  SubscreenSearchRow,
  SubscreenSelectionHint,
  SubscreenTableShell,
  SubscreenTitle,
} from "@/layouts/modern/ModernSubscreen";

const ALL = "__all__";

const CLASS_LABELS = {
  ativo: "Ativo",
  passivo: "Passivo",
  receita: "Receita",
  despesa: "Despesa",
  patrimonio_liquido: "Patrimônio líquido",
};

function rowKey(item) {
  return String(item.account_code || "").trim();
}

// Mesma configuração de reordenação por clique no título da tabela de
// Contratos. Checkbox fica de fora (não faz sentido ordenar).
const CHART_IMPORT_SORT_COLUMNS = {
  codigo: { getValue: (item) => item.account_code || "" },
  nome: { getValue: (item) => item.account_name || "" },
  classe: { getValue: (item) => CLASS_LABELS[item.account_class] || item.account_class || "" },
  tipo: { getValue: (item) => (item.account_type === "sintetica" ? "Sintética" : "Analítica") },
  natureza: { getValue: (item) => (item.account_nature === "credora" ? "Credora" : "Devedora") },
  situacao: { getValue: (item) => (item.already_exists ? "Já cadastrada" : "Nova") },
};

export default function ChartImportModal({ open, onOpenChange, onImported }) {
  const { withProcessing } = useProcessing();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState(ALL);
  const [tipoFilter, setTipoFilter] = useState("todas");
  const [naturezaFilter, setNaturezaFilter] = useState("todas");
  const [situacaoFilter, setSituacaoFilter] = useState("todas");
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setSearch("");
    setClassFilter(ALL);
    setTipoFilter("todas");
    setNaturezaFilter("todas");
    setSituacaoFilter("todas");
    setSelectedKeys(new Set());

    base44.functions.invoke("previewChartAccounts", {})
      .then((result) => {
        if (cancelled) return;
        setPreview(result.data || result);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error.data?.error || error.message || "Não foi possível buscar o plano de contas no ERP");
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, onOpenChange]);

  const items = preview?.items || [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (term) {
        const haystack = [item.account_code, item.account_name, CLASS_LABELS[item.account_class]].join(" ").toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (classFilter !== ALL && item.account_class !== classFilter) return false;
      if (tipoFilter !== "todas" && item.account_type !== tipoFilter) return false;
      if (naturezaFilter !== "todas" && item.account_nature !== naturezaFilter) return false;
      if (situacaoFilter === "nova" && item.already_exists) return false;
      if (situacaoFilter === "cadastrada" && !item.already_exists) return false;
      return true;
    });
  }, [items, search, classFilter, tipoFilter, naturezaFilter, situacaoFilter]);

  const { sortKey, sortDir, toggleSort, sortedRows: sortedFiltered } = useSortableRows(filtered, CHART_IMPORT_SORT_COLUMNS);

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedKeys.has(rowKey(item)));
  const someFilteredSelected = filtered.some((item) => selectedKeys.has(rowKey(item)));
  const hasActiveFilters =
    Boolean(search.trim()) ||
    classFilter !== ALL ||
    tipoFilter !== "todas" ||
    naturezaFilter !== "todas" ||
    situacaoFilter !== "todas";

  const toggleKey = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFiltered = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const item of filtered) next.delete(rowKey(item));
      } else {
        for (const item of filtered) next.add(rowKey(item));
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    const selected = items.filter((item) => selectedKeys.has(rowKey(item)));
    if (!selected.length) {
      toast.warning("Selecione ao menos uma conta");
      return;
    }
    setConfirming(true);
    await withProcessing("Importando plano de contas do ERP…", async () => {
      try {
        const result = await base44.functions.invoke("integrateChartAccounts", { items: selected });
        const data = result.data || result;
        toast.success(`${data.created || 0} criadas, ${data.updated || 0} atualizadas`);
        onImported?.();
        onOpenChange(false);
      } catch (error) {
        toast.error(error.data?.error || error.message || "Falha ao importar o plano de contas");
      } finally {
        setConfirming(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!confirming && !loading) onOpenChange(next); }}>
      <SubscreenDialogContent>
        <SubscreenHeader>
          <SubscreenTitle>Importar plano de contas</SubscreenTitle>
          <SubscreenDescription>
            {loading
              ? "Buscando o plano de contas no grupo..."
              : `Selecione as contas de ${preview?.connection_name || "ERP"}. O CT1 do grupo 01 é compartilhado: contas bloqueadas e validação de filial não entram.`}
          </SubscreenDescription>
        </SubscreenHeader>

        {loading ? (
          <SubscreenLoading>Consultando o ERP...</SubscreenLoading>
        ) : (
          <SubscreenBody>
            <SubscreenMeta>
              {[
                preview?.grupo_empresas ? `Grupo ${preview.grupo_empresas}` : null,
                preview?.empresas?.length ? `Empresas ${preview.empresas.join(", ")}` : null,
                preview?.tabela ? `Tabela ${preview.tabela}` : null,
                "Sem filtro de filial",
              ].filter(Boolean).join(" · ")}
            </SubscreenMeta>

            <SubscreenFilterPanel>
              <SubscreenFilterSelect label="Classe" value={classFilter} onValueChange={setClassFilter}>
                <SelectItem value={ALL}>Todas</SelectItem>
                {Object.entries(CLASS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SubscreenFilterSelect>
              <SubscreenFilterSelect label="Tipo" value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectItem value="todas">Todos</SelectItem>
                <SelectItem value="analitica">Analítica</SelectItem>
                <SelectItem value="sintetica">Sintética</SelectItem>
              </SubscreenFilterSelect>
              <SubscreenFilterSelect label="Natureza" value={naturezaFilter} onValueChange={setNaturezaFilter}>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="devedora">Devedora</SelectItem>
                <SelectItem value="credora">Credora</SelectItem>
              </SubscreenFilterSelect>
              <SubscreenFilterSelect label="Situação" value={situacaoFilter} onValueChange={setSituacaoFilter}>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="nova">Nova</SelectItem>
                <SelectItem value="cadastrada">Já cadastrada</SelectItem>
              </SubscreenFilterSelect>
            </SubscreenFilterPanel>

            <SubscreenSearchRow>
              <SubscreenSearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar por código ou nome"
              />
              <Button type="button" variant="outline" size="sm" onClick={toggleFiltered} disabled={!filtered.length}>
                {allFilteredSelected ? "Nenhum" : "Todos"}
              </Button>
            </SubscreenSearchRow>

            <SubscreenSelectionHint>
              {selectedKeys.size} de {items.length} selecionadas
              {hasActiveFilters ? ` · ${filtered.length} visíveis` : ""}
            </SubscreenSelectionHint>

            <SubscreenTableShell>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                        }}
                        onChange={toggleFiltered}
                      />
                    </TableHead>
                    <SortableHead sortField="codigo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Código</SortableHead>
                    <SortableHead sortField="nome" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Nome</SortableHead>
                    <SortableHead sortField="classe" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Classe</SortableHead>
                    <SortableHead sortField="tipo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Tipo</SortableHead>
                    <SortableHead sortField="natureza" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Natureza</SortableHead>
                    <SortableHead sortField="situacao" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Situação</SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFiltered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-600 py-8">
                        Nenhuma conta encontrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedFiltered.map((item) => {
                      const key = rowKey(item);
                      return (
                        <TableRow key={key} className="cursor-pointer" onClick={() => toggleKey(key)}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(key)}
                              onChange={() => toggleKey(key)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[11px]">{item.account_code}</TableCell>
                          <TableCell className="min-w-[220px]">{item.account_name}</TableCell>
                          <TableCell className="whitespace-nowrap">{CLASS_LABELS[item.account_class] || item.account_class}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <AccountTypeBadge value={item.account_type} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{item.account_nature === "credora" ? "Credora" : "Devedora"}</TableCell>
                          <TableCell className="text-slate-600 whitespace-nowrap">
                            {item.already_exists ? "Já cadastrada" : "Nova"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </SubscreenTableShell>
          </SubscreenBody>
        )}

        <SubscreenFooter>
          <SubscreenCancelButton onClick={() => onOpenChange(false)} disabled={confirming || loading}>
            Cancelar
          </SubscreenCancelButton>
          <SubscreenPrimaryButton onClick={handleConfirm} disabled={loading || confirming || selectedKeys.size === 0}>
            {confirming ? "Importando..." : selectedKeys.size ? `Importar (${selectedKeys.size})` : "Importar"}
          </SubscreenPrimaryButton>
        </SubscreenFooter>
      </SubscreenDialogContent>
    </Dialog>
  );
}
