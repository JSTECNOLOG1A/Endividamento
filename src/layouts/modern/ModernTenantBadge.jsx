import React from "react";
import { Building2, Shield } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";

export default function ModernTenantBadge() {
  const { user } = useAuth();
  const { isMaster, tenants, tenantId, viewingAll } = usePlatform();

  const tenantName = isMaster
    ? (viewingAll ? "Todos os clientes" : (tenants.find((t) => t.id === tenantId)?.tenant_name || "Cliente selecionado"))
    : (user?.tenant_name || "Empresa");

  return (
    <div className="hidden lg:flex items-center gap-2 max-w-[280px]">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#E5E7EB] bg-white min-w-0">
        <Building2 className="w-4 h-4 text-[#06B6D4] shrink-0" />
        <span className="text-xs font-medium text-[#172033] truncate uppercase tracking-wide">
          {tenantName}
        </span>
      </div>
      {isMaster ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#0891B2] bg-[#06B6D4]/10 border border-[#06B6D4]/25 px-2 py-1 rounded-md">
          <Shield className="w-3 h-3" />
          Acesso Master
        </span>
      ) : null}
    </div>
  );
}
