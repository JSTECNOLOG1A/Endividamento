import React from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import ModernGroupSelector from "./ModernGroupSelector";
import { cn } from "@/lib/utils";

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
