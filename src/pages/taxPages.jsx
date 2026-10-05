import React from "react";
import TaxPageShell, { TaxEmptyState } from "@/components/tax/TaxPageShell";
import TaxOverviewPanel from "@/components/tax/TaxOverviewPanel";
import TaxAgreementsWorkspace from "@/components/tax/TaxAgreementsWorkspace";

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
    <TaxPageShell title="Planejamento" description="Calendário de vencimentos e fluxo de caixa dos parcelamentos tributários.">
      <TaxEmptyState title="Planejamento ainda não disponível">
        Esta tela ainda está em construção e não mostra as parcelas cadastradas. Por enquanto, acompanhe as próximas parcelas na Visão
        geral e o detalhe de cada acordo em Parcelamentos Federais e Parcelamentos Estaduais.
      </TaxEmptyState>
    </TaxPageShell>
  );
}
