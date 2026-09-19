import React from "react";
import { Shield } from "lucide-react";
import { usePlatform } from "@/lib/PlatformContext";
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

/**
 * Seletor de cliente para PLATFORM MASTER.
 * Delega para PlatformContext.selectTenant, que abre o SupportAccessModal
 * global (TenantAccessHost) com stayOnPage — permanece na tela atual.
 */
export default function MasterTenantAccessSelect({
  collapsed = false,
  variant = "sidebar", // sidebar | light
}) {
  const {
    isMaster,
    tenants,
    tenantId,
    selectTenant,
    inSupportMode,
  } = usePlatform();

  if (!isMaster) return null;

  const currentLabel =
    tenants.find((item) => item.id === tenantId)?.tenant_name || "Todos os clientes";

  const onPick = (value) => {
    selectTenant(!value || value === "all" ? "all" : value);
  };

  const triggerClass =
    variant === "sidebar"
      ? "h-9 w-full border-white/10 bg-white/[0.06] text-white text-xs hover:bg-white/[0.08] focus:ring-[#06B6D4]/30"
      : "h-8 text-xs";

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
                aria-label="Acessar cliente (suporte)"
              >
                <Shield className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{currentLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Acessar cliente (suporte)
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onPick("all")}>Todos os clientes</DropdownMenuItem>
          {tenants.map((tenant) => (
            <DropdownMenuItem key={tenant.id} onClick={() => onPick(tenant.id)}>
              {tenant.tenant_name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="space-y-1.5">
      <label
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.12em] px-1 flex items-center gap-1",
          variant === "sidebar" ? "text-slate-400" : "text-muted-foreground"
        )}
      >
        <Shield className="w-3 h-3" />
        Acessar cliente (suporte)
      </label>
      <Select value={inSupportMode ? tenantId || "all" : "all"} onValueChange={onPick}>
        <SelectTrigger className={triggerClass}>
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
      {variant === "sidebar" ? (
        <p className="text-[10px] text-slate-500 px-1 leading-snug">
          Escolher um cliente abre sessão de suporte auditada. Só trocar a lista não libera Agendamento.
        </p>
      ) : null}
    </div>
  );
}
