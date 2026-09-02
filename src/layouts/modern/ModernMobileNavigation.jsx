import React from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { createPageUrl } from "@/utils";
import { getNavItemsForLayout, getNavGroupForPage } from "@/config/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useLayoutMode } from "@/lib/LayoutContext";
import AllDebtLogoModern from "@/components/shared/AllDebtLogoModern";
import ModernSidebarFooter from "./ModernSidebarFooter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { modernActiveItem } from "./theme";

function buildInitialOpenGroups(currentPageName, layoutMode) {
  const activeGroup = getNavGroupForPage(currentPageName, layoutMode);
  if (!activeGroup) return {};
  return { [activeGroup.name]: true };
}

export default function ModernMobileNavigation({ open, onOpenChange, currentPageName }) {
  const { user, logout } = useAuth();
  const { layoutMode } = useLayoutMode();
  const navItems = React.useMemo(
    () => getNavItemsForLayout(layoutMode, user),
    [layoutMode, user]
  );
  const [openGroups, setOpenGroups] = React.useState(() => buildInitialOpenGroups(currentPageName, layoutMode));

  React.useEffect(() => {
    const activeGroup = getNavGroupForPage(currentPageName, layoutMode);
    if (activeGroup) {
      setOpenGroups((prev) => ({ ...prev, [activeGroup.name]: true }));
    }
  }, [currentPageName, layoutMode]);

  const toggleGroup = (name) => {
    setOpenGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[260px] p-0 bg-[#071A2F] text-white border-r-0 flex flex-col">
        <SheetHeader className="px-4 py-5 border-b border-white/10 shrink-0">
          <SheetTitle className="text-white flex items-center justify-center">
            <AllDebtLogoModern
              variant="icon"
              className="h-12 w-12 drop-shadow-[0_0_18px_rgba(6,182,212,0.35)]"
            />
          </SheetTitle>
        </SheetHeader>
        <nav className="flex-1 min-h-0 py-3 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            if (item.children) {
              const childActive = item.children.some((c) => c.page === currentPageName);
              const groupOpen = openGroups[item.name] ?? childActive;
              return (
                <div key={item.name}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.name)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      childActive ? modernActiveItem : "text-slate-200 hover:bg-white/8"
                    }`}
                  >
                    <item.icon className="w-[18px] h-[18px]" />
                    <span className="flex-1 text-left">{item.name}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${groupOpen ? "rotate-180" : ""}`} />
                  </button>
                  {groupOpen ? (
                    <div className="ml-3 pl-3 border-l border-white/10 mt-1 space-y-1">
                      {item.children.map((child) => (
                        <Link
                          key={child.page}
                          to={createPageUrl(child.page)}
                          onClick={() => onOpenChange(false)}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                            currentPageName === child.page
                              ? modernActiveItem
                              : "text-slate-300 hover:bg-white/8"
                          }`}
                        >
                          <child.icon className="w-4 h-4" />
                          {child.name}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }

            const isActive = currentPageName === item.page;
            return (
              <Link
                key={item.page}
                to={createPageUrl(item.page)}
                onClick={() => onOpenChange(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                  isActive ? modernActiveItem : "text-slate-200 hover:bg-white/8"
                }`}
              >
                <item.icon className="w-[18px] h-[18px]" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <ModernSidebarFooter onLogout={logout} />
      </SheetContent>
    </Sheet>
  );
}
