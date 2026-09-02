import React from "react";
import { Link } from "react-router-dom";
import { LogOut, Settings, Shield, User } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { createPageUrl } from "@/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const { isMaster, tenants, tenantId, selectTenant } = usePlatform();

  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
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
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-medium">{user.full_name || user.email}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to={createPageUrl("SettingsAccount")} className="flex items-center gap-2 cursor-pointer">
              <User className="w-4 h-4" />
              Meu perfil
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={createPageUrl("SettingsIntegrations")} className="flex items-center gap-2 cursor-pointer">
              <Settings className="w-4 h-4" />
              Preferências
            </Link>
          </DropdownMenuItem>
          {isMaster ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Trocar empresa
              </DropdownMenuLabel>
              <div className="px-2 pb-2">
                <Select value={tenantId || "all"} onValueChange={(value) => selectTenant(value)}>
                  <SelectTrigger className="h-8 text-xs">
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
