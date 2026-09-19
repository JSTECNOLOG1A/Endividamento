import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../../utils";
import {
  Menu,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import SupportSessionBanner from "@/components/platform/SupportSessionBanner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import AllDebtLogo from "@/components/shared/AllDebtLogo";
import MasterTenantAccessSelect from "@/components/platform/MasterTenantAccessSelect";
import { getNavItemsForLayout, getNavGroupForPage } from "@/config/navigation";

function navClass(active) {
  return `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
    active
      ? "bg-blue-50 text-blue-700 shadow-sm"
      : "text-slate-600 hover:text-slate-700 hover:bg-slate-100"
  }`;
}

export default function ClassicLayout({ children, currentPageName }) {
  const { user, logout } = useAuth();
  const { isMaster } = usePlatform();
  const navItems = React.useMemo(() => getNavItemsForLayout("classic", user), [user]);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [mobileOpenGroups, setMobileOpenGroups] = React.useState(() => {
    const activeGroup = getNavGroupForPage(currentPageName, "classic");
    return activeGroup ? { [activeGroup.name]: true } : {};
  });

  React.useEffect(() => {
    const activeGroup = getNavGroupForPage(currentPageName, "classic");
    if (activeGroup) {
      setMobileOpenGroups((prev) => ({ ...prev, [activeGroup.name]: true }));
    }
  }, [currentPageName]);

  return (
    <div className="min-h-screen bg-white">
      <style>{`
        :root {
          --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
        }
        body {
          font-family: var(--font-sans);
          -webkit-font-smoothing: antialiased;
        }
        /* Padrão visual do sistema: sem bordas arredondadas em lugar
           nenhum (botões, cards, inputs, badges, modais etc.). */
        *, *::before, *::after {
          border-radius: 0 !important;
        }
        /* Padrão visual do sistema: células e cabeçalhos de tabela nunca
           quebram texto em duas linhas — cada tabela rola horizontalmente
           quando necessário, em vez de forçar quebra de linha no conteúdo. */
        table th, table td {
          white-space: nowrap !important;
        }
      `}</style>

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
        <div className="w-full px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <Link to={createPageUrl("Simulator")} className="flex items-center group shrink-0">
              <AllDebtLogo className="h-8 w-auto max-w-[200px] object-contain object-left" />
            </Link>

            <nav className="hidden md:flex items-center gap-1" data-tour="nav-main">
              {navItems.map((item) => {
                if (item.children) {
                  const childActive = item.children.some((child) => child.page === currentPageName);
                  return (
                    <DropdownMenu key={item.name}>
                      <DropdownMenuTrigger className={`${navClass(childActive)} outline-none`}>
                        <item.icon className="w-3.5 h-3.5" />
                        {item.name}
                        <ChevronDown className="w-3 h-3 opacity-60" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[180px]">
                        {item.children.map((child) => (
                          <DropdownMenuItem key={child.page} asChild>
                            <Link
                              to={createPageUrl(child.page)}
                              className={`flex items-center gap-2 cursor-pointer ${
                                currentPageName === child.page ? "text-blue-700" : ""
                              }`}
                            >
                              <child.icon className="w-3.5 h-3.5" />
                              {child.name}
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                }

                const isActive = currentPageName === item.page;
                return (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    className={navClass(isActive)}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              {isMaster ? (
                <div className="hidden sm:block w-[220px]">
                  <MasterTenantAccessSelect variant="light" />
                </div>
              ) : null}
              {user?.email ? (
                <button
                  type="button"
                  onClick={logout}
                  className="hidden md:inline text-[11px] text-slate-400 hover:text-slate-700 px-1"
                  title="Sair"
                >
                  Sair
                </button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-8 w-8"
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-4 py-2">
            {navItems.map((item) => {
              if (item.children) {
                const childActive = item.children.some((child) => child.page === currentPageName);
                const groupOpen = mobileOpenGroups[item.name] ?? childActive;
                return (
                  <div key={item.name}>
                    <button
                      type="button"
                      onClick={() => setMobileOpenGroups((prev) => ({ ...prev, [item.name]: !groupOpen }))}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${
                        childActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.name}
                      <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${groupOpen ? "rotate-180" : ""}`} />
                    </button>
                    {groupOpen && item.children.map((child) => (
                      <Link
                        key={child.page}
                        to={createPageUrl(child.page)}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2 pl-9 pr-3 py-2 rounded-lg text-sm font-medium ${
                          currentPageName === child.page
                            ? "bg-blue-50 text-blue-700"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <child.icon className="w-4 h-4" />
                        {child.name}
                      </Link>
                    ))}
                  </div>
                );
              }

              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
            {isMaster ? (
              <div className="px-3 py-2">
                <MasterTenantAccessSelect variant="light" />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => { setMobileOpen(false); logout(); }}
              className="w-full text-left px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50 rounded-lg"
            >
              Sair
            </button>
          </div>
        )}
      </header>

      <SupportSessionBanner />

      {!isMaster && user && !user.onboarding_completed_at && currentPageName !== "Onboarding" ? (
        <div className="bg-sky-50 border-b border-sky-100 text-sky-900 text-xs px-4 py-2 text-center">
          Confirme os códigos Protheus da filial.{" "}
          <Link to="/onboarding" className="font-medium underline">
            Abrir configuração inicial
          </Link>
        </div>
      ) : null}

      <main>{children}</main>
      <Toaster />
    </div>
  );
}
