import React from "react";
import TaxPageShell, { TaxEmptyState } from "@/components/tax/TaxPageShell";

const SITUACOES = ["Em dia", "A vencer", "Em atraso", "Pago, aguardando reconhecimento", "Desatualizado"];

export function TaxOverview() {
  return (
    <TaxPageShell
      title="Gestão Tributária"
      description="Controle dos parcelamentos de tributos por código de parcelamento, separados por esfera."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {SITUACOES.map((label) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-300">—</p>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <TaxEmptyState title="Nenhum parcelamento cadastrado ainda">
          O cadastro de parcelamentos federais e estaduais está sendo construído. Quando houver dados, esta tela mostrará quais
          acordos estão em dia, a data da última conferência de cada um e a origem da informação (API, importada ou manual).
        </TaxEmptyState>
      </div>
    </TaxPageShell>
  );
}

export function TaxFederal() {
  return (
    <TaxPageShell title="Parcelamentos Federais" description="Acordos com a Receita Federal e a PGFN, por código de parcelamento.">
      <TaxEmptyState title="Nenhum parcelamento federal cadastrado">
        Cada acordo será identificado por órgão, contribuinte, modalidade e número do parcelamento, com suas parcelas, guias e situação.
      </TaxEmptyState>
    </TaxPageShell>
  );
}

export function TaxState() {
  return (
    <TaxPageShell title="Parcelamentos Estaduais" description="Acordos com as Fazendas estaduais, por código de parcelamento.">
      <TaxEmptyState title="Nenhum parcelamento estadual cadastrado">
        Cada acordo será identificado por UF, contribuinte, modalidade e número do parcelamento, com suas parcelas, guias e situação.
      </TaxEmptyState>
    </TaxPageShell>
  );
}

export function TaxPlanning() {
  return (
    <TaxPageShell title="Planejamento" description="Calendário de vencimentos e fluxo de caixa dos parcelamentos tributários.">
      <TaxEmptyState title="Sem parcelas para projetar">
        Depois do cadastro dos parcelamentos, aqui aparecem os vencimentos por mês, empresa, esfera e tributo, e os alertas de vencimento.
      </TaxEmptyState>
    </TaxPageShell>
  );
}
