import {
  Calculator,
  FolderOpen,
  Database,
  Building,
  BarChart3,
  BookOpen,
  Settings,
  Wallet,
  RefreshCw,
  Receipt,
  Banknote,
  Shield,
  Building2,
  Activity,
} from "lucide-react";
import { GOVERNANCE_SECTIONS } from "./governanceNavigation";
import { SETTINGS_SECTIONS } from "./settingsNavigation";

/** Navegação do layout Classic — links diretos (sem submenu). */
export const NAV_ITEMS = [
  { name: "Calculadora", page: "Simulator", icon: Calculator },
  { name: "Contratos", page: "Contracts", icon: FolderOpen },
  { name: "Contas Garantidas", page: "GuaranteedAccounts", icon: RefreshCw },
  { name: "Governança", page: "Governance", icon: Building },
  { name: "Contabilidade", page: "Accounting", icon: BarChart3 },
  { name: "Consolidação", page: "Consolidation", icon: BarChart3 },
  {
    name: "Financeiro",
    icon: Wallet,
    children: [
      { name: "Contas a pagar", page: "AccountsPayable", icon: Receipt },
      { name: "Contas a receber", page: "AccountsReceivable", icon: Banknote },
    ],
  },
  { name: "Indexadores e Feriados", page: "CDIManager", icon: Database },
  { name: "Manual", page: "UserManual", icon: BookOpen },
  { name: "Configurações", page: "Settings", icon: Settings },
];

/** Control plane — visível apenas para PLATFORM MASTER. */
export const PLATFORM_MASTER_NAV = {
  name: "Administração da plataforma",
  icon: Shield,
  masterOnly: true,
  children: [
    { name: "Visão geral", page: "Platform", icon: Shield },
    { name: "Tenants", page: "PlatformTenants", icon: Building2 },
    { name: "Auditoria", page: "PlatformAudit", icon: Activity },
  ],
};

export const PAGE_LABELS = {
  Onboarding: "Configuração inicial",
  Platform: "Administração da plataforma",
  PlatformTenants: "Tenants",
  PlatformTenantDetail: "Detalhe do tenant",
  PlatformAudit: "Auditoria da plataforma",
};

function buildModernNavItems() {
  return NAV_ITEMS.map((item) => {
    if (item.page === "Governance") {
      return {
        name: item.name,
        icon: item.icon,
        children: GOVERNANCE_SECTIONS.map(({ name, page, icon }) => ({ name, page, icon })),
      };
    }
    if (item.page === "Settings") {
      return {
        name: item.name,
        icon: item.icon,
        children: SETTINGS_SECTIONS.map(({ name, page, icon, adminOnly }) => ({
          name,
          page,
          icon,
          adminOnly,
        })),
      };
    }
    return item;
  });
}

export function getNavItemsForLayout(layoutMode, user) {
  const base = layoutMode === "modern" ? buildModernNavItems() : [...NAV_ITEMS];
  const withPlatform = user?.platform_admin
    ? [PLATFORM_MASTER_NAV, ...base]
    : base;
  return filterNavItemsForUser(withPlatform, user);
}

function navItemsForLookup(layoutMode, includePlatform = true) {
  const base = layoutMode === "modern" ? buildModernNavItems() : NAV_ITEMS;
  return includePlatform ? [PLATFORM_MASTER_NAV, ...base] : base;
}

export function getBreadcrumbSegments(currentPageName, layoutMode = "modern") {
  const items = navItemsForLookup(layoutMode);
  for (const item of items) {
    if (item.page === currentPageName) {
      return [{ label: item.name }];
    }
    if (item.children) {
      const child = item.children.find((c) => c.page === currentPageName);
      if (child) {
        return [{ label: item.name }, { label: child.name }];
      }
    }
  }
  const fallback = PAGE_LABELS[currentPageName] || currentPageName || "Início";
  return [{ label: fallback }];
}

export function findNavItemByPage(pageName, layoutMode = "modern") {
  const items = navItemsForLookup(layoutMode);
  for (const item of items) {
    if (item.page === pageName) return item;
    if (item.children) {
      const child = item.children.find((c) => c.page === pageName);
      if (child) return { parent: item, item: child };
    }
  }
  return null;
}

export function getNavGroupForPage(pageName, layoutMode = "modern") {
  const items = navItemsForLookup(layoutMode);
  return items.find((item) => item.children?.some((child) => child.page === pageName)) || null;
}

export function isNavGroupChildPage(pageName, layoutMode = "modern") {
  return Boolean(getNavGroupForPage(pageName, layoutMode));
}

export function filterNavItemsForUser(items, user) {
  const isTenantAdmin = user?.role === "admin" || user?.tenant_role === "OWNER" || user?.platform_admin;
  const isMaster = Boolean(user?.platform_admin);
  return items
    .map((item) => {
      if (item.masterOnly && !isMaster) return null;
      if (!item.children) return item;
      const children = item.children.filter((child) => {
        if (child.masterOnly && !isMaster) return false;
        if (child.adminOnly && !isTenantAdmin) return false;
        return true;
      });
      if (!children.length) return null;
      return { ...item, children };
    })
    .filter(Boolean);
}

export function isFinancePage(pageName) {
  const finance = NAV_ITEMS.find((item) => item.name === "Financeiro");
  return finance?.children?.some((child) => child.page === pageName) ?? false;
}
