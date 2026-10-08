import React from "react";
import TaxPageShell from "@/components/tax/TaxPageShell";
import TaxOverviewPanel from "@/components/tax/TaxOverviewPanel";
import TaxAgreementsWorkspace from "@/components/tax/TaxAgreementsWorkspace";
import TaxPlanningPanel from "@/components/tax/TaxPlanningPanel";

export function TaxOverview() {
  return (
    <TaxPageShell
      title="Gestão Tributária"
      description="Situação dos parcelamentos de tributos federais e estaduais, com a data da última conferência de cada um."
    >
      <TaxOverviewPanel />
    </TaxPageShell>
  );
}

export function TaxFederal() {
  return (
    <TaxPageShell title="Parcelamentos Federais" description="Acordos com a Receita Federal e a PGFN, por número de parcelamento.">
      <TaxAgreementsWorkspace esfera="federal" />
    </TaxPageShell>
  );
}

export function TaxState() {
  return (
    <TaxPageShell title="Parcelamentos Estaduais" description="Acordos com as Fazendas estaduais, por número de parcelamento.">
      <TaxAgreementsWorkspace esfera="estadual" />
    </TaxPageShell>
  );
}

export function TaxPlanning() {
  return (
    <TaxPageShell
      title="Planejamento"
      description="Calendário e fluxo de caixa dos vencimentos dos parcelamentos, por mês, empresa, esfera e tributo."
    >
      <TaxPlanningPanel />
    </TaxPageShell>
  );
}
