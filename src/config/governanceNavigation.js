import {
  Building2,
  Landmark,
  Layers,
  ListTree,
  Wallet,
} from "lucide-react";

/** Sub-itens de Governança — exibidos no menu Modern (sidebar). */
export const GOVERNANCE_SECTIONS = [
  { section: "groups", name: "Grupos Econômicos", page: "GovernanceGroups", icon: Layers },
  { section: "entities", name: "Entidades Componentes", page: "GovernanceEntities", icon: Building2 },
  { section: "banks", name: "Bancos", page: "GovernanceBanks", icon: Landmark },
  { section: "natures", name: "Naturezas", page: "GovernanceNatures", icon: ListTree },
  { section: "chart", name: "Plano de contas", page: "GovernanceChart", icon: Wallet },
];

export const GOVERNANCE_SECTION_BY_PAGE = Object.fromEntries(
  GOVERNANCE_SECTIONS.map((item) => [item.page, item.section])
);

export const GOVERNANCE_META_BY_SECTION = Object.fromEntries(
  GOVERNANCE_SECTIONS.map((item) => [item.section, item])
);

export const DEFAULT_GOVERNANCE_PAGE = GOVERNANCE_SECTIONS[0].page;

export function isGovernanceSectionPage(pageName) {
  return Boolean(GOVERNANCE_SECTION_BY_PAGE[pageName]);
}

export const GOVERNANCE_SECTION_COPY = {
  groups: "Cadastro de grupos econômicos do tenant.",
  entities: "Empresas componentes vinculadas aos grupos.",
  banks: "Instituições financeiras e contas bancárias.",
  natures: "Naturezas analíticas e sintéticas por entidade.",
  chart: "Plano de contas compartilhado no grupo.",
};
