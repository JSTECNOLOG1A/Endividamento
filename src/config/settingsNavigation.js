import {
  BookOpenCheck,
  CalendarClock,
  Plug,
  ScrollText,
  SlidersHorizontal,
  UserCircle,
  Users,
} from "lucide-react";

/** Sub-itens de Configurações — mesma estrutura do grupo Financeiro. */
export const SETTINGS_SECTIONS = [
  { section: "integracoes", name: "Integrações", page: "SettingsIntegrations", icon: Plug },
  { section: "agendamento", name: "Agendamento", page: "SettingsSchedules", icon: CalendarClock },
  { section: "parametros", name: "Parâmetros", page: "SettingsParameters", icon: SlidersHorizontal, adminOnly: true },
  { section: "logica-contabil", name: "Lógica Contábil", page: "SettingsAccountingLogic", icon: BookOpenCheck, adminOnly: true },
  { section: "usuarios", name: "Usuários", page: "SettingsUsers", icon: Users, adminOnly: true },
  { section: "log", name: "Log", page: "SettingsLog", icon: ScrollText, adminOnly: true },
  { section: "conta", name: "Conta", page: "SettingsAccount", icon: UserCircle },
];

export const SETTINGS_SECTION_BY_PAGE = Object.fromEntries(
  SETTINGS_SECTIONS.map((item) => [item.page, item.section])
);

export const SETTINGS_META_BY_SECTION = Object.fromEntries(
  SETTINGS_SECTIONS.map((item) => [item.section, item])
);

export const DEFAULT_SETTINGS_PAGE = SETTINGS_SECTIONS[0].page;

export function isSettingsPage(pageName) {
  return Boolean(SETTINGS_SECTION_BY_PAGE[pageName]);
}

export function filterSettingsSections(isTenantAdmin) {
  return SETTINGS_SECTIONS.filter((item) => !item.adminOnly || isTenantAdmin);
}

export function settingsChildrenForNav(isTenantAdmin) {
  return filterSettingsSections(isTenantAdmin).map(({ name, page, icon, adminOnly }) => ({
    name,
    page,
    icon,
    adminOnly,
  }));
}
