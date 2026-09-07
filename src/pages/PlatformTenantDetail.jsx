import React, { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { platformApi } from "@/api/platform";
import { createPageUrl } from "@/utils";
import { LOGIN } from "@/components/auth/loginTheme";
import SupportAccessModal from "@/components/platform/SupportAccessModal";
import StepUpModal from "@/components/platform/StepUpModal";

export default function PlatformTenantDetail() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const id = params.get("id");
  const [tab, setTab] = useState("overview");
  const [tenant, setTenant] = useState(null);
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [stepUp, setStepUp] = useState(null);

  const load = async () => {
    if (!id) return;
    setError(null);
    try {
      const [t, u, a] = await Promise.all([
        platformApi.getTenant(id),
        platformApi.listTenantUsers(id),
        platformApi.tenantAudit(id, { limit: 30 }),
      ]);
      setTenant(t);
      setUsers(u);
      setAudit(a.items || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  if (!user?.platform_admin) return <Navigate to="/" replace />;
  if (!id) return <Navigate to={createPageUrl("PlatformTenants")} replace />;

  return (
    <div className="w-full px-4 sm:px-6 py-8 max-w-[1000px]">
      <Link to={createPageUrl("PlatformTenants")} className="text-sm text-[#155EEF] hover:underline">← Tenants</Link>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {tenant ? (
        <>
          <div className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#155EEF]">Control plane</p>
              <h1 className="text-2xl font-bold text-slate-900">{tenant.tenant_name}</h1>
              <p className="text-sm text-slate-500">{tenant.legal_name} · {tenant.lifecycle_status} · {tenant.plan}</p>
            </div>
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              className="rounded-lg bg-[#155EEF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0B4DD8]"
            >
              Acessar para suporte
            </button>
          </div>

          <div className="flex flex-wrap gap-1 mb-4 border-b" style={{ borderColor: LOGIN.border }}>
            {[
              ["overview", "Visão geral"],
              ["users", "Usuários"],
              ["plan", "Plano"],
              ["audit", "Auditoria"],
              ["security", "Segurança"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                  tab === key ? "border-[#155EEF] text-[#155EEF]" : "border-transparent text-slate-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <dl className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                ["CNPJ", tenant.document || "—"],
                ["Domínio", tenant.domain || "—"],
                ["E-mail admin", tenant.admin_email || "—"],
                ["Responsável", tenant.responsible_name || "—"],
                ["Telefone", tenant.phone || "—"],
                ["Usuários", tenant.users_count],
                ["Contratos (uso)", `${tenant.contracts_used ?? 0} / ${tenant.contract_limit ?? "∞"}`],
                ["Trial até", tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleDateString("pt-BR") : "—"],
                ["Suspenso em", tenant.suspended_at ? new Date(tenant.suspended_at).toLocaleString("pt-BR") : "—"],
                ["Motivo suspensão", tenant.suspension_reason || "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border p-3" style={{ borderColor: LOGIN.border }}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-900 mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {tab === "users" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b">
                  <th className="py-2">Nome</th>
                  <th className="py-2">E-mail</th>
                  <th className="py-2">Papel</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Último login</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="py-2">{u.full_name || "—"}</td>
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">{u.role}</td>
                    <td className="py-2">{u.status}</td>
                    <td className="py-2 text-slate-500">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString("pt-BR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {tab === "plan" ? (
            <div className="space-y-3 text-sm">
              <p>Plano atual: <strong>{tenant.plan}</strong> · Cobrança: {tenant.billing_status}</p>
              <div className="flex flex-wrap gap-2">
                {["STARTER", "PRO", "ENTERPRISE"].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                    style={{ borderColor: LOGIN.border }}
                    onClick={() => setStepUp({
                      onSuccess: async () => {
                        setStepUp(null);
                        await platformApi.updateTenantPlan(tenant.id, { plan: p, billing_status: tenant.billing_status === "trial" ? "trial" : "active" });
                        await load();
                      },
                    })}
                  >
                    Alterar para {p}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "audit" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b">
                  <th className="py-2">Quando</th>
                  <th className="py-2">Ação</th>
                  <th className="py-2">Ator</th>
                  <th className="py-2">Finalidade</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((ev) => (
                  <tr key={ev.id} className="border-b border-slate-100">
                    <td className="py-2 whitespace-nowrap">{new Date(ev.created_date).toLocaleString("pt-BR")}</td>
                    <td className="py-2 font-medium">{ev.action}</td>
                    <td className="py-2">{ev.actor_email}</td>
                    <td className="py-2 text-slate-500">{ev.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {tab === "security" ? (
            <div className="rounded-xl border p-4 text-sm space-y-2" style={{ borderColor: LOGIN.border }}>
              <p>Data plane isolado por padrão (privacy by default).</p>
              <p>Suporte exige motivo, duração finita e step-up.</p>
              <p>Não há exclusão física de tenant nesta interface.</p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-6 text-sm text-slate-500">Carregando…</p>
      )}

      {supportOpen && tenant ? (
        <SupportAccessModal tenant={tenant} onClose={() => setSupportOpen(false)} onStarted={() => setSupportOpen(false)} />
      ) : null}
      {stepUp ? <StepUpModal onCancel={() => setStepUp(null)} onSuccess={stepUp.onSuccess} /> : null}
    </div>
  );
}
