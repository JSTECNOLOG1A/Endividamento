import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Pré-implantação: empresa aguardando a implantação de saldos. Enquanto estiver assim, aprovar contrato não gera
// títulos, nada é integrado ao ERP e o fechamento contábil fica parado. A trava sai ao aplicar a implantação.
export function usePreImplantation() {
  const { data: entities = [] } = useQuery({
    queryKey: ["pre-implantation-entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    initialData: [],
    staleTime: 30 * 1000,
  });
  return entities.filter((e) => e.implantacao_pendente === true);
}

export default function PreImplantationBanner({ entityId = null, className = "" }) {
  const waiting = usePreImplantation();
  const list = entityId ? waiting.filter((e) => e.id === entityId) : waiting;
  if (!list.length) return null;
  return (
    <div className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex gap-2 ${className}`}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <p className="font-medium">
          {entityId ? "Empresa aguardando a implantação de saldos" : `Empresas aguardando a implantação de saldos: ${list.map((e) => e.entity_name).join(", ")}`}
        </p>
        <p>
          Enquanto isso, aprovar contrato não gera títulos, nada é integrado ao ERP e o fechamento contábil não roda. A trava sai ao aplicar a implantação
          (que gera os títulos necessários, retidos até a liberação).{" "}
          <Link to="/SettingsBalanceDeployment" className="font-medium underline">Ir para Implantação de Saldos</Link>
        </p>
      </div>
    </div>
  );
}
