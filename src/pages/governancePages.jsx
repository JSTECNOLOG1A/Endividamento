import { GovernanceView } from "./Governance";

export function GovernanceGroups() {
  return <GovernanceView section="groups" />;
}

export function GovernanceEntities() {
  return <GovernanceView section="entities" />;
}

export function GovernanceBanks() {
  return <GovernanceView section="banks" />;
}

export function GovernanceNatures() {
  return <GovernanceView section="natures" />;
}

export function GovernanceChart() {
  return <GovernanceView section="chart" />;
}
