import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createPageUrl } from "@/utils";
import { useAuth } from "@/lib/AuthContext";
import { hasModule } from "@/lib/modules";
import { PREFERENCE_KEYS } from "@/api/preferences";
import { usePreferences, useUpdatePreference } from "@/hooks/usePreferences";
import { ESTIMATE_SHORT_NOTE, installmentCount } from "@/lib/taxPlanning";

const WINDOWS = [
  ["d30", "30 dias"],
  ["d90", "90 dias"],
  ["d180", "180 dias"],
];
const SWITCH_ID = "dashboard-incluir-tributos";

// Conjunto de empresas em que os tributos foram somados (`escopo_empresas`). Com a dívida bancária bloqueada, o
// servidor soma todas as empresas, inclusive as que aguardam a implantação de saldos — e a tela diz isso.
const SCOPE_ALL_PENDING = "todas_aguardando_implantacao";

/** Um valor de tributo na janela: total (a pagar + pago), com a parte estimada e a já paga indicadas. */
function TaxWindowValue({ values, formatMoney }) {
  return (
    <>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-indigo-700 sm:text-lg">{formatMoney(values.total)}</p>
      {values.estimado ? (
        <p className="text-[10px] leading-tight text-amber-800 sm:text-[11px]" title={ESTIMATE_SHORT_NOTE}>
          {formatMoney(values.estimado)} estimado
        </p>
      ) : null}
      {values.pago ? <p className="text-[10px] leading-tight text-emerald-700 sm:text-[11px]">{formatMoney(values.pago)} já pago</p> : null}
      {values.parcelas_pagas_sem_valor ? (
        <p className="text-[10px] leading-tight text-amber-800 sm:text-[11px]">
          {installmentCount(values.parcelas_pagas_sem_valor)} paga{values.parcelas_pagas_sem_valor === 1 ? "" : "s"} sem valor, fora da soma
        </p>
      ) : null}
    </>
  );
}

function TaxOverdue({ vencidas, formatMoney }) {
  if (!vencidas.parcelas) {
    return <p className="text-xs text-slate-500">Tributos vencidos e não pagos hoje: nenhum.</p>;
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-rose-700">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Tributos vencidos e não pagos hoje: <span className="font-semibold tabular-nums">{formatMoney(vencidas.total)}</span> (
        {installmentCount(vencidas.parcelas)}
        {vencidas.estimado ? `, ${formatMoney(vencidas.estimado)} estimado` : ""}). Contados à parte, fora das janelas acima.
      </span>
    </p>
  );
}

/**
 * Vencimentos do Dashboard: a dívida bancária e, para quem tem a Gestão Tributária com a opção ligada, os tributos
 * numa linha própria. Sem o módulo, o quadro é o mesmo de sempre (sem opção e sem chamada a mais).
 * Falha na leitura dos tributos (`ok: false`) mostra o aviso no lugar, sem número.
 * `vencimentos` nulo = a dívida bancária não tem números nesta data-base (empresas aguardando a implantação de saldos):
 * o quadro mostra só os tributos, que não dependem dessa implantação — ou nada, para quem não tem o módulo.
 */
export default function DashboardMaturities({ vencimentos, taxDue, formatMoney }) {
  const { user } = useAuth();
  const canHaveTax = hasModule(user, "tax");
  const { preferences } = usePreferences({ enabled: canHaveTax });
  const update = useUpdatePreference({
    successMessage: (on) => (on ? "Tributos incluídos nos vencimentos" : "Tributos retirados dos vencimentos"),
    invalidate: [["dashboard-summary"]],
  });
  const preference = preferences?.[PREFERENCE_KEYS.dashboardTax];
  const showSwitch = Boolean(preference?.disponivel);
  const turnedOff = preference ? !preference.ligado : false;
  const showTax = Boolean(taxDue) && !turnedOff;
  // Acabou de ligar: o resumo está sendo buscado de novo e ainda não trouxe a linha dos tributos.
  const waitingTax = showSwitch && preference.ligado && !taxDue;
  const pending = update.isPending;
  const checked = pending ? Boolean(update.variables?.value) : Boolean(preference?.ligado);
  const withTaxRow = showTax || waitingTax;
  const hasBank = Boolean(vencimentos);
  if (!hasBank && !showTax && !showSwitch) return null;
  const showGrid = hasBank || (showTax && taxDue.ok);
  const title = hasBank ? "Vencimentos, a partir da data-base" : "Vencimentos dos tributos, a partir da data-base";

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
      {showSwitch ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <span className="flex items-center gap-2">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden="true" /> : null}
            <Label htmlFor={SWITCH_ID} className="text-xs font-medium text-slate-600">Incluir tributos</Label>
            <Switch
              id={SWITCH_ID}
              checked={checked}
              disabled={pending}
              onCheckedChange={(value) => update.mutate({ key: PREFERENCE_KEYS.dashboardTax, value })}
            />
          </span>
        </div>
      ) : (
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      )}
      {!hasBank && turnedOff ? (
        <p className="mt-2 text-xs text-slate-500">Ligue “Incluir tributos” para ver os vencimentos das parcelas dos parcelamentos.</p>
      ) : null}
      {showGrid ? (
        <div className="mt-2 grid grid-cols-3 divide-x divide-slate-100">
          {WINDOWS.map(([key, label]) => (
            <div key={key} className={withTaxRow ? "min-w-0 px-2 text-center first:pl-0 last:pr-0 sm:px-3" : "px-3 text-center first:pl-0"}>
              <p className="text-[11px] text-slate-500">{label}</p>
              {hasBank && withTaxRow ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Bancos</p> : null}
              {hasBank ? (
                <p className={withTaxRow ? "mt-0.5 text-sm font-bold tabular-nums text-slate-900 sm:text-lg" : "mt-0.5 text-lg font-bold tabular-nums text-slate-900"}>
                  {formatMoney(vencimentos[key])}
                </p>
              ) : null}
              {showTax && taxDue.ok ? (
                <>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Tributos</p>
                  <TaxWindowValue values={taxDue[key]} formatMoney={formatMoney} />
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {waitingTax ? (
        <p className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Carregando os vencimentos dos tributos…
        </p>
      ) : null}
      {showTax && !taxDue.ok ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {taxDue.mensagem || "Não foi possível carregar os vencimentos dos tributos agora. Os valores dos tributos não estão sendo mostrados."}
        </p>
      ) : null}
      {showTax && taxDue.ok ? (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {taxDue.escopo_empresas === SCOPE_ALL_PENDING ? (
            <p className="text-xs font-medium text-slate-700">
              Tributos de todas as empresas, inclusive as que aguardam a implantação de saldos.
            </p>
          ) : null}
          <TaxOverdue vencidas={taxDue.vencidas} formatMoney={formatMoney} />
          <p className="text-[11px] leading-snug text-slate-500">
            Tributos: parcelas dos parcelamentos ativos, separadas da dívida bancária. “Estimado” é o valor cadastrado da parcela sem guia
            vinculada; pode ficar abaixo do real, porque a correção pela Selic corre até a guia ser emitida.{" "}
            <Link to={createPageUrl("TaxPlanning")} className="inline-flex items-center gap-0.5 font-medium text-slate-700 hover:underline">
              Ver o planejamento <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
