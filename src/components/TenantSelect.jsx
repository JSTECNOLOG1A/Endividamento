import React, { useState } from "react";
import { Building2, ChevronRight } from "lucide-react";
import AuthBrandMark from "@/components/auth/AuthBrandMark";
import LoginBackground from "@/components/auth/LoginBackground";
import { LOGIN } from "@/components/auth/loginTheme";

// Segundo passo do login pra quem tem acesso a mais de um cliente da plataforma (ex.: consultor externo).
// O primeiro passo (Login.jsx) já validou a senha; aqui só falta escolher em qual entrar — sem digitar a
// senha de novo, usando o token de seleção de curtíssima duração que o /auth/login devolveu.
export default function TenantSelect({ tenants, error, loading, onSelect, onBack }) {
  const [selecting, setSelecting] = useState(null);

  const handleSelect = (tenantId) => {
    setSelecting(tenantId);
    onSelect(tenantId);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center overflow-auto p-4 sm:p-6"
      style={{ backgroundColor: LOGIN.bg }}
    >
      <LoginBackground />

      <div
        className="relative z-10 w-full max-w-[460px] rounded-2xl border bg-white px-7 py-8 sm:px-9 sm:py-9"
        style={{
          borderColor: LOGIN.border,
          boxShadow:
            "0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 40px -12px rgba(15, 23, 42, 0.1), 0 0 0 1px rgba(255,255,255,0.8) inset",
        }}
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <AuthBrandMark className="mb-6" />
          <h1
            className="text-[1.55rem] font-bold tracking-tight sm:text-[1.7rem]"
            style={{ color: LOGIN.title }}
          >
            Qual cliente você quer acessar?
          </h1>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: LOGIN.muted }}>
            Seu login dá acesso a mais de um cliente da plataforma.
          </p>
        </div>

        <div className="space-y-2">
          {tenants.map((t) => (
            <button
              key={t.tenant_id}
              type="button"
              disabled={loading}
              onClick={() => handleSelect(t.tenant_id)}
              className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: LOGIN.border }}
            >
              <span className="flex items-center gap-3">
                <Building2 className="h-4 w-4 shrink-0" style={{ color: LOGIN.muted }} />
                <span className="text-sm font-medium" style={{ color: LOGIN.title }}>
                  {t.tenant_name}
                </span>
              </span>
              {loading && selecting === t.tenant_id ? (
                <span className="text-xs" style={{ color: LOGIN.muted }}>Entrando…</span>
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" style={{ color: LOGIN.muted }} />
              )}
            </button>
          ))}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="mt-6 w-full text-center text-sm font-medium disabled:opacity-60"
          style={{ color: LOGIN.blue }}
        >
          Voltar
        </button>
      </div>
    </div>
  );
}
