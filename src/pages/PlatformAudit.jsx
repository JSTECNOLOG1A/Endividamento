import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { platformApi } from "@/api/platform";
import { createPageUrl } from "@/utils";
import { LOGIN } from "@/components/auth/loginTheme";

export default function PlatformAudit() {
  const { user } = useAuth();
  const [data, setData] = useState({ items: [], total: 0 });
  const [error, setError] = useState(null);

  useEffect(() => {
    platformApi.accessLog({ limit: 100 })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (!user?.platform_admin) return <Navigate to="/" replace />;

  return (
    <div className="w-full px-4 sm:px-6 py-8 max-w-[1100px]">
      <Link to={createPageUrl("Platform")} className="text-sm text-[#155EEF] hover:underline">← Visão geral</Link>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Auditoria da plataforma</h1>
      <p className="text-sm text-slate-500 mt-1">Registros append-only. Não podem ser apagados pela interface.</p>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      <div className="mt-4 overflow-x-auto rounded-xl border bg-white" style={{ borderColor: LOGIN.border }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 border-b bg-slate-50/80">
              <th className="px-4 py-3">Quando</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Ator</th>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Finalidade</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {(data.items || []).map((ev) => (
              <tr key={ev.id} className="border-b border-slate-100">
                <td className="px-4 py-2 whitespace-nowrap">{new Date(ev.created_date).toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2 font-medium">{ev.action}</td>
                <td className="px-4 py-2">{ev.actor_email}</td>
                <td className="px-4 py-2">{ev.tenant_name || "—"}</td>
                <td className="px-4 py-2 text-slate-500">{ev.purpose}</td>
                <td className="px-4 py-2 text-slate-400 tabular-nums">{ev.ip_address || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">Total: {data.total}</p>
    </div>
  );
}
