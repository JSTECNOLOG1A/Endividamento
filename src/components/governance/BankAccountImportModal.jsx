import React, { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/notify";
import { useProcessing } from "@/lib/ProcessingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const ALL = "__all__";

function rowKey(item) {
  return `${item.empresa ?? ""}::${item.bank_code ?? ""}::${item.agencia ?? ""}::${item.conta ?? ""}`;
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

function bancoLabel(item) {
  if (item.bank_name) return `${item.bank_code} — ${item.bank_name}`;
  if (item.bank_ambiguous) return `${item.bank_code || "—"} · Ambíguo`;
  if (item.bank_code) return `${item.bank_code} · Sem cadastro`;
  return "Sem banco";
}

function bankIsRegistered(item) {
  return Boolean(item.bank_id);
}

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

export default function BankAccountImportModal({ open, onOpenChange, entities = [], banks = [], onImported }) {
  const { withProcessing } = useProcessing();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState("");
  const [empresaFilter, setEmpresaFilter] = useState(ALL);
  const [vinculoFilter, setVinculoFilter] = useState("todas");
  const [bancoFilter, setBancoFilter] = useState(ALL);
  const [situacaoFilter, setSituacaoFilter] = useState("todas");
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setSearch("");
    setEmpresaFilter(ALL);
    setVinculoFilter("todas");
    setBancoFilter(ALL);
    setSituacaoFilter("todas");
    setSelectedKeys(new Set());

    base44.functions.invoke("previewBankAccounts", {})
      .then((result) => {
        if (cancelled) return;
        setPreview(result.data || result);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error.data?.error || error.message || "Não foi possível buscar as contas no ERP");
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
  const unmatchedBanks = uniqueSorted(
    items.filter((item) => !item.bank_id).map((item) => item.bank_code || "")
  ).filter(Boolean);
  const entitiesWithoutCode = (entities || []).filter((entity) => !normalizeEmpresaCode(entity.codigo_empresa));

  const empresaOptions = useMemo(() => {
    return uniqueSorted(items.map((item) => item.empresa ?? "")).map((empresa) => ({
      value: empresa || "__empty__",
      label: empresaLabel(empresa),
    }));
  }, [items]);

  const bancoOptions = useMemo(() => {
    return uniqueSorted(items.map((item) => item.bank_code ?? "")).map((code) => ({
      value: code || "__empty__",
      label: code || "—",
    }));
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (term) {
        const haystack = [
          item.entity_name,
          item.empresa,
          item.bank_name,
          item.bank_code,
          item.agencia,
          item.conta,
          item.nome,
        ].join(" ").toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (empresaFilter !== ALL) {
        const expected = empresaFilter === "__empty__" ? "" : empresaFilter;
        if ((item.empresa ?? "") !== expected) return false;
      }
      if (vinculoFilter === "vinculadas" && !item.entity_id) return false;
      if (vinculoFilter === "sem_vinculo" && (item.entity_id || item.ambiguous)) return false;
      if (vinculoFilter === "ambiguas" && !item.ambiguous) return false;
      if (bancoFilter !== ALL) {
        const expected = bancoFilter === "__empty__" ? "" : bancoFilter;
        if ((item.bank_code ?? "") !== expected) return false;
      }
      if (situacaoFilter === "nova" && item.already_exists) return false;
      if (situacaoFilter === "cadastrada" && !item.already_exists) return false;
      return true;
    });
  }, [items, search, empresaFilter, vinculoFilter, bancoFilter, situacaoFilter]);

  const importableFiltered = useMemo(
    () => filtered.filter(bankIsRegistered),
    [filtered]
  );
  const allFilteredSelected =
    importableFiltered.length > 0 &&
    importableFiltered.every((item) => selectedKeys.has(rowKey(item)));
  const someFilteredSelected = importableFiltered.some((item) => selectedKeys.has(rowKey(item)));
  const selectedImportableCount = items.filter((item) => selectedKeys.has(rowKey(item)) && bankIsRegistered(item)).length;
  const hasActiveFilters =
    Boolean(search.trim()) ||
    empresaFilter !== ALL ||
    vinculoFilter !== "todas" ||
    bancoFilter !== ALL ||
    situacaoFilter !== "todas";

  const toggleKey = (item) => {
    if (!bankIsRegistered(item)) return;
    const key = rowKey(item);
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
        for (const item of importableFiltered) next.delete(rowKey(item));
      } else {
        for (const item of importableFiltered) next.add(rowKey(item));
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    const selected = items.filter((item) => selectedKeys.has(rowKey(item)) && bankIsRegistered(item));
    if (!selected.length) {
      toast.warning("Selecione ao menos uma conta com banco cadastrado");
      return;
    }
    const linked = selected.filter((item) => item.entity_id && item.bank_id);
    if (!linked.length) {
      toast.warning("Nenhuma conta selecionada possui entidade e banco cadastrados com o mesmo código do ERP.");
      return;
    }
    setConfirming(true);
    await withProcessing("Importando contas bancárias do ERP…", async () => {
      try {
        const result = await base44.functions.invoke("integrateBankAccounts", { items: linked });
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
        toast.error(error.data?.error || error.message || "Falha ao importar contas bancárias");
      } finally {
        setConfirming(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!confirming && !loading) onOpenChange(next); }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar contas bancárias</DialogTitle>
          <DialogDescription>
            {loading
              ? "Buscando contas em todas as empresas do grupo..."
              : `Selecione as contas de ${preview?.connection_name || "ERP"}. O A6_FILIAL é a empresa; a filial fica em branco. Só entram registros da mesma empresa da entidade e do mesmo COMPE do banco.`}
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

            {unmatchedBanks.length > 0 ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Bancos do ERP sem cadastro no FinCalc: {unmatchedBanks.join(", ")}. Cadastre o banco com o código COMPE correspondente.
              </p>
            ) : null}

            {banks.length === 0 ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Nenhum banco cadastrado. Cadastre a instituição financeira antes de importar as contas.
              </p>
            ) : null}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FilterSelect label="Empresa" value={empresaFilter} onValueChange={setEmpresaFilter}>
                <SelectItem value={ALL}>Todas</SelectItem>
                {empresaOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </FilterSelect>
              <FilterSelect label="Entidade" value={vinculoFilter} onValueChange={setVinculoFilter}>
                <SelectItem value="todas">Todos</SelectItem>
                <SelectItem value="vinculadas">Vinculadas</SelectItem>
                <SelectItem value="sem_vinculo">Sem vínculo</SelectItem>
                <SelectItem value="ambiguas">Ambíguas</SelectItem>
              </FilterSelect>
              <FilterSelect label="Banco" value={bancoFilter} onValueChange={setBancoFilter}>
                <SelectItem value={ALL}>Todos</SelectItem>
                {bancoOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
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
                placeholder="Filtrar por entidade, banco, agência, conta ou nome"
                className="h-9"
              />
              <Button type="button" variant="outline" size="sm" onClick={toggleFiltered} disabled={!importableFiltered.length}>
                {allFilteredSelected ? "Nenhum" : "Todos"}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {selectedImportableCount} de {importableFiltered.length} prontas para importar
              {filtered.length !== items.length || hasActiveFilters ? ` · ${filtered.length} visíveis` : ""}
              {filtered.length - importableFiltered.length > 0
                ? ` · ${filtered.length - importableFiltered.length} sem banco cadastrado`
                : ""}
            </p>
            <div className="border border-slate-200 rounded-lg overflow-auto max-h-[46vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        disabled={!importableFiltered.length}
                        ref={(el) => {
                          if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                        }}
                        onChange={toggleFiltered}
                      />
                    </TableHead>
                    <TableHead>Entidade</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Banco</TableHead>
                    <TableHead>Agência</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-slate-500 py-8">
                        Nenhuma conta encontrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((item) => {
                      const key = rowKey(item);
                      const canImport = Boolean(item.entity_id && item.bank_id);
                      const registered = bankIsRegistered(item);
                      return (
                        <TableRow
                          key={key}
                          className={registered ? "cursor-pointer" : "opacity-50 bg-slate-50 cursor-not-allowed"}
                          onClick={() => toggleKey(item)}
                          title={registered ? undefined : "Cadastre o banco com o código COMPE antes de importar esta conta"}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(key)}
                              disabled={!registered}
                              onChange={() => toggleKey(item)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className={item.entity_id ? "text-slate-800" : "text-amber-700"}>
                              {vinculoLabel(item)}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{empresaLabel(item.empresa)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className={item.bank_id ? "text-slate-800" : "text-amber-700"}>
                              {bancoLabel(item)}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{item.agencia}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {item.conta}{item.digito ? `-${item.digito}` : ""}
                          </TableCell>
                          <TableCell>{item.nome}</TableCell>
                          <TableCell className="text-slate-500 whitespace-nowrap">
                            {item.already_exists ? "Já cadastrada" : canImport ? "Nova" : "Sem vínculo"}
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
          <Button
            onClick={handleConfirm}
            disabled={loading || confirming || selectedImportableCount === 0}
          >
            {confirming
              ? "Importando..."
              : selectedImportableCount
                ? `Importar (${selectedImportableCount})`
                : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
