import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { hasModule } from "@/lib/modules";

// A rota continua acessível por URL mesmo sem o item no menu; a guarda leva quem não tem o módulo de volta
// à tela inicial (o backend também recusa os dados — ver MODULE_BY_ENTITY em entities/routes.js).
export default function TaxPageShell({ title, description, children }) {
  const { user } = useAuth();
  if (user && !hasModule(user, "tax")) return <Navigate to="/" replace />;
  return (
    <div className="w-full px-4 sm:px-6 py-8" data-tour="tax-workspace">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function TaxEmptyState({ title, children }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-slate-500">{children}</div> : null}
    </div>
  );
}
