import React from "react";
import { Loader2, Mail } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PREFERENCE_KEYS } from "@/api/preferences";
import { usePreferences, useUpdatePreference } from "@/hooks/usePreferences";

const SWITCH_ID = "preferencia-alertas-tributarios";

/**
 * "Receber resumo diário por e-mail" (alertas da Gestão Tributária). O rodapé do e-mail manda a pessoa desligar
 * aqui. Só aparece para quem pode receber (`disponivel`); se a leitura falhar, diz isso em vez de esconder a opção.
 */
export default function TaxAlertsPreference() {
  const { preferences, isLoading, error, refetch } = usePreferences();
  const update = useUpdatePreference({
    successMessage: (on) => (on ? "Resumo diário por e-mail ligado" : "Resumo diário por e-mail desligado"),
  });

  if (isLoading) return null;
  if (error) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
        Não foi possível ver se você recebe o resumo diário por e-mail.{" "}
        <button type="button" className="font-medium underline" onClick={() => refetch()}>Tentar novamente</button>
      </p>
    );
  }
  const preference = preferences?.[PREFERENCE_KEYS.taxAlerts];
  if (!preference?.disponivel) return null;

  const pending = update.isPending;
  const checked = pending ? Boolean(update.variables?.value) : Boolean(preference.ligado);

  return (
    <section className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <Label htmlFor={SWITCH_ID} className="text-sm font-semibold text-slate-900">Receber resumo diário por e-mail</Label>
          <span className="flex items-center gap-2">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden="true" /> : null}
            <Switch
              id={SWITCH_ID}
              checked={checked}
              disabled={pending}
              onCheckedChange={(value) => update.mutate({ key: PREFERENCE_KEYS.taxAlerts, value })}
            />
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Um e-mail pela manhã, só nos dias em que houver algo a avisar: parcelas que vencem nos próximos 7 dias, parcelas vencidas e
          não pagas, e parcelas que vencem nesses dias ainda sem guia vinculada. Vale só para você.
        </p>
      </div>
    </section>
  );
}
