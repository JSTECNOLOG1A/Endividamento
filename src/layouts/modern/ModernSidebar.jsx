import React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { createPageUrl } from "@/utils";
import { getNavItemsForLayout } from "@/config/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useLayoutMode } from "@/lib/LayoutContext";
import AllDebtLogoModern from "@/components/shared/AllDebtLogoModern";
import ModernSidebarFooter from "./ModernSidebarFooter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { modernActiveItem, modernInactiveItem } from "./theme";
import { cn } from "@/lib/utils";

function itemClass(active, collapsed) {
  return cn(
    "flex items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-150",
    collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
    active ? modernActiveItem : modernInactiveItem
  );
}

function NavLink({ item, currentPageName, collapsed }) {
  const isActive = currentPageName === item.page;
  const link = (
    <Link to={createPageUrl(item.page)} className={itemClass(isActive, collapsed)}>
      <item.icon className="w-[18px] h-[18px] shrink-0" />
      {!collapsed ? <span>{item.name}</span> : null}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.name}</TooltipContent>
      </Tooltip>
    );
  }
  return link;
}

function NavGroup({ item, currentPageName, collapsed }) {
  const childActive = item.children.some((child) => child.page === currentPageName);
  const [open, setOpen] = React.useState(() => childActive);

  React.useEffect(() => {
    if (item.children.some((child) => child.page === currentPageName)) {
      setOpen(true);
    }
  }, [currentPageName, item.children]);

  if (collapsed) {
    return (
      <div className="space-y-1">
        {item.children.map((child) => {
          const isActive = currentPageName === child.page;
          const link = (
            <Link
              key={child.page}
              to={createPageUrl(child.page)}
              className={itemClass(isActive, true)}
            >
              <child.icon className="w-[18px] h-[18px]" />
            </Link>
          );
          return (
            <Tooltip key={child.page}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{child.name}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn("w-full", itemClass(childActive, false))}
      >
        <item.icon className="w-[18px] h-[18px] shrink-0" />
        <span className="flex-1 text-left">{item.name}</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-1 ml-3 pl-3 border-l border-white/10 space-y-1">
          {item.children.map((child) => {
            const isActive = currentPageName === child.page;
            return (
              <Link
                key={child.page}
                to={createPageUrl(child.page)}
                className={itemClass(isActive, false)}
              >
                <child.icon className="w-4 h-4 shrink-0" />
                <span>{child.name}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function ModernSidebar({ currentPageName, collapsed, onToggleCollapse }) {
  const { user, logout } = useAuth();
  const { layoutMode } = useLayoutMode();
  const navItems = React.useMemo(
    () => getNavItemsForLayout(layoutMode, user),
    [layoutMode, user]
  );

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "hidden md:flex flex-col shrink-0 h-full min-h-0 sticky top-0 self-start",
          "bg-[#071A2F] text-white transition-[width] duration-200 ease-out",
          collapsed ? "w-[72px]" : "w-[260px]"
        )}
      >
        <div
          className={cn(
            "border-b border-white/10 shrink-0 flex items-center justify-center",
            collapsed ? "h-[72px] px-2" : "h-[88px] px-4 py-5"
          )}
        >
          <Link
            to={createPageUrl("Simulator")}
            className="flex items-center justify-center rounded-xl transition-transform duration-150 hover:scale-[1.03]"
            aria-label="AllDebt BACEN"
          >
            <AllDebtLogoModern
              variant="icon"
              className={cn(
                "drop-shadow-[0_0_18px_rgba(6,182,212,0.35)]",
                collapsed ? "h-9 w-9" : "h-14 w-14"
              )}
            />
          </Link>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-3 px-2 space-y-0.5">
          {navItems.map((item) => (
            item.children ? (
              <NavGroup
                key={item.name}
                item={item}
                currentPageName={currentPageName}
                collapsed={collapsed}
              />
            ) : (
              <NavLink
                key={item.page}
                item={item}
                currentPageName={currentPageName}
                collapsed={collapsed}
              />
            )
          ))}
        </nav>

        <div className="p-2 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              "w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-400",
              "hover:bg-white/[0.06] hover:text-white transition-colors duration-150",
              collapsed && "justify-center"
            )}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            {!collapsed ? <span>Recolher menu</span> : null}
          </button>
        </div>

        <ModernSidebarFooter collapsed={collapsed} onLogout={logout} />
      </aside>
    </TooltipProvider>
  );
}
