import React, { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import AuthBrandMark from "@/components/auth/AuthBrandMark";
import LoginBackground from "@/components/auth/LoginBackground";
import { LOGIN } from "@/components/auth/loginTheme";

const REMEMBER_KEY = "alldebt_login_email";
const DEFAULT_EMAIL = "support@clarityib.com.br";

const fieldClass =
  "flex h-11 w-full rounded-lg border bg-white px-3.5 text-sm text-[#0F172A] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow] placeholder:text-[#94A3B8] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

function readRememberedEmail() {
  try {
    return localStorage.getItem(REMEMBER_KEY) || DEFAULT_EMAIL;
  } catch {
    return DEFAULT_EMAIL;
  }
}

export default function Login({ onSubmit, error, loading }) {
  const emailId = useId();
  const passwordId = useId();
  const rememberId = useId();
  const [email, setEmail] = useState(readRememberedEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  const handleSubmit = (event) => {
    event.preventDefault();
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, email);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* ignore quota / private mode */
    }
    onSubmit(email, password);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center overflow-auto p-4 sm:p-6"
      style={{ backgroundColor: LOGIN.bg }}
    >
      <LoginBackground />

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-[460px] rounded-2xl border bg-white px-7 py-8 sm:px-9 sm:py-9"
        style={{
          borderColor: LOGIN.border,
          boxShadow:
            "0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 40px -12px rgba(15, 23, 42, 0.1), 0 0 0 1px rgba(255,255,255,0.8) inset",
        }}
        noValidate
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <AuthBrandMark className="mb-6" />
          <h1
            className="text-[1.55rem] font-bold tracking-tight sm:text-[1.7rem]"
            style={{ color: LOGIN.title }}
          >
            Bem-vindo ao AllDebt
          </h1>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: LOGIN.muted }}>
            Acesse sua conta para continuar.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={emailId} className="text-[13px] font-medium text-[#0F172A]">
              E-mail
            </Label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={fieldClass}
              style={{ borderColor: LOGIN.border }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = LOGIN.blue;
                e.currentTarget.style.boxShadow = `0 0 0 3px ${LOGIN.focusRing}`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = LOGIN.border;
                e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04)";
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={passwordId} className="text-[13px] font-medium text-[#0F172A]">
              Senha
            </Label>
            <div className="relative">
              <input
                id={passwordId}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={cn(fieldClass, "pr-11")}
                style={{ borderColor: LOGIN.border }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = LOGIN.blue;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${LOGIN.focusRing}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = LOGIN.border;
                  e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04)";
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#64748B] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/40"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id={rememberId}
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
              className="border-[#D9E2EC] data-[state=checked]:border-[#155EEF] data-[state=checked]:bg-[#155EEF] data-[state=checked]:text-white"
            />
            <Label
              htmlFor={rememberId}
              className="cursor-pointer text-[13px] font-normal text-[#64748B]"
            >
              Manter conectado
            </Label>
          </div>
          <Link
            to="/esqueci-senha"
            className="shrink-0 text-[13px] font-medium text-[#155EEF] transition-colors hover:text-[#0B4DD8] hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/35 rounded"
          >
            Esqueci minha senha
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white transition-[background-color,transform,box-shadow] hover:shadow-md hover:shadow-blue-500/20 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          style={{ backgroundColor: LOGIN.blue }}
          onMouseEnter={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = LOGIN.blueHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = LOGIN.blue;
          }}
        >
          {loading ? "Entrando..." : "Entrar"}
          {!loading ? <ArrowRight className="h-4 w-4 opacity-90" aria-hidden /> : null}
        </button>

        <p className="mt-5 text-center text-sm" style={{ color: LOGIN.muted }}>
          Primeiro acesso?{" "}
          <Link
            to="/criar-conta"
            className="font-medium text-[#155EEF] transition-colors hover:text-[#0B4DD8] hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/35 rounded"
          >
            Solicitar acesso
          </Link>
        </p>

        <div className="mt-7 border-t pt-5" style={{ borderColor: LOGIN.border }}>
          <div className="flex items-center justify-center gap-1.5 text-[11px] tracking-wide" style={{ color: LOGIN.muted }}>
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#155EEF]/70" aria-hidden />
            <span>Ambiente seguro • AllDebt © 2026</span>
          </div>
        </div>
      </form>
    </div>
  );
}
