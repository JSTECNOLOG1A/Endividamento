import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "./utils";
import { Calculator, FolderOpen, Database, Menu, X, Building, BarChart3, BookOpen, Settings, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "sonner";

const NAV_ITEMS = [
  { name: "Simulador", page: "Simulator", icon: Calculator },
  { name: "Contratos", page: "Contracts", icon: FolderOpen },
  { name: "Governança", page: "Governance", icon: Building },
  { name: "Contabilidade", page: "Accounting", icon: BarChart3 },
  { name: "Consolidação", page: "Consolidation", icon: BarChart3 },
  { name: "Indexadores e Feriados", page: "CDIManager", icon: Database },
  { name: "Manual", page: "UserManual", icon: BookOpen },
  { name: "Configurações", page: "Configuracoes", icon: Settings },
];

export default function Layout({ children, currentPageName }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      <style>{`
        :root {
          --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
        }
        body {
          font-family: var(--font-sans);
          -webkit-font-smoothing: antialiased;
        }
      `}</style>

      {/* Top Nav */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <Link to={createPageUrl("Simulator")} className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-sm shadow-blue-600/20 group-hover:shadow-md group-hover:shadow-blue-600/30 transition-shadow">
                <Sigma className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <div>
                <span className="text-sm font-bold text-slate-900 tracking-tight">Endividamento</span>
                <span className="text-[10px] text-slate-400 font-medium ml-1.5 hidden sm:inline">BACEN</span>
              </div>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = currentPageName === item.page;
                return (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-blue-50 text-blue-700 shadow-sm"
                        : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            {/* Mobile Menu Button */}
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

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-4 py-2">
            {NAV_ITEMS.map((item) => {
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {/* Content */}
      <main>{children}</main>
      <Toaster />
    </div>
  );
}