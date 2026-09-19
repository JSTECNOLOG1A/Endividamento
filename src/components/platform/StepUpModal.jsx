import React, { useState } from "react";
import { LOGIN } from "@/components/auth/loginTheme";
import { usePlatform } from "@/lib/PlatformContext";

/** Step-up authentication (senha) para ações críticas do PLATFORM_MASTER. */
export default function StepUpModal({ onCancel, onSuccess }) {
  const { stepUp } = usePlatform();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await stepUp(password);
      await onSuccess?.();
    } catch (err) {
      setError(err.message || "Falha na confirmação");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: LOGIN.border }}>
        <h2 className="text-lg font-bold text-slate-900">Confirmação privilegiada</h2>
        <p className="mt-1 text-sm text-slate-500">
          Esta ação exige validação adicional da conta PLATFORM_MASTER.
        </p>
        <label className="mt-4 block text-sm">
          <span className="font-medium text-slate-700">Sua senha</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 h-10 w-full rounded-lg border px-3"
            style={{ borderColor: LOGIN.border }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: LOGIN.border }}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-[#155EEF] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Validando…" : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}
