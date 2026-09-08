import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { platformApi } from "@/api/platform";
import { createPageUrl } from "@/utils";
import { LOGIN } from "@/components/auth/loginTheme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SupportAccessModal from "@/components/platform/SupportAccessModal";
import StepUpModal from "@/components/platform/StepUpModal";
import { PLAN_OPTIONS, planMeta } from "@/api/billing";

const STATUS_LABEL = {
  PENDING: "Pendente",
  TRIAL: "Trial",
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
  DISABLED: "Desabilitado",
  CANCELLED: "Cancelado",
  DELINQUENT: "Inadimplente",
};

function StatusBadge({ status }) {
  const tone = {
    ACTIVE: "bg-emerald-50 text-emerald-800 border-emerald-200",
    TRIAL: "bg-sky-50 text-sky-800 border-sky-200",
    SUSPENDED: "bg-amber-50 text-amber-900 border-amber-200",
    DELINQUENT: "bg-red-50 text-red-800 border-red-200",
    CANCELLED: "bg-slate-100 text-slate-600 border-slate-200",
    DISABLED: "bg-slate-100 text-slate-600 border-slate-200",
    PENDING: "bg-violet-50 text-violet-800 border-violet-200",
  }[status] || "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export default function PlatformTenants() {
  const { user } = useAuth();
  const { refreshTenants } = usePlatform();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState(null);
  const [supportFor, setSupportFor] = useState(null);
  const [stepUp, setStepUp] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const data = await platformApi.listTenants({ q, status, plan });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, [status, plan]);

  if (!user?.platform_admin) return <Navigate to="/" replace />;

  const runCritical = (action) => {
    setStepUp({
      onSuccess: async () => {
        setStepUp(null);
        await action();
        await load();
        await refreshTenants();
      },
    });
  };

  return (
    <div className="w-full px-4 sm:px-6 py-8 max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#155EEF]">
            Administração da plataforma
          </p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Tenants</h1>
          <p className="text-sm text-slate-500 mt-1">Control plane — sem contratos, valores ou documentos operacionais.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#155EEF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0B4DD8]"
        >
          <Plus className="w-4 h-4" /> Novo tenant
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="h-10 w-full rounded-lg border pl-9 pr-3 text-sm"
            style={{ borderColor: LOGIN.border }}
            placeholder="Buscar nome, CNPJ, domínio…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
          />
        </div>
        <select className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: LOGIN.border }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Status</option>
          {Object.keys(STATUS_LABEL).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
        </select>
        <select className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: LOGIN.border }} value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="">Plano</option>
          <option value="STARTER">Starter</option>
          <option value="PRO">Pro</option>
          <option value="ENTERPRISE">Enterprise</option>
        </select>
        <button type="button" onClick={load} className="h-10 rounded-lg border px-3 text-sm font-medium" style={{ borderColor: LOGIN.border }}>
          Filtrar
        </button>
      </div>

      {error ? <p className="text-sm text-red-600 mb-3">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border bg-white" style={{ borderColor: LOGIN.border }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b bg-slate-50/80">
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">CNPJ</th>
              <th className="px-4 py-3">Plano</th>
              <th className="px-4 py-3">Usuários</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Criado em</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <Link to={`${createPageUrl("PlatformTenantDetail")}?id=${encodeURIComponent(row.id)}`} className="font-medium text-[#155EEF] hover:underline">
                    {row.tenant_name}
                  </Link>
                  <p className="text-xs text-slate-400 truncate max-w-[220px]">{row.legal_name}</p>
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-600">{row.document || "—"}</td>
                <td className="px-4 py-3">{row.plan}</td>
                <td className="px-4 py-3 tabular-nums">{row.users_count}</td>
                <td className="px-4 py-3"><StatusBadge status={row.lifecycle_status} /></td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {row.created_date ? new Date(row.created_date).toLocaleDateString("pt-BR") : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100">
                      <MoreHorizontal className="w-4 h-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`${createPageUrl("PlatformTenantDetail")}?id=${encodeURIComponent(row.id)}`}>Ver detalhes</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSupportFor(row)}>Acessar para suporte</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {row.lifecycle_status === "SUSPENDED" || row.lifecycle_status === "DISABLED" ? (
                        <DropdownMenuItem
                          onClick={() => runCritical(async () => {
                            await platformApi.reactivateTenant(row.id, { reason: "Reativação administrativa" });
                          })}
                        >
                          Reativar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          className="text-amber-800"
                          onClick={() => runCritical(async () => {
                            const reason = window.prompt("Motivo (INADIMPLENCIA, SOLICITACAO_CLIENTE, SEGURANCA, VIOLACAO_CONTRATUAL, MANUTENCAO_ADMINISTRATIVA, OUTRO):", "MANUTENCAO_ADMINISTRATIVA");
                            if (!reason) return;
                            const detail = reason === "OUTRO" ? window.prompt("Descreva o motivo:") : null;
                            if (reason === "OUTRO" && !detail) return;
                            await platformApi.suspendTenant(row.id, { reason, detail });
                          })}
                        >
                          Suspender
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Nenhum tenant encontrado</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {supportFor ? (
        <SupportAccessModal
          tenant={supportFor}
          onClose={() => setSupportFor(null)}
          onStarted={() => setSupportFor(null)}
        />
      ) : null}
      {stepUp ? <StepUpModal onCancel={() => setStepUp(null)} onSuccess={stepUp.onSuccess} /> : null}
      {createOpen ? (
        <CreateTenantModal
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            await load();
            await refreshTenants();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateTenantModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    legal_name: "",
    trade_name: "",
    document: "",
    admin_email: "",
    phone: "",
    responsible_name: "",
    plan: "STARTER",
    trial: true,
    trial_days: 14,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await platformApi.createTenant(form);
      setResult(created);
      await onCreated?.(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyInvite = async () => {
    if (!result?.invite_url) return;
    try {
      await navigator.clipboard.writeText(result.invite_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
        <div className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-xl space-y-4" style={{ borderColor: LOGIN.border }}>
          <h2 className="text-lg font-bold text-slate-900">Tenant criado</h2>
          <p className="text-sm text-slate-600">
            Conta de administrador preparada para <strong>{result.owner?.email || form.admin_email}</strong>.
          </p>
          {result.email_sent ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              E-mail de confirmação enviado com o link para definir a senha (válido por 7 dias).
            </p>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              SMTP não confirmou o envio. Use o link abaixo e envie ao responsável.
            </p>
          )}
          {result.invite_url ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Link para definir senha</p>
              <div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs break-all text-slate-700" style={{ borderColor: LOGIN.border }}>
                {result.invite_url}
              </div>
              <button
                type="button"
                onClick={copyInvite}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: LOGIN.border }}
              >
                {copied ? "Copiado" : "Copiar link"}
              </button>
            </div>
          ) : null}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#155EEF] px-3 py-2 text-sm font-semibold text-white"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-xl space-y-3" style={{ borderColor: LOGIN.border }}>
        <h2 className="text-lg font-bold text-slate-900">Novo tenant</h2>
        <p className="text-sm text-slate-500">
          O e-mail administrativo receberá um link para confirmar a conta e definir a senha.
        </p>
        {[
          ["legal_name", "Razão social", true],
          ["trade_name", "Nome fantasia", false],
          ["document", "CNPJ", false],
          ["admin_email", "E-mail administrativo", true],
          ["responsible_name", "Responsável", false],
          ["phone", "Telefone", false],
        ].map(([key, label, required]) => (
          <label key={key} className="block text-sm">
            <span className="font-medium text-slate-700">{label}</span>
            <input
              required={required}
              type={key === "admin_email" ? "email" : "text"}
              className="mt-1 h-10 w-full rounded-lg border px-3"
              style={{ borderColor: LOGIN.border }}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </label>
        ))}
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Plano</span>
          <select
            className="mt-1 h-10 w-full rounded-lg border px-3"
            style={{ borderColor: LOGIN.border }}
            value={form.plan}
            onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}
          >
            {PLAN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} — {opt.contracts == null ? "ilimitado" : `${opt.contracts} contratos`} /{" "}
                {opt.users == null ? "ilimitado" : `${opt.users} usuários`}
              </option>
            ))}
          </select>
          {planMeta(form.plan) ? (
            <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
              {planMeta(form.plan).tagline}. {planMeta(form.plan).highlights.join(" · ")}
            </p>
          ) : null}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.trial} onChange={(e) => setForm((f) => ({ ...f, trial: e.target.checked }))} />
          Iniciar em trial ({form.trial_days} dias)
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: LOGIN.border }}>Cancelar</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-[#155EEF] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Criando…" : "Criar e enviar e-mail"}
          </button>
        </div>
      </form>
    </div>
  );
}
