import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountApi } from "@/api/account";

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const isInvite = info?.kind === "invite";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError("Link inválido.");
        setLoading(false);
        return;
      }
      try {
        const data = await accountApi.getToken(token);
        if (!cancelled) setInfo(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Link inválido ou expirado.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
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
      await accountApi.setPassword(token, { password, password_confirm: passwordConfirm });
      setDone(true);
    } catch (err) {
      setError(err.message || "Não foi possível salvar a senha");
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-semibold text-slate-900">Senha definida</h1>
          <p className="text-sm text-slate-600">
            {isInvite ? "Convite aceito. Entre com o e-mail e a senha que acabou de criar." : "Sua senha foi alterada. Entre novamente."}
          </p>
          <Link to="/" className="block text-center text-sm font-medium text-slate-900 underline">
            Ir para o login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {isInvite ? "Aceitar convite" : "Redefinir senha"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isInvite ? "Crie a senha de acesso à sua conta." : "Crie uma nova senha para a conta."}
          </p>
        </div>
        {loading ? <p className="text-sm text-slate-500">Validando o link...</p> : null}
        {info ? (
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <p><span className="text-slate-500">E-mail:</span> {info.email}</p>
            {info.full_name ? <p><span className="text-slate-500">Nome:</span> {info.full_name}</p> : null}
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
          {saving ? "Salvando..." : "Salvar senha"}
        </Button>
        <Link to="/" className="block text-center text-sm text-slate-600 underline">
          Voltar ao login
        </Link>
      </form>
    </div>
  );
}
