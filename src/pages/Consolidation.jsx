import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import ConsolidationDashboard from "../components/consolidation/ConsolidationDashboard";

export default function Consolidation() {
  // Consolidação é um efeito contábil (posição de dívida consolidada por
  // Grupo/Banco) — só pode refletir contratos Aprovados. Filtrado aqui, na
  // origem dos dados, para nenhum componente abaixo (mesmo um futuro) poder
  // acidentalmente incluir rascunho/pendente/devolvido nos números.
  const { data: contracts } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => {
      const all = await base44.entities.LoanContract.list("-created_date", 1000);
      return all.filter((c) => c.status === "aprovado");
    },
    initialData: [],
  });

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("", 1000),
    initialData: [],
  });

  const { data: entities } = useQuery({
    queryKey: ["entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    initialData: [],
  });

  const { data: banks } = useQuery({
    queryKey: ["banks"],
    queryFn: () => base44.entities.Bank.list("", 1000),
    initialData: [],
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Consolidação</h1>
        <p className="text-sm text-slate-500 mt-0.5">Análise consolidada de dívidas por Grupo Econômico</p>
      </div>
      <ConsolidationDashboard
        contracts={contracts}
        groups={groups}
        entities={entities}
        banks={banks}
      />
    </div>
  );
}