import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AllDebtLogo from "@/components/shared/AllDebtLogo";

export default function Login({ onSubmit, error, loading }) {
  const [email, setEmail] = useState("admin@fincalc.local");
  const [password, setPassword] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit(email, password);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col items-center text-center">
          <AllDebtLogo className="h-10 w-auto max-w-[220px] object-contain mb-4" />
          <p className="text-sm text-slate-500">Entre com sua conta para acessar o sistema.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end">
          <Link to="/esqueci-senha" className="text-xs font-medium text-slate-700 underline">
            Esqueci a senha
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </Button>
        <p className="text-center text-sm text-slate-500">
          Primeiro acesso?{" "}
          <Link to="/criar-conta" className="font-medium text-slate-900 underline">
            Criar conta
          </Link>
        </p>
      </form>
    </div>
  );
}
