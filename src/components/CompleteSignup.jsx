import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/AuthContext";
import { signupApi } from "@/api/signup";

export default function CompleteSignup() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { acceptSession } = useAuth();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError("Link de cadastro inválido.");
        setLoading(false);
        return;
      }
      try {
        const data = await signupApi.get(token);
        if (!cancelled) setInfo(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Link de cadastro inválido ou expirado.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError("As senhas não coincidem");
      return;
    }
    setSaving(true);
    try {
      const result = await signupApi.complete(token, {
        password,
        password_confirm: passwordConfirm,
      });
      await acceptSession(result.token, result.user);
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(err.message || "Não foi possível concluir o cadastro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Concluir cadastro</h1>
          <p className="mt-1 text-sm text-slate-500">Crie a primeira senha para acessar o sistema.</p>
        </div>
        {loading ? <p className="text-sm text-slate-500">Validando o link...</p> : null}
        {info ? (
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <p><span className="text-slate-500">Empresa:</span> {info.company_name}</p>
            <p><span className="text-slate-500">CNPJ:</span> {info.cnpj}</p>
            <p><span className="text-slate-500">E-mail:</span> {info.email}</p>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            disabled={!info}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password_confirm">Confirmar senha</Label>
          <Input
            id="password_confirm"
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            minLength={8}
            required
            disabled={!info}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={saving || !info}>
          {saving ? "Salvando..." : "Criar senha e entrar"}
        </Button>
        <Link to="/" className="block text-center text-sm text-slate-600 underline">
          Voltar ao login
        </Link>
      </form>
    </div>
  );
}
