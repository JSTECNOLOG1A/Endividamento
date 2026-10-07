import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import { parametersApi } from "@/api/parameters";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { TAX_SUPPLIERS_PARAM_KEY } from "@/lib/accountingLogicParams";
import { BRAZILIAN_STATES } from "@/lib/taxLabels";
import {
  SUPPLIER_CODE_MAX,
  SUPPLIER_STORE_SIZE,
  canEditParameters,
  draftFromValue,
  extraWarnings,
  hasAnySupplier,
  isDraftDirty,
  newStateRow,
  stateRowsWithoutUf,
  supplierCheckLabel,
  supplierScopeLabel,
  valueFromDraft,
} from "@/lib/taxSuppliers";
import TaxConfirmDialog from "@/components/tax/TaxConfirmDialog";

const QUERY_KEY = ["parameter", TAX_SUPPLIERS_PARAM_KEY];

function FieldError({ message }) {
  if (!message) return null;
  return <p className="text-xs text-rose-600">{message}</p>;
}

function codeInputClass(hasError) {
  return cn("h-9 font-mono uppercase tracking-wide", hasError && "border-rose-400 focus-visible:ring-rose-400");
}

/** Par código + loja de um fornecedor. `path` é o prefixo do campo que o servidor aponta no erro. */
function SupplierFields({ idPrefix, entry, path, errors, disabled, onChange }) {
  const supplierError = errors[`${path}.fornecedor`];
  const storeError = errors[`${path}.loja`] || errors[path];
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2 sm:max-w-xs">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-fornecedor`} className="text-xs text-slate-600">Código do fornecedor</Label>
          <Input
            id={`${idPrefix}-fornecedor`}
            className={codeInputClass(Boolean(supplierError))}
            aria-invalid={Boolean(supplierError)}
            maxLength={SUPPLIER_CODE_MAX}
            autoComplete="off"
            disabled={disabled}
            value={entry.fornecedor}
            placeholder="Ex.: UNIAO"
            onChange={(event) => onChange({ ...entry, fornecedor: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-loja`} className="text-xs text-slate-600">Loja</Label>
          <Input
            id={`${idPrefix}-loja`}
            className={codeInputClass(Boolean(storeError))}
            aria-invalid={Boolean(storeError)}
            maxLength={SUPPLIER_STORE_SIZE}
            autoComplete="off"
            disabled={disabled}
            value={entry.loja}
            placeholder="00"
            onChange={(event) => onChange({ ...entry, loja: event.target.value })}
          />
        </div>
      </div>
      <FieldError message={supplierError} />
      <FieldError message={storeError} />
    </div>
  );
}

const CHECK_STYLES = {
  encontrado: { icon: CheckCircle2, className: "text-emerald-700" },
  nao_encontrado: { icon: XCircle, className: "text-amber-800" },
  nao_conferido: { icon: HelpCircle, className: "text-slate-600" },
};

/** Resultado da conferência no Protheus feita depois de salvar. O valor já está salvo em todos os casos. */
function CheckResult({ conferencia }) {
  const suppliers = conferencia?.fornecedores || [];
  const warnings = extraWarnings(conferencia);
  if (!suppliers.length && !warnings.length) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Configuração salva. Os fornecedores não foram conferidos no cadastro do Protheus.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-800">Configuração salva. Conferência no cadastro de fornecedores do Protheus:</p>
      {suppliers.length ? (
        <ul className="space-y-2">
          {suppliers.map((item) => {
            const style = CHECK_STYLES[item.situacao] || CHECK_STYLES.nao_conferido;
            const Icon = style.icon;
            return (
              <li key={item.campo} className="text-xs">
                <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium", style.className)}>
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{supplierScopeLabel(item.campo)}:</span>
                  <span className="font-mono">{item.fornecedor} / {item.loja}</span>
                  <span>— {supplierCheckLabel(item.situacao)}</span>
                </p>
                {item.mensagem ? <p className="mt-0.5 pl-5 text-slate-600">{item.mensagem}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {warnings.length ? (
        <ul className="space-y-1">
          {warnings.map((text) => (
            <li key={text} className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SuppliersForm({ detail, canEdit }) {
  const queryClient = useQueryClient();
  const savedValue = detail.value;
  const suggestion = detail.definition?.suggestedValue?.federal || null;
  const [draft, setDraft] = useState(() => draftFromValue(savedValue));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [conferencia, setConferencia] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const dirty = isDraftDirty(draft, savedValue);
  const usedUfs = new Set(draft.porUf.map((row) => row.uf).filter(Boolean));

  const applySaved = (value) => {
    queryClient.setQueryData(QUERY_KEY, (current) => (current ? { ...current, value } : current));
    setDraft(draftFromValue(value));
  };

  const saveMutation = useMutation({
    mutationFn: (value) => parametersApi.update(TAX_SUPPLIERS_PARAM_KEY, value, "TENANT"),
    onSuccess: (result) => {
      const data = result?.data || {};
      applySaved(data.newValue);
      setConferencia(data.conferencia || null);
      if (extraWarnings(data.conferencia).length || (data.conferencia?.fornecedores || []).some((item) => item.situacao !== "encontrado")) {
        toast.warning("Fornecedores dos tributos salvos, com avisos. Confira abaixo.");
      } else {
        toast.success("Fornecedores dos tributos salvos.");
      }
    },
    onError: (error) => {
      const field = error.code === "INVALID_PARAMETER_VALUE" ? error.data?.details?.field : null;
      if (field) setErrors({ [field]: error.message });
      else setServerError(error.message);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => parametersApi.reset(TAX_SUPPLIERS_PARAM_KEY, "TENANT"),
    onSuccess: async (result) => {
      setConfirmReset(false);
      setConferencia(null);
      setErrors({});
      setServerError("");
      applySaved(result?.data?.newValue ?? { federal: null, estadual: null, por_uf: {} });
      toast.success("Configuração dos fornecedores dos tributos apagada.");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      setConfirmReset(false);
      toast.error(error.message);
    },
  });

  const busy = saveMutation.isPending || resetMutation.isPending;
  const disabled = !canEdit || busy;

  const update = (changes) => {
    setDraft((current) => ({ ...current, ...changes }));
    setErrors({});
    setServerError("");
    setConferencia(null);
  };
  const updateRow = (id, changes) => update({ porUf: draft.porUf.map((row) => (row.id === id ? { ...row, ...changes } : row)) });

  const suggestionApplied =
    suggestion &&
    draft.federal.fornecedor.trim().toUpperCase() === suggestion.fornecedor &&
    draft.federal.loja.trim().toUpperCase() === suggestion.loja;

  const handleSubmit = (event) => {
    event.preventDefault();
    const missingUf = stateRowsWithoutUf(draft);
    if (missingUf.length) {
      setErrors({ [`uf.${missingUf[0].id}`]: "Escolha a UF desta exceção ou remova a linha." });
      return;
    }
    saveMutation.mutate(valueFromDraft(draft));
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <section className="space-y-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Tributos federais (Receita Federal e PGFN)</h4>
          {suggestion ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>
                Sugestão do Protheus: <span className="font-mono font-semibold">{suggestion.fornecedor}</span> loja{" "}
                <span className="font-mono font-semibold">{suggestion.loja}</span>
              </span>
              {canEdit && !suggestionApplied ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={() => update({ federal: { fornecedor: suggestion.fornecedor, loja: suggestion.loja } })}
                >
                  Usar sugestão
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <SupplierFields
          idPrefix="tax-supplier-federal"
          entry={draft.federal}
          path="federal"
          errors={errors}
          disabled={disabled}
          onChange={(federal) => update({ federal })}
        />
      </section>

      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Tributos estaduais — padrão</h4>
          <p className="text-xs text-slate-500">Usado para todos os estados, menos os que tiverem exceção abaixo.</p>
        </div>
        <SupplierFields
          idPrefix="tax-supplier-estadual"
          entry={draft.estadual}
          path="estadual"
          errors={errors}
          disabled={disabled}
          onChange={(estadual) => update({ estadual })}
        />
      </section>

      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Exceções por estado</h4>
          <p className="text-xs text-slate-500">Só se algum estado tiver um fornecedor próprio no Protheus.</p>
        </div>
        {draft.porUf.length === 0 ? (
          <p className="text-xs text-slate-400">Nenhuma exceção.</p>
        ) : (
          <ul className="space-y-3">
            {draft.porUf.map((row) => {
              const path = row.uf ? `por_uf.${row.uf}` : null;
              const supplierError = path ? errors[`${path}.fornecedor`] : null;
              const storeError = path ? errors[`${path}.loja`] || errors[path] : null;
              const ufError = errors[`uf.${row.id}`];
              return (
                <li key={row.id} className="space-y-1">
                  <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem_2.25rem] items-end gap-2 sm:max-w-md">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">UF</Label>
                      <Select value={row.uf || undefined} disabled={disabled} onValueChange={(uf) => updateRow(row.id, { uf })}>
                        <SelectTrigger
                          className={cn("h-9 px-2", ufError && "border-rose-400")}
                          aria-label="Estado da exceção"
                          aria-invalid={Boolean(ufError)}
                        >
                          <SelectValue placeholder="UF" />
                        </SelectTrigger>
                        <SelectContent>
                          {BRAZILIAN_STATES.filter((uf) => uf === row.uf || !usedUfs.has(uf)).map((uf) => (
                            <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`tax-supplier-${row.id}-fornecedor`} className="text-xs text-slate-600">Fornecedor</Label>
                      <Input
                        id={`tax-supplier-${row.id}-fornecedor`}
                        className={codeInputClass(Boolean(supplierError))}
                        aria-invalid={Boolean(supplierError)}
                        maxLength={SUPPLIER_CODE_MAX}
                        autoComplete="off"
                        disabled={disabled}
                        value={row.fornecedor}
                        onChange={(event) => updateRow(row.id, { fornecedor: event.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`tax-supplier-${row.id}-loja`} className="text-xs text-slate-600">Loja</Label>
                      <Input
                        id={`tax-supplier-${row.id}-loja`}
                        className={codeInputClass(Boolean(storeError))}
                        aria-invalid={Boolean(storeError)}
                        maxLength={SUPPLIER_STORE_SIZE}
                        autoComplete="off"
                        disabled={disabled}
                        value={row.loja}
                        onChange={(event) => updateRow(row.id, { loja: event.target.value })}
                      />
                    </div>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-rose-600 hover:text-rose-700"
                        title="Remover exceção"
                        aria-label={`Remover exceção${row.uf ? ` de ${row.uf}` : ""}`}
                        disabled={busy}
                        onClick={() => update({ porUf: draft.porUf.filter((item) => item.id !== row.id) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : <span />}
                  </div>
                  <FieldError message={ufError} />
                  <FieldError message={supplierError} />
                  <FieldError message={storeError} />
                </li>
              );
            })}
          </ul>
        )}
        <FieldError message={errors.por_uf} />
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy || usedUfs.size >= BRAZILIAN_STATES.length}
            onClick={() => update({ porUf: [...draft.porUf, newStateRow()] })}
          >
            <Plus className="h-4 w-4" />
            Adicionar exceção
          </Button>
        ) : null}
      </section>

      {serverError ? (
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{serverError}</p>
      ) : null}
      {conferencia && !dirty ? <CheckResult conferencia={conferencia} /> : null}

      {canEdit ? (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
          <Button type="submit" size="sm" disabled={busy || !dirty}>
            {saveMutation.isPending ? "Salvando e conferindo no Protheus…" : "Salvar"}
          </Button>
          {dirty ? <span className="text-xs text-amber-700">Alterações não salvas.</span> : null}
          {hasAnySupplier(savedValue) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-rose-600 hover:text-rose-700 sm:ml-auto"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
            >
              Apagar configuração
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Somente administradores podem alterar esta configuração.</p>
      )}

      <TaxConfirmDialog
        open={confirmReset}
        title="Apagar os fornecedores dos tributos?"
        description="Sem esta configuração, os títulos de tributo não poderão ser enviados ao Protheus até que os fornecedores sejam informados de novo."
        confirmLabel="Apagar configuração"
        busy={resetMutation.isPending}
        busyLabel="Apagando…"
        onConfirm={() => resetMutation.mutate()}
        onCancel={() => setConfirmReset(false)}
      />
    </form>
  );
}

/** Fornecedor (credor) dos títulos de tributo no Protheus: federal, estadual padrão e exceções por UF. */
export function TaxSuppliersCard() {
  const { user } = useAuth();
  const canEdit = canEditParameters(user);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await parametersApi.get(TAX_SUPPLIERS_PARAM_KEY))?.data,
  });

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">Fornecedor dos tributos (Gestão Tributária)</CardTitle>
        <CardDescription>
          Todo título a pagar no Protheus precisa de um fornecedor. Para impostos, o Protheus usa um fornecedor que representa
          o governo — normalmente “UNIAO” para os tributos federais. Informe aqui o código e a loja que a sua empresa usa no
          Protheus; eles serão o credor dos títulos das parcelas de tributo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando…
          </p>
        ) : query.error || !query.data ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <p>Não foi possível carregar os fornecedores dos tributos. {query.error?.message}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2 h-7 bg-white text-xs" onClick={() => query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <SuppliersForm detail={query.data} canEdit={canEdit} />
        )}
      </CardContent>
    </Card>
  );
}
