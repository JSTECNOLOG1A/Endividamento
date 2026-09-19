import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LOGIN } from "@/components/auth/loginTheme";
import { usePlatform } from "@/lib/PlatformContext";
import StepUpModal from "@/components/platform/StepUpModal";
import { createPageUrl } from "@/utils";

export default function SupportAccessModal({ tenant, onClose, onStarted }) {
  const navigate = useNavigate();
  const { startSupport } = usePlatform();
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState(null);
  const [needStepUp, setNeedStepUp] = useState(false);
  const [saving, setSaving] = useState(false);

  const start = async () => {
    setSaving(true);
    setError(null);
    try {
      await startSupport(tenant.id, {
        reason,
        ticket_reference: ticket || null,
        duration_minutes: Number(duration),
      });
      onStarted?.();
      navigate(createPageUrl("Simulator"));
    } catch (err) {
      if (err.code === "STEPUP_REQUIRED" || err.status === 403) {
        setNeedStepUp(true);
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: LOGIN.border }}>
          <h2 className="text-lg font-bold text-slate-900">Acessar ambiente do cliente</h2>
          <p className="mt-1 text-sm text-slate-500">
            Tenant: <strong>{tenant.tenant_name}</strong>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Sessão temporária auditada. Operações registram você como PLATFORM_MASTER — nunca como usuário do cliente.
          </p>

          <label className="mt-4 block text-sm">
            <span className="font-medium text-slate-700">Motivo</span>
            <textarea
              required
              className="mt-1 min-h-[80px] w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: LOGIN.border }}
              placeholder="Investigação do chamado SUP-2026-019"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="font-medium text-slate-700">Referência (opcional)</span>
            <input
              className="mt-1 h-10 w-full rounded-lg border px-3 text-sm"
              style={{ borderColor: LOGIN.border }}
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              placeholder="SUP-2026-019"
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="font-medium text-slate-700">Duração</span>
            <select
              className="mt-1 h-10 w-full rounded-lg border px-3 text-sm"
              style={{ borderColor: LOGIN.border }}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={60}>60 minutos</option>
            </select>
          </label>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: LOGIN.border }}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || reason.trim().length < 8}
              onClick={start}
              className="rounded-lg bg-[#155EEF] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Iniciando…" : "Iniciar acesso de suporte"}
            </button>
          </div>
        </div>
      </div>
      {needStepUp ? (
        <StepUpModal
          onCancel={() => setNeedStepUp(false)}
          onSuccess={async () => {
            setNeedStepUp(false);
            await start();
          }}
        />
      ) : null}
    </>
  );
}
