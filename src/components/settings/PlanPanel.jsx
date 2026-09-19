import React, { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/notify";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { Button } from "@/components/ui/button";
import { billingApi, billingStatusLabel, planLabel, PLAN_OPTIONS, planMeta } from "@/api/billing";
import { platformApi } from "@/api/platform";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(String(value).slice(0, 10) + "T00:00:00");
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("pt-BR");
}

export default function PlanPanel() {
  const { user, checkAppState } = useAuth();
  const { isMaster, viewingAll, currentTenant } = usePlatform();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const canChange = Boolean(user?.platform_admin || user?.tenant_role === "OWNER");

  const load = useCallback(async () => {
    if (isMaster && viewingAll) {
      setPlan(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setPlan(await billingApi.getPlan());
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível carregar o plano");
    } finally {
      setLoading(false);
    }
  }, [isMaster, viewingAll, currentTenant?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (nextPlan, billingStatus) => {
    setSaving(nextPlan);
    try {
      const payload = { plan: nextPlan, billing_status: billingStatus };
      const saved = isMaster && currentTenant?.id
        ? await platformApi.updateTenantPlan(currentTenant.id, payload)
        : await billingApi.updatePlan(payload);
      setPlan((current) => ({ ...current, ...saved, tenant_id: saved.tenant_id || saved.id }));
      await checkAppState();
      toast.success(`Plano atualizado para ${planLabel(nextPlan)}`);
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível alterar o plano");
    } finally {
      setSaving(null);
    }
  };

  if (isMaster && viewingAll) {
    return (
      <p className="text-sm text-slate-500">
        Selecione um cliente no topo para ver e alterar o plano. Depois o gateway de pagamento substitui este atalho.
      </p>
    );
  }

  if (loading) return <p className="text-sm text-slate-500">Carregando plano...</p>;
  if (!plan) return <p className="text-sm text-slate-500">Plano indisponível.</p>;

  const limitLabel = (value) => (value == null ? "Ilimitado" : String(value));
  const meta = planMeta(plan.plan);

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Plano</span>
          <span className="font-medium text-slate-900">{planLabel(plan.plan)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Situação</span>
          <span className="font-medium text-slate-900">{billingStatusLabel(plan.billing_status)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Fim da avaliação</span>
          <span className="font-medium text-slate-900">{formatDate(plan.trial_ends_at)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Contratos / usuários</span>
          <span className="font-medium text-slate-900">
            {limitLabel(plan.contract_limit)} / {limitLabel(plan.user_limit)}
          </span>
        </div>
      </div>

      {meta ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 space-y-1.5">
          <p className="text-xs font-medium text-slate-700">{meta.tagline}</p>
          <p className="text-[11px] text-slate-500">Suporte: {meta.support}</p>
          <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
            {meta.highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-400 pt-1">
            Definição completa: docs/billing/PLANOS-ALLDEBT.md (e PDF).
          </p>
        </div>
      ) : null}

      {isMaster && canChange ? (
        <div className="flex flex-wrap gap-2">
          {PLAN_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={opt.value === "STARTER" ? "outline" : opt.value === "ENTERPRISE" ? "secondary" : "default"}
              disabled={Boolean(saving)}
              onClick={() => apply(opt.value, opt.value === "STARTER" ? "trial" : "active")}
              title={opt.tagline}
            >
              {saving === opt.value
                ? "Salvando..."
                : opt.value === "STARTER"
                  ? "Starter em avaliação"
                  : `Ativar ${opt.label}`}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Para mudar de plano, solicite ao suporte. O cliente não altera entitlement por esta tela.
        </p>
      )}
      {isMaster ? (
        <p className="text-xs text-slate-400">Atalho de suporte. Sem gateway de pagamento. O histórico fica no log de acesso master.</p>
      ) : null}
    </div>
  );
}
