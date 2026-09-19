import React from "react";
import { Link } from "react-router-dom";
import { LogOut, Shield } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { createPageUrl } from "@/utils";
import ModernGroupSelector from "./ModernGroupSelector";
import MasterTenantAccessSelect from "@/components/platform/MasterTenantAccessSelect";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function ModernPlatformMasterLink({ collapsed }) {
  const { isMaster } = usePlatform();
  if (!isMaster) return null;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={createPageUrl("Platform")}
            className={cn(
              "w-full flex items-center justify-center rounded-lg p-2.5",
              "text-[#67E8F9] hover:bg-white/[0.06] hover:text-white transition-colors"
            )}
            aria-label="Administração da plataforma"
          >
            <Shield className="w-4 h-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Administração da plataforma</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      to={createPageUrl("Platform")}
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border border-[#67E8F9]/25 bg-white/[0.04] px-3 py-2.5",
        "hover:bg-white/[0.08] transition-colors"
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#67E8F9]">
        PLATFORM MASTER
      </span>
      <span className="text-xs font-medium text-white underline underline-offset-2">
        Administração da plataforma
      </span>
    </Link>
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
        <ModernPlatformMasterLink collapsed />
        <MasterTenantAccessSelect collapsed />
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
      <ModernPlatformMasterLink />
      <MasterTenantAccessSelect />
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
