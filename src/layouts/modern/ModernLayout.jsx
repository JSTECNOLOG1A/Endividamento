import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { Toaster } from "@/components/ui/sonner";
import { readSidebarCollapsed, writeSidebarCollapsed } from "@/lib/layoutMode";
import ModernSidebar from "./ModernSidebar";
import ModernHeader from "./ModernHeader";
import ModernMobileNavigation from "./ModernMobileNavigation";

export default function ModernLayout({ children, currentPageName }) {
  const { user } = useAuth();
  const { isMaster } = usePlatform();
  const [collapsed, setCollapsed] = React.useState(() => readSidebarCollapsed(user?.id));
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(readSidebarCollapsed(user?.id));
  }, [user?.id]);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(user?.id, next);
      return next;
    });
  };

  React.useEffect(() => {
    document.documentElement.dataset.layoutShell = "modern";
    return () => {
      delete document.documentElement.dataset.layoutShell;
    };
  }, []);

  return (
    <div className="modern-app h-[100dvh] max-h-[100dvh] overflow-hidden flex bg-[#F4F6F9] text-[#172033]" data-layout="modern">
      <ModernSidebar
        currentPageName={currentPageName}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />

      <ModernMobileNavigation
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        currentPageName={currentPageName}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full min-h-0 overflow-hidden">
        <ModernHeader
          currentPageName={currentPageName}
          onOpenMobileNav={() => setMobileOpen(true)}
        />

        {!isMaster && user && !user.onboarding_completed_at && currentPageName !== "Onboarding" ? (
          <div className="bg-[#06B6D4]/10 border-b border-[#06B6D4]/25 text-[#0B1220] text-xs px-4 py-2 text-center shrink-0">
            Confirme os códigos Protheus da filial.{" "}
            <Link to="/onboarding" className="font-medium text-[#06B6D4] underline underline-offset-2">
              Abrir configuração inicial
            </Link>
          </div>
        ) : null}

        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 lg:px-8 py-5 lg:py-7">
          <div className="modern-page-content w-full">
            {children}
          </div>
        </main>
      </div>

      <Toaster />
    </div>
  );
}
