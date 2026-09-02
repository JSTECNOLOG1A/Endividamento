import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountApi } from "@/api/account";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      setResult(await accountApi.forgotPassword(email));
    } catch (err) {
      setError(err.message || "Não foi possível solicitar a redefinição");
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-semibold text-slate-900">Verifique seu e-mail</h1>
          <p className="text-sm text-slate-600">
            Se existir uma conta para <strong>{email}</strong>, enviaremos o link para redefinir a senha.
          </p>
          {result.email_sent ? (
            <p className="text-sm text-slate-500">O link expira em 2 horas.</p>
          ) : result.reset_url ? (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p>O servidor de e-mail ainda não está configurado. Use o link abaixo neste ambiente.</p>
              <a className="break-all text-sky-700 underline" href={result.reset_url}>
                {result.reset_url}
              </a>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Se o e-mail estiver cadastrado, o link já foi gerado.</p>
          )}
          <Link to="/" className="block text-center text-sm text-slate-600 underline">
            Voltar ao login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Esqueci a senha</h1>
          <p className="mt-1 text-sm text-slate-500">Informe o e-mail da conta. Enviaremos um link para criar uma nova senha.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Enviando..." : "Enviar link"}
        </Button>
        <Link to="/" className="block text-center text-sm text-slate-600 underline">
          Voltar ao login
        </Link>
      </form>
    </div>
  );
}
