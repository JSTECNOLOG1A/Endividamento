import React from "react";
import { Link } from "react-router-dom";
import { HelpCircle, LogOut, Settings, Shield, User } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { useFirstAccess } from "@/lib/FirstAccessContext";
import { createPageUrl } from "@/utils";
import MasterTenantAccessSelect from "@/components/platform/MasterTenantAccessSelect";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_LABELS = {
  admin: "Administrador",
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  user: "Usuário",
  viewer: "Visualizador",
  PLATFORM: "Master",
};

function userRoleLabel(user) {
  if (user?.tenant_role === "OWNER") return "Proprietário";
  if (user?.tenant_role === "ADMIN") return "Administrador";
  if (user?.platform_admin) return "Master";
  return ROLE_LABELS[user?.role] || user?.role || "Usuário";
}

function initials(name, email) {
  const base = name || email || "?";
  const parts = base.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function ModernUserMenu() {
  const { user, logout } = useAuth();
  const { isMaster } = usePlatform();
  const { startManualTour } = useFirstAccess();

  if (!user) return null;

  return (
    <div className="flex items-center gap-2" data-tour="user-menu">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 hover:bg-[#F7F9FC] transition-colors duration-150 outline-none">
          <div className="w-8 h-8 rounded-lg bg-[#06B6D4]/15 text-[#06B6D4] flex items-center justify-center text-xs font-semibold">
            {initials(user.full_name, user.email)}
          </div>
          <div className="hidden sm:block text-left min-w-0">
            <p className="text-sm font-medium text-[#172033] truncate max-w-[140px]">
              {user.full_name || user.email}
            </p>
            <p className="text-[11px] text-[#667085] truncate max-w-[140px]">
              {userRoleLabel(user)}
            </p>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-medium">{user.full_name || user.email}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {isMaster ? (
            <DropdownMenuItem asChild>
              <Link to={createPageUrl("Platform")} className="flex items-center gap-2 cursor-pointer">
                <Shield className="w-4 h-4 text-[#06B6D4]" />
                <span className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#06B6D4] leading-none mb-0.5">
                    PLATFORM MASTER
                  </span>
                  Administração da plataforma
                </span>
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link to={createPageUrl("SettingsAccount")} className="flex items-center gap-2 cursor-pointer">
              <User className="w-4 h-4" />
              Meu perfil
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={createPageUrl("SettingsPrivacy")} className="flex items-center gap-2 cursor-pointer">
              <Shield className="w-4 h-4" />
              Privacidade e Dados
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={createPageUrl("SettingsIntegrations")} className="flex items-center gap-2 cursor-pointer">
              <Settings className="w-4 h-4" />
              Preferências
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={startManualTour} className="cursor-pointer">
            <HelpCircle className="w-4 h-4 mr-2" />
            Rever tour do sistema
          </DropdownMenuItem>
          {isMaster ? (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 pb-2 pt-1">
                <MasterTenantAccessSelect variant="light" />
              </div>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600 cursor-pointer">
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
