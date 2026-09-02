import React from "react";
import { LogOut, Shield } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import ModernGroupSelector from "./ModernGroupSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// O seletor de cliente do ModernUserMenu (cabeçalho) só existe na versão
// mobile do header (`md:hidden` em ModernHeader.jsx) — no desktop não
// havia NENHUM jeito de um usuário master trocar de cliente, deixando os
// dados de outros tenants inacessíveis na sidebar. Replica o mesmo
// seletor aqui, que é o rodapé realmente visível no layout desktop.
function ModernTenantSelector({ collapsed }) {
  const { isMaster, tenants, tenantId, selectTenant } = usePlatform();
  if (!isMaster) return null;

  const currentLabel = tenants.find((item) => item.id === tenantId)?.tenant_name || "Todos os clientes";

  if (collapsed) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "w-full flex items-center justify-center rounded-lg p-2.5",
                  "text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors",
                  tenantId && "text-[#67E8F9]"
                )}
                aria-label="Trocar empresa"
              >
                <Shield className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{currentLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Trocar empresa</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => selectTenant("all")}>Todos os clientes</DropdownMenuItem>
          {tenants.map((tenant) => (
            <DropdownMenuItem key={tenant.id} onClick={() => selectTenant(tenant.id)}>
              {tenant.tenant_name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 px-1 flex items-center gap-1">
        <Shield className="w-3 h-3" />
        Trocar empresa
      </label>
      <Select value={tenantId || "all"} onValueChange={selectTenant}>
        <SelectTrigger className="h-9 w-full border-white/10 bg-white/[0.06] text-white text-xs hover:bg-white/[0.08] focus:ring-[#06B6D4]/30">
          <SelectValue placeholder="Cliente" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os clientes</SelectItem>
          {tenants.map((tenant) => (
            <SelectItem key={tenant.id} value={tenant.id}>
              {tenant.tenant_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function initials(name, email) {
  const base = name || email || "?";
  const parts = base.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function ModernSidebarFooter({ collapsed, onLogout }) {
  const { user } = useAuth();
  if (!user) return null;

  if (collapsed) {
    return (
      <div className="border-t border-white/10 p-2 shrink-0 space-y-1">
        <ModernTenantSelector collapsed />
        <ModernGroupSelector collapsed />
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center justify-center rounded-lg p-2.5 text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
          aria-label="Sair"
          title="Sair"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-white/10 p-3 shrink-0 space-y-3">
      <div className="flex items-center gap-3 min-w-0 px-1">
        <div className="h-9 w-9 shrink-0 rounded-full bg-[#06B6D4] text-white flex items-center justify-center text-xs font-semibold">
          {initials(user.full_name, user.email)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">{user.full_name || user.email}</p>
          <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
        </div>
      </div>
      <ModernTenantSelector />
      <ModernGroupSelector />
      <button
        type="button"
        onClick={onLogout}
        className={cn(
          "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
          "text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
        )}
      >
        <LogOut className="w-4 h-4 shrink-0" />
        Sair
      </button>
    </div>
  );
}
