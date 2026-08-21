import React, { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/notify";
import { useProcessing } from "@/lib/ProcessingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { normalizeEmpresaCode } from "@/lib/empresaCode";
import { useSortableRows, SortableHead } from "@/components/ui/sortable-table";

const EMPRESA_ALL = "__all__";
const TIPO_ALL = "__all__";
const VINCULO_ALL = "todas";

function rowKey(item) {
  return `${item.empresa ?? ""}::${item.filial ?? ""}::${item.codigo}`;
}

function empresaLabel(empresa) {
  const value = String(empresa ?? "").trim();
  return value || "—";
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => value ?? ""))].sort((a, b) => {
    if (!a) return -1;
    if (!b) return 1;
    return a.localeCompare(b, "pt-BR");
  });
}

function vinculoLabel(item) {
  if (item.entity_name) return item.entity_name;
  if (item.ambiguous) return "Ambíguo";
  return "Sem vínculo";
}

// Mesma configuração de reordenação por clique no título da tabela de
// Contratos. Checkbox fica de fora (não faz sentido ordenar).
const NATURE_IMPORT_SORT_COLUMNS = {
  entidade: { getValue: (item) => vinculoLabel(item) },
  empresa: { getValue: (item) => empresaLabel(item.empresa) },
  codigo: { getValue: (item) => item.codigo || "" },
  descricao: { getValue: (item) => item.descricao || "" },
  tipo: { getValue: (item) => (item.tipo_natureza === "sintetica" ? "Sintética" : "Analítica") },
  tipoConta: { getValue: (item) => item.tipo_conta || "" },
  lcdpr: { getValue: (item) => (item.gera_lcdpr ? "Sim" : "Não") },
  situacao: { getValue: (item) => (item.already_exists ? "Já cadastrada" : "Nova") },
};

function FilterSelect({ label, value, onValueChange, children }) {
  return (
    <div className="space-y-1 min-w-0">
      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

export default function NatureImportModal({ open, onOpenChange, entities = [], onImported }) {
  const { withProcessing } = useProcessing();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState("");
  const [empresaFilter, setEmpresaFilter] = useState(EMPRESA_ALL);
  const [vinculoFilter, setVinculoFilter] = useState(VINCULO_ALL);
  const [lcdprFilter, setLcdprFilter] = useState("todas");
  const [tipoNaturezaFilter, setTipoNaturezaFilter] = useState("todas");
  const [tipoContaFilter, setTipoContaFilter] = useState(TIPO_ALL);
  const [situacaoFilter, setSituacaoFilter] = useState("todas");
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setSearch("");
    setEmpresaFilter(EMPRESA_ALL);
    setVinculoFilter(VINCULO_ALL);
    setLcdprFilter("todas");
    setTipoNaturezaFilter("todas");
    setTipoContaFilter(TIPO_ALL);
    setSituacaoFilter("todas");
    setSelectedKeys(new Set());

    base44.functions.invoke("previewNatures", {})
      .then((result) => {
        if (cancelled) return;
        setPreview(result.data || result);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error.data?.error || error.message || "Não foi possível buscar as naturezas no ERP");
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
  const unmatchedScopes = uniqueSorted(
    items.filter((item) => !item.entity_id).map((item) => empresaLabel(item.empresa))
  ).filter((value) => value && value !== "—");
  const entitiesWithoutCode = (entities || []).filter((entity) => !normalizeEmpresaCode(entity.codigo_empresa));

  const empresaOptions = useMemo(() => {
    return uniqueSorted(items.map((item) => item.empresa ?? "")).map((empresa) => ({
      value: empresa || "__empty__",
      label: empresaLabel(empresa),
    }));
  }, [items]);

  const tipoContaOptions = useMemo(() => {
    return [...new Set(items.map((item) => item.tipo_conta).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (term) {
        const empresaText = empresaLabel(item.empresa).toLowerCase();
        const entityText = String(item.entity_name || "").toLowerCase();
        const matchesSearch =
          item.codigo.toLowerCase().includes(term) ||
          item.descricao.toLowerCase().includes(term) ||
          entityText.includes(term) ||
          empresaText.includes(term) ||
          (item.empresa ?? "").toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      if (empresaFilter !== EMPRESA_ALL) {
        const expected = empresaFilter === "__empty__" ? "" : empresaFilter;
        if ((item.empresa ?? "") !== expected) return false;
      }

      if (vinculoFilter === "vinculadas" && !item.entity_id) return false;
      if (vinculoFilter === "sem_vinculo" && (item.entity_id || item.ambiguous)) return false;
      if (vinculoFilter === "ambiguas" && !item.ambiguous) return false;

      if (lcdprFilter === "sim" && !item.gera_lcdpr) return false;
      if (lcdprFilter === "nao" && item.gera_lcdpr) return false;

      if (tipoNaturezaFilter !== "todas" && item.tipo_natureza !== tipoNaturezaFilter) return false;

      if (tipoContaFilter !== TIPO_ALL && (item.tipo_conta ?? "") !== tipoContaFilter) return false;

      if (situacaoFilter === "nova" && item.already_exists) return false;
      if (situacaoFilter === "cadastrada" && !item.already_exists) return false;

      return true;
    });
  }, [items, search, empresaFilter, vinculoFilter, lcdprFilter, tipoNaturezaFilter, tipoContaFilter, situacaoFilter]);

  const { sortKey, sortDir, toggleSort, sortedRows: sortedFiltered } = useSortableRows(filtered, NATURE_IMPORT_SORT_COLUMNS);

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedKeys.has(rowKey(item)));
  const someFilteredSelected = filtered.some((item) => selectedKeys.has(rowKey(item)));
  const hasActiveFilters =
    Boolean(search.trim()) ||
    empresaFilter !== EMPRESA_ALL ||
    vinculoFilter !== VINCULO_ALL ||
    lcdprFilter !== "todas" ||
    tipoNaturezaFilter !== "todas" ||
    tipoContaFilter !== TIPO_ALL ||
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
      toast.warning("Selecione ao menos uma natureza");
      return;
    }
    const linked = selected.filter((item) => item.entity_id);
    if (!linked.length) {
      toast.warning("Nenhuma natureza selecionada possui entidade com a mesma empresa Protheus.");
      return;
    }
    setConfirming(true);
    await withProcessing("Importando naturezas do ERP…", async () => {
      try {
        const result = await base44.functions.invoke("integrateNatures", { items: linked });
        const data = result.data || result;
        const skipped = selected.length - linked.length + (data.skipped_unmatched || 0);
        toast.success(
          skipped
            ? `${data.created || 0} criadas, ${data.updated || 0} atualizadas. ${skipped} sem vínculo foram ignoradas.`
            : `${data.created || 0} criadas, ${data.updated || 0} atualizadas`
        );
        onImported?.();
        onOpenChange(false);
      } catch (error) {
        toast.error(error.data?.error || error.message || "Falha ao importar naturezas");
      } finally {
        setConfirming(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!confirming && !loading) onOpenChange(next); }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar naturezas</DialogTitle>
          <DialogDescription>
            {loading
              ? "Buscando naturezas em todas as empresas do grupo..."
              : `Selecione as naturezas de ${preview?.connection_name || "ERP"}. O código do ED_FILIAL é a empresa; a filial fica em branco. Só entram registros da mesma empresa da entidade.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-slate-500 py-8 text-center">Consultando o ERP...</p>
        ) : (
          <div className="space-y-3 min-h-0 flex-1 flex flex-col">
            {(preview?.grupo_empresas || preview?.empresas?.length || preview?.tabela) ? (
              <p className="text-xs text-slate-500">
                {[
                  preview.grupo_empresas ? `Grupo ${preview.grupo_empresas}` : null,
                  preview.empresas?.length ? `Empresas ${preview.empresas.join(", ")}` : null,
                  preview.tabela ? `Tabela ${preview.tabela}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            ) : null}

            {entitiesWithoutCode.length > 0 ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Entidades sem empresa Protheus: {entitiesWithoutCode.map((entity) => entity.entity_name).join(", ")}.
              </p>
            ) : null}

            {unmatchedScopes.length > 0 ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Empresas do ERP sem entidade no FinCalc: {unmatchedScopes.join(", ")}. Informe o M0_CODIGO no cadastro da entidade.
              </p>
            ) : null}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <FilterSelect label="Empresa" value={empresaFilter} onValueChange={setEmpresaFilter}>
                <SelectItem value={EMPRESA_ALL}>Todas</SelectItem>
                {empresaOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </FilterSelect>
              <FilterSelect label="Vínculo" value={vinculoFilter} onValueChange={setVinculoFilter}>
                <SelectItem value="todas">Todos</SelectItem>
                <SelectItem value="vinculadas">Vinculadas</SelectItem>
                <SelectItem value="sem_vinculo">Sem vínculo</SelectItem>
                <SelectItem value="ambiguas">Ambíguas</SelectItem>
              </FilterSelect>
              <FilterSelect label="LCDPR" value={lcdprFilter} onValueChange={setLcdprFilter}>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="sim">Gera LCDPR</SelectItem>
                <SelectItem value="nao">Não gera</SelectItem>
              </FilterSelect>
              <FilterSelect label="Tipo" value={tipoNaturezaFilter} onValueChange={setTipoNaturezaFilter}>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="analitica">Analítica</SelectItem>
                <SelectItem value="sintetica">Sintética</SelectItem>
              </FilterSelect>
              <FilterSelect label="Receita/Despesa" value={tipoContaFilter} onValueChange={setTipoContaFilter}>
                <SelectItem value={TIPO_ALL}>Todos</SelectItem>
                {tipoContaOptions.map((tipo) => (
                  <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                ))}
              </FilterSelect>
              <FilterSelect label="Situação" value={situacaoFilter} onValueChange={setSituacaoFilter}>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="nova">Nova</SelectItem>
                <SelectItem value="cadastrada">Já cadastrada</SelectItem>
              </FilterSelect>
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar por entidade, código, descrição ou empresa"
                className="h-9"
              />
              <Button type="button" variant="outline" size="sm" onClick={toggleFiltered} disabled={!filtered.length}>
                {allFilteredSelected ? "Nenhum" : "Todos"}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {selectedKeys.size} de {items.length} selecionadas
              {hasActiveFilters ? ` · ${filtered.length} visíveis` : ""}
            </p>
            <div className="border border-slate-200 rounded-lg overflow-auto max-h-[46vh]">
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
                    <SortableHead sortField="entidade" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Entidade</SortableHead>
                    <SortableHead sortField="empresa" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Empresa</SortableHead>
                    <SortableHead sortField="codigo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Código</SortableHead>
                    <SortableHead sortField="descricao" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Descrição</SortableHead>
                    <SortableHead sortField="tipo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Tipo</SortableHead>
                    <SortableHead sortField="tipoConta" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Receita/Despesa</SortableHead>
                    <SortableHead sortField="lcdpr" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>LCDPR</SortableHead>
                    <SortableHead sortField="situacao" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Situação</SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFiltered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-slate-500 py-8">
                        Nenhuma natureza encontrada.
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
                          <TableCell className="whitespace-nowrap">
                            <span className={item.entity_id ? "text-slate-800" : "text-amber-700"}>
                              {vinculoLabel(item)}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{empresaLabel(item.empresa)}</TableCell>
                          <TableCell className="whitespace-nowrap">{item.codigo}</TableCell>
                          <TableCell>{item.descricao}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {item.tipo_natureza === "sintetica" ? "Sintética" : "Analítica"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-500 whitespace-nowrap">{item.tipo_conta || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={item.gera_lcdpr ? "border-sky-200 bg-sky-50 text-sky-800" : ""}>
                              {item.gera_lcdpr ? "Sim" : "Não"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-500 whitespace-nowrap">
                            {item.already_exists ? "Já cadastrada" : "Nova"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming || loading}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={loading || confirming || selectedKeys.size === 0}>
            {confirming ? "Importando..." : selectedKeys.size ? `Importar (${selectedKeys.size})` : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
