import React from "react";
import { Bell } from "lucide-react";
import ModernBreadcrumb from "./ModernBreadcrumb";
import ModernTenantBadge from "./ModernTenantBadge";
import ModernUserMenu from "./ModernUserMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export default function ModernHeader({ currentPageName, onOpenMobileNav }) {
  return (
    <header className="z-40 h-14 shrink-0 border-b border-[#E5E7EB] bg-white md:hidden">
      <div className="h-full px-4 lg:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="lg:hidden h-9 w-9 rounded-lg border-[#E5E7EB]"
            onClick={onOpenMobileNav}
            aria-label="Abrir menu"
          >
            <span className="sr-only">Menu</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </Button>
          <ModernBreadcrumb currentPageName={currentPageName} />
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <ModernTenantBadge />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg border-[#E5E7EB] relative"
                aria-label="Notificações"
              >
                <Bell className="w-4 h-4 text-[#06B6D4]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem disabled className="text-sm text-[#667085]">
                Nenhuma notificação no momento.
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ModernUserMenu />
        </div>
      </div>
    </header>
  );
}
