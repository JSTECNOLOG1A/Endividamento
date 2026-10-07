import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { parametersApi } from "@/api/parameters";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { TAX_TITLE_PARAM_KEYS } from "@/lib/accountingLogicParams";
import { canEditParameters } from "@/lib/taxSuppliers";

const QUERY_KEY = ["parameter", "tax-title-settings"];

const FIELDS = [
  {
    field: "type",
    label: "Tipo do título",
    maxLength: 3,
    upper: true,
    help: "Tipo cadastrado no Protheus para os títulos de impostos. Até 3 letras ou números.",
  },
  {
    field: "prefix",
    label: "Prefixo do título",
    maxLength: 3,
    upper: true,
    help: "Separa os títulos de tributo dos de empréstimo no Protheus: precisa ser diferente do prefixo usado nos empréstimos — um prefixo que os empréstimos já usam não é aceito. Até 3 letras ou números.",
  },
  {
    field: "nature",
    label: "Natureza",
    maxLength: 10,
    upper: false,
    help: "Código da natureza financeira do Protheus para os impostos parcelados. Precisa estar no cadastro de naturezas da empresa do parcelamento.",
  },
];

function normalize(definition, text) {
  const value = String(text ?? "").trim();
  return definition.upper ? value.toUpperCase() : value;
}

async function loadSettings() {
  const entries = await Promise.all(
    FIELDS.map(async ({ field }) => [field, (await parametersApi.get(TAX_TITLE_PARAM_KEYS[field]))?.data || null])
  );
  return Object.fromEntries(entries);
}

function savedValue(detail) {
  return String(detail?.value ?? "");
}

function SettingsForm({ details, canEdit }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => Object.fromEntries(FIELDS.map(({ field }) => [field, savedValue(details[field])])));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const dirtyFields = FIELDS.filter((definition) => normalize(definition, draft[definition.field]) !== savedValue(details[definition.field]));
  const missing = FIELDS.filter(({ field }) => !savedValue(details[field]));
  const disabled = !canEdit || saving;

  const update = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrors({});
    setSaving(true);
    let saved = 0;
    try {
      for (const definition of dirtyFields) {
        const key = TAX_TITLE_PARAM_KEYS[definition.field];
        try {
          const result = await parametersApi.update(key, normalize(definition, draft[definition.field]), "TENANT");
          const newValue = String(result?.data?.newValue ?? "");
          queryClient.setQueryData(QUERY_KEY, (current) =>
            current ? { ...current, [definition.field]: { ...current[definition.field], value: newValue } } : current
          );
          setDraft((current) => ({ ...current, [definition.field]: newValue }));
          saved += 1;
        } catch (error) {
          // O servidor valida campo a campo: o erro é do campo apontado (details.field) ou do que estava sendo salvo.
          const pointed = FIELDS.find(({ field }) => TAX_TITLE_PARAM_KEYS[field] === error.data?.details?.field);
          setErrors({ [(pointed || definition).field]: error.message });
          if (saved) toast.warning("Parte da configuração foi salva. Corrija o campo indicado e salve de novo.");
          return;
        }
      }
      toast.success("Configuração do título de tributo salva.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {missing.length ? (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Enquanto tipo, prefixo e natureza não estiverem salvos, os títulos de tributo ficam pendentes e não vão ao Protheus.
          </span>
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {FIELDS.map((definition) => {
          const { field } = definition;
          const id = `tax-title-${field}`;
          const suggestion = String(details[field]?.definition?.suggestedValue ?? "").trim();
          const error = errors[field];
          const current = normalize(definition, draft[field]);
          return (
            <div key={field} className="min-w-0 space-y-1">
              <Label htmlFor={id} className="text-xs font-medium text-slate-600">{definition.label}</Label>
              <Input
                id={id}
                className={cn("h-9 font-mono tracking-wide placeholder:font-sans placeholder:normal-case placeholder:tracking-normal", definition.upper && "uppercase", error && "border-rose-400 focus-visible:ring-rose-400")}
                aria-invalid={Boolean(error)}
                aria-describedby={`${id}-help`}
                maxLength={definition.maxLength}
                autoComplete="off"
                disabled={disabled}
                value={draft[field]}
                placeholder="Não informado"
                onChange={(event) => update(field, event.target.value)}
              />
              {error ? <p className="text-xs text-rose-600">{error}</p> : null}
              {suggestion ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span>
                    Sugestão: <span className="font-mono font-semibold">{suggestion}</span>
                    {current !== suggestion ? <span className="text-slate-500"> (não salva)</span> : null}
                  </span>
                  {canEdit && current !== suggestion ? (
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={saving} onClick={() => update(field, suggestion)}>
                      Usar sugestão
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <p id={`${id}-help`} className="text-[11px] leading-snug text-slate-500">{definition.help}</p>
            </div>
          );
        })}
      </div>
      {canEdit ? (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
          <Button type="submit" size="sm" disabled={saving || dirtyFields.length === 0}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
          {dirtyFields.length ? <span className="text-xs text-amber-700">Alterações não salvas.</span> : null}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Somente administradores podem alterar esta configuração.</p>
      )}
    </form>
  );
}

/** Tipo, prefixo e natureza dos títulos a pagar de tributo no Protheus (vazios até o cliente informar). */
export function TaxTitleSettingsCard() {
  const { user } = useAuth();
  const canEdit = canEditParameters(user);
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: loadSettings });

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">Título de tributo no Protheus (Gestão Tributária)</CardTitle>
        <CardDescription>
          Cada parcela de tributo com guia vinculada vira um título a pagar no Protheus. Informe aqui como esse título é
          identificado no Protheus da sua empresa. As sugestões só valem depois de salvas.
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
            <p>Não foi possível carregar a configuração do título de tributo. {query.error?.message}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2 h-7 bg-white text-xs" onClick={() => query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <SettingsForm details={query.data} canEdit={canEdit} />
        )}
      </CardContent>
    </Card>
  );
}
