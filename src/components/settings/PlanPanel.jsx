import React, { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/notify";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { Button } from "@/components/ui/button";
import { billingApi, billingStatusLabel, planLabel } from "@/api/billing";
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
      {canChange ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={Boolean(saving)} onClick={() => apply("STARTER", "trial")}>
            {saving === "STARTER" ? "Salvando..." : "Starter em avaliação"}
          </Button>
          <Button type="button" size="sm" disabled={Boolean(saving)} onClick={() => apply("PRO", "active")}>
            {saving === "PRO" ? "Salvando..." : "Ativar Pro"}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={Boolean(saving)} onClick={() => apply("ENTERPRISE", "active")}>
            {saving === "ENTERPRISE" ? "Salvando..." : "Ativar Enterprise"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Apenas o proprietário ou o master altera o plano.</p>
      )}
      {isMaster ? (
        <p className="text-xs text-slate-400">Atalho local sem gateway. O histórico fica no log de acesso master.</p>
      ) : null}
    </div>
  );
}
