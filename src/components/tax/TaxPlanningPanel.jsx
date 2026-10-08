import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { createPageUrl } from "@/utils";
import { todayInBrazil } from "@/lib/taxDates";
import {
  hasNarrowingFilters,
  isPlanningEmpty,
  planningQueryParams,
  readPlanningFilters,
} from "@/lib/taxPlanning";
import { useTaxFilterSources, useTaxPlanning } from "@/hooks/useTaxData";
import { TaxEmptyState, TaxErrorState } from "./TaxPageShell";
import TaxPlanningFilters from "./TaxPlanningFilters";
import { TaxPlanningOverdue, TaxPlanningTotals } from "./TaxPlanningSummary";
import TaxCashFlowChart from "./TaxCashFlowChart";
import TaxPlanningCalendar from "./TaxPlanningCalendar";
import TaxPlanningBreakdown from "./TaxPlanningBreakdown";
import TaxAlertsPreference from "./TaxAlertsPreference";

const FILTER_PARAMS = ["empresa", "esfera", "tributo", "orgao"];

function PlanningLoading() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Somando os vencimentos do período…
    </div>
  );
}

function PlanningEmpty({ filtered, activeAgreements, onClear }) {
  if (filtered) {
    return (
      <TaxEmptyState title="Nenhuma parcela com esses filtros no período">
        Não há parcela a pagar, paga ou vencida em aberto para a combinação escolhida.{" "}
        <button type="button" className="font-medium text-slate-700 underline" onClick={onClear}>Limpar filtros</button>
      </TaxEmptyState>
    );
  }
  if (activeAgreements === 0) {
    return (
      <TaxEmptyState title="Nenhum parcelamento ativo cadastrado">
        O planejamento soma as parcelas dos parcelamentos ativos. Cadastre os acordos em{" "}
        <Link to={createPageUrl("TaxFederal")} className="font-medium text-slate-700 underline">Parcelamentos Federais</Link> ou{" "}
        <Link to={createPageUrl("TaxState")} className="font-medium text-slate-700 underline">Parcelamentos Estaduais</Link>, com as
        parcelas.
      </TaxEmptyState>
    );
  }
  return (
    <TaxEmptyState title="Nenhuma parcela no período">
      Os parcelamentos ativos não têm parcela com vencimento nestes meses, nem parcela vencida em aberto. Escolha outro período ou
      confira as parcelas no detalhe de cada parcelamento.
    </TaxEmptyState>
  );
}

/** Planejamento: calendário e fluxo de caixa dos vencimentos dos parcelamentos, com recortes e o aviso por e-mail. */
export default function TaxPlanningPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentMonth = todayInBrazil().slice(0, 7);
  const filters = readPlanningFilters(searchParams, currentMonth);
  // Objeto novo a cada render não refaz a consulta: o React Query compara a chave pelo conteúdo.
  const queryParams = planningQueryParams(filters);
  const sources = useTaxFilterSources();
  const { data, isLoading, error, refetch } = useTaxPlanning(queryParams);

  const updateFilters = (changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, String(value));
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => updateFilters(Object.fromEntries(FILTER_PARAMS.map((key) => [key, ""])));
  const filtered = hasNarrowingFilters(filters);
  const activeAgreements = sources.isLoading || sources.error
    ? null
    : sources.agreements.filter((agreement) => agreement.situacao === "ativo").length;

  let content;
  if (isLoading) {
    content = <PlanningLoading />;
  } else if (error) {
    // Erro nunca vira "nada a pagar": a tela mostra o motivo e não mostra número nenhum.
    const filterProblem = error.status === 404 || error.status === 400;
    content = (
      <div className="space-y-2">
        <TaxErrorState title="Não foi possível carregar o planejamento" message={error.message} onRetry={filterProblem ? undefined : refetch} />
        {filterProblem && filtered ? (
          <p className="text-center text-xs text-slate-600">
            Algum filtro não vale mais (por exemplo, uma empresa excluída).{" "}
            <button type="button" className="font-medium underline" onClick={clearFilters}>Limpar filtros</button>
          </p>
        ) : null}
      </div>
    );
  } else if (isPlanningEmpty(data)) {
    content = <PlanningEmpty filtered={filtered} activeAgreements={activeAgreements} onClear={clearFilters} />;
  } else {
    const resultKey = JSON.stringify(queryParams);
    content = (
      <div className="space-y-4">
        <TaxPlanningTotals data={data} />
        <TaxPlanningOverdue key={`vencidas-${resultKey}`} vencidas={data.vencidas} today={data.hoje} />
        <TaxCashFlowChart meses={data.meses} />
        <TaxPlanningCalendar key={`calendario-${resultKey}`} meses={data.meses} today={data.hoje} />
        <TaxPlanningBreakdown data={data} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TaxPlanningFilters
        filters={filters}
        currentMonth={currentMonth}
        sources={sources}
        onChange={updateFilters}
        onClear={clearFilters}
      />
      {content}
      <TaxAlertsPreference />
    </div>
  );
}
