import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { createPageUrl } from "@/utils";
import { cn } from "@/lib/utils";
import { formatCivilDate } from "@/lib/taxDates";
import { SIGNALS, SIGNAL_ORDER, STALE_AFTER_DAYS, isBalanceUnverified } from "@/lib/taxSignal";
import { AGREEMENT_STATUS_LABELS, formatMoney } from "@/lib/taxLabels";
import { useTaxPortfolio } from "@/hooks/useTaxData";
import { ProvenanceNote, SIGNAL_DOT } from "./TaxBadges";
import { TaxEmptyState, TaxErrorState, TaxLoadingState } from "./TaxPageShell";

const UPCOMING_LIMIT = 8;

const SPHERES = [
  { key: "federal", label: "Federal", plural: "Federais", page: "TaxFederal" },
  { key: "estadual", label: "Estadual", plural: "Estaduais", page: "TaxState" },
];

const PAGE_BY_SPHERE = Object.fromEntries(SPHERES.map((item) => [item.key, item.page]));

function listUrl(page, params) {
  const query = new URLSearchParams(params).toString();
  return `${createPageUrl(page)}${query ? `?${query}` : ""}`;
}

function SignalCards({ rows }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {SIGNAL_ORDER.map((key) => {
        const matching = rows.filter((row) => row.signal === key);
        return (
          <div key={key} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", SIGNAL_DOT[key])} aria-hidden="true" />
              {SIGNALS[key].label}
            </p>
            <p className={cn("mt-1.5 text-2xl font-bold tabular-nums", matching.length ? "text-slate-900" : "text-slate-300")}>
              {matching.length}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
              {SPHERES.map((sphere) => {
                const count = matching.filter((row) => row.agreement.esfera === sphere.key).length;
                return count ? (
                  <Link key={sphere.key} to={listUrl(sphere.page, { situacao: key })} className="text-slate-600 underline-offset-2 hover:underline">
                    {sphere.plural}: {count}
                  </Link>
                ) : (
                  <span key={sphere.key} className="text-slate-400">{sphere.plural}: 0</span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SphereSummary({ sphere, rows }) {
  const sphereRows = rows.filter((row) => row.agreement.esfera === sphere.key);
  const active = sphereRows.filter((row) => row.agreement.situacao === "ativo");
  const withBalance = active.filter((row) => row.agreement.saldo_oficial !== null && row.agreement.saldo_oficial !== undefined);
  // Total devedor = saldo informado de cada acordo, na sua data-base. Parcelas a vencer ou vencidas não entram: já estão dentro do saldo.
  const total = withBalance.reduce((sum, row) => sum + Number(row.agreement.saldo_oficial), 0);
  const baseDates = withBalance.map((row) => row.agreement.saldo_data_base).filter(Boolean).sort();
  const oldest = baseDates[0];
  const newest = baseDates[baseDates.length - 1];
  const others = Object.keys(AGREEMENT_STATUS_LABELS)
    .filter((status) => status !== "ativo")
    .map((status) => ({ status, count: sphereRows.filter((row) => row.agreement.situacao === status).length }))
    .filter((item) => item.count > 0);
  const neverChecked = active.filter((row) => !row.agreement.ultima_conferencia).length;
  const unverifiedBalances = withBalance.filter((row) => isBalanceUnverified(row.agreement)).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Parcelamentos {sphere.plural.toLowerCase()}</h3>
        <Link to={createPageUrl(sphere.page)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
          Ver lista <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {sphereRows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Nenhum parcelamento {sphere.label.toLowerCase()} cadastrado.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ativos</dt>
            <dd className="text-xl font-bold tabular-nums text-slate-900">{active.length}</dd>
            {others.length ? (
              <dd className="text-[11px] text-slate-500">
                {others.map((item) => `${item.count} ${AGREEMENT_STATUS_LABELS[item.status].toLowerCase()}`).join(" · ")}
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Saldo informado dos ativos</dt>
            <dd className="text-xl font-bold tabular-nums text-slate-900">{withBalance.length ? formatMoney(total) : "—"}</dd>
            <dd className="text-[11px] text-slate-500">
              {withBalance.length
                ? oldest === newest
                  ? `data-base ${formatCivilDate(oldest)}`
                  : `datas-base de ${formatCivilDate(oldest)} a ${formatCivilDate(newest)}`
                : "nenhum saldo informado"}
              {unverifiedBalances ? ` · ${unverifiedBalances} ${unverifiedBalances === 1 ? "saldo não conferido" : "saldos não conferidos"}` : ""}
              {active.length > withBalance.length
                ? ` · ${active.length - withBalance.length} sem saldo informado`
                : ""}
            </dd>
          </div>
          <div className="col-span-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            Informado manualmente
            {neverChecked ? ` · ${neverChecked} ${neverChecked === 1 ? "acordo nunca conferido" : "acordos nunca conferidos"}` : ""}
          </div>
        </dl>
      )}
    </div>
  );
}

function UpcomingInstallments({ rows, today }) {
  const upcoming = rows
    .filter((row) => row.agreement.situacao === "ativo")
    .flatMap((row) =>
      row.installments
        .filter((item) => item.situacao === "em_aberto" && item.vencimento >= today)
        .map((item) => ({ item, row }))
    )
    .sort((a, b) => a.item.vencimento.localeCompare(b.item.vencimento))
    .slice(0, UPCOMING_LIMIT);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Próximas parcelas a vencer</h3>
        <p className="text-xs text-slate-500">Parcelas a vencer dos parcelamentos ativos, a partir de hoje. Dados informados manualmente.</p>
      </div>
      {upcoming.length === 0 ? (
        <p className="p-6 text-center text-xs text-slate-500">Nenhuma parcela a vencer.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {upcoming.map(({ item, row }) => (
            <li key={item.id}>
              <Link
                to={listUrl(PAGE_BY_SPHERE[row.agreement.esfera], { acordo: row.agreement.id })}
                className="flex flex-col gap-1 px-4 py-2.5 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{row.entityName}</p>
                  <p className="text-xs text-slate-500">
                    {row.agreement.orgao}
                    {row.agreement.uf ? ` · ${row.agreement.uf}` : ""} · nº {row.agreement.codigo_parcelamento} · parcela {item.numero_parcela}
                  </p>
                  <ProvenanceNote origem={item.origem_dado} ultimaConferencia={row.agreement.ultima_conferencia} />
                </div>
                <div className="shrink-0 text-left sm:text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{formatMoney(item.valor)}</p>
                  <p className="text-xs tabular-nums text-slate-600">vence {formatCivilDate(item.vencimento)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function TaxOverviewPanel() {
  const { rows, today, isLoading, error, refetch } = useTaxPortfolio();

  if (isLoading) return <TaxLoadingState />;
  if (error) return <TaxErrorState message={error.message} onRetry={refetch} />;

  if (rows.length === 0) {
    return (
      <TaxEmptyState title="Nenhum parcelamento cadastrado ainda">
        <p>
          Cadastre os acordos em{" "}
          <Link to={createPageUrl("TaxFederal")} className="font-medium text-slate-700 underline">Parcelamentos Federais</Link> ou{" "}
          <Link to={createPageUrl("TaxState")} className="font-medium text-slate-700 underline">Parcelamentos Estaduais</Link>. Esta tela
          passa a mostrar quais estão em dia, a data da última conferência de cada um e a procedência da informação.
        </p>
      </TaxEmptyState>
    );
  }

  const inactive = rows.filter((row) => row.agreement.situacao !== "ativo").length;

  return (
    <div className="space-y-4">
      <div>
        <SignalCards rows={rows} />
        <p className="mt-2 text-[11px] text-slate-500">
          Contagem dos parcelamentos ativos. “Desatualizado” vale para quem nunca foi conferido no e-CAC/portal ou não é conferido há mais
          de {STALE_AFTER_DAYS} dias, independentemente do que os dados registrados indicam.
          {inactive ? ` ${inactive} ${inactive === 1 ? "parcelamento quitado, rescindido ou suspenso não entra" : "parcelamentos quitados, rescindidos ou suspensos não entram"} na contagem.` : ""}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {SPHERES.map((sphere) => <SphereSummary key={sphere.key} sphere={sphere} rows={rows} />)}
      </div>
      <UpcomingInstallments rows={rows} today={today} />
    </div>
  );
}
