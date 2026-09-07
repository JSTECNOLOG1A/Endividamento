import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Headphones, X } from "lucide-react";
import { usePlatform } from "@/lib/PlatformContext";
import { createPageUrl } from "@/utils";

function remainingLabel(expiresAt) {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expirada";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Banner permanente durante sessão de suporte (data plane). */
export default function SupportSessionBanner() {
  const { inSupportMode, supportSession, endSupport } = usePlatform();
  const [remaining, setRemaining] = useState(() => remainingLabel(supportSession?.expires_at));

  useEffect(() => {
    if (!inSupportMode) return undefined;
    const tick = () => {
      setRemaining(remainingLabel(supportSession?.expires_at));
      if (supportSession?.expires_at && new Date(supportSession.expires_at).getTime() <= Date.now()) {
        endSupport();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [inSupportMode, supportSession?.expires_at, endSupport]);

  if (!inSupportMode || !supportSession) return null;

  return (
    <div
      className="shrink-0 border-b border-amber-300 bg-amber-50 text-amber-950 px-4 py-2.5 text-sm"
      role="status"
      data-tour="support-session-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 max-w-[1600px] mx-auto">
        <div className="flex items-start gap-2 min-w-0">
          <Headphones className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
          <div className="min-w-0">
            <p className="font-semibold">
              Você está acessando o tenant{" "}
              <span className="underline decoration-amber-400">{supportSession.tenant_name}</span>{" "}
              em modo de suporte.
            </p>
            <p className="text-xs text-amber-900/80 mt-0.5 truncate">
              Motivo: {supportSession.reason}
              {supportSession.ticket_reference ? ` · ${supportSession.ticket_reference}` : ""}
              {" · "}Início: {new Date(supportSession.started_at).toLocaleString("pt-BR")}
              {" · "}Restante: {remaining}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={createPageUrl("Platform")}
            className="text-xs font-medium text-amber-900 underline underline-offset-2"
          >
            Admin plataforma
          </Link>
          <button
            type="button"
            onClick={() => endSupport()}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
          >
            <X className="w-3.5 h-3.5" />
            Encerrar sessão de suporte
          </button>
        </div>
      </div>
    </div>
  );
}
