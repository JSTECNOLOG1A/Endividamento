import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  Building2, Users, AlertTriangle, Activity, Shield, ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { platformApi } from "@/api/platform";
import { createPageUrl } from "@/utils";
import { LOGIN } from "@/components/auth/loginTheme";

function Stat({ label, value, tone = "default" }) {
  const colors = {
    default: "text-slate-900",
    ok: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-red-700",
  };
  return (
    <div className="rounded-xl border bg-white p-4" style={{ borderColor: LOGIN.border }}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${colors[tone]}`}>{value ?? "—"}</p>
    </div>
  );
}

export default function Platform() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    platformApi.overview()
      .then((row) => { if (!cancelled) setData(row); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  if (!user?.platform_admin) {
    return <Navigate to="/" replace />;
  }

  const t = data?.totals;

  return (
    <div className="w-full px-4 sm:px-6 py-8 max-w-[1200px]" data-tour="platform-overview">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#155EEF]">
            Administração da plataforma · PLATFORM MASTER
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">Visão geral</h1>
          <p className="text-sm text-slate-500 mt-1">
            Control plane SaaS — métricas administrativas agregadas. Sem dados operacionais dos clientes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={createPageUrl("PlatformTenants")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#155EEF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0B4DD8]"
          >
            Tenants <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to={createPageUrl("PlatformAudit")}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            style={{ borderColor: LOGIN.border }}
          >
            Auditoria
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600 mb-4">{error}</p> : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Tenants" value={t?.tenants} />
        <Stat label="Ativos" value={t?.active} tone="ok" />
        <Stat label="Trial" value={t?.trial} tone="warn" />
        <Stat label="Suspensos" value={t?.suspended} tone="bad" />
        <Stat label="Inadimplentes" value={t?.delinquent} tone="bad" />
        <Stat label="Novos (30d)" value={t?.new_30d} />
        <Stat label="Usuários ativos" value={t?.active_users} />
        <Stat label="Cancelados" value={t?.cancelled} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <section className="rounded-xl border bg-white p-4" style={{ borderColor: LOGIN.border }}>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-[#155EEF]" />
            <h2 className="text-sm font-semibold">Distribuição por plano</h2>
          </div>
          <ul className="space-y-2 text-sm">
            {(data?.by_plan || []).map((row) => (
              <li key={row.plan} className="flex justify-between">
                <span className="text-slate-600">{row.plan}</span>
                <span className="font-semibold tabular-nums">{row.count}</span>
              </li>
            ))}
            {!data?.by_plan?.length ? <li className="text-slate-400">Sem dados</li> : null}
          </ul>
        </section>
        <section className="rounded-xl border bg-white p-4" style={{ borderColor: LOGIN.border }}>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-[#155EEF]" />
            <h2 className="text-sm font-semibold">Uso (contratos — agregado)</h2>
          </div>
          <ul className="space-y-2 text-sm">
            {(data?.usage_top || []).map((row) => (
              <li key={row.tenant_id} className="flex justify-between gap-3">
                <span className="text-slate-600 truncate">{row.tenant_name}</span>
                <span className="font-semibold tabular-nums shrink-0">{row.contracts_used}</span>
              </li>
            ))}
            {!data?.usage_top?.length ? <li className="text-slate-400">Sem dados</li> : null}
          </ul>
          <p className="mt-3 text-[11px] text-slate-400">
            Apenas contagens. Sem nomes de credores, valores ou documentos.
          </p>
        </section>
      </div>

      <section className="rounded-xl border bg-white p-4" style={{ borderColor: LOGIN.border }}>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-[#155EEF]" />
          <h2 className="text-sm font-semibold">Últimos eventos administrativos</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
                <th className="py-2 pr-3">Quando</th>
                <th className="py-2 pr-3">Ação</th>
                <th className="py-2 pr-3">Ator</th>
                <th className="py-2">Tenant</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent_events || []).map((ev) => (
                <tr key={ev.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                    {new Date(ev.created_date).toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-3 font-medium">{ev.action}</td>
                  <td className="py-2 pr-3">{ev.actor_email}</td>
                  <td className="py-2">{ev.tenant_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.commercial?.note ? (
          <p className="mt-3 text-xs text-slate-500 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {data.commercial.note}
          </p>
        ) : null}
      </section>

      <p className="mt-6 text-xs text-slate-400 flex items-center gap-1">
        <Users className="w-3.5 h-3.5" />
        Acesso a dados operacionais exige sessão de suporte auditada.
      </p>
    </div>
  );
}
