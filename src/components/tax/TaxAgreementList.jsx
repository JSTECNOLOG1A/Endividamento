import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatCivilDate } from "@/lib/taxDates";
import { SIGNAL_ORDER, isBalanceUnverified } from "@/lib/taxSignal";
import { AGREEMENT_STATUS_OPTIONS, INSTALLMENT_OVERDUE_LABEL, formatMoney, isInstallmentOverdue } from "@/lib/taxLabels";
import { amountComesFromGuide, amountToPay, isGuideException } from "@/lib/taxGuides";
import { ProvenanceNote, TaxSignalBadge, statusKeyLabel } from "./TaxBadges";
import { TaxEmptyState } from "./TaxPageShell";

const STATUS_FILTER_OPTIONS = [
  ...SIGNAL_ORDER.map((key) => ({ value: key, label: statusKeyLabel(key) })),
  ...AGREEMENT_STATUS_OPTIONS.filter((item) => item.value !== "ativo"),
];

const STATUS_RANK = Object.fromEntries(STATUS_FILTER_OPTIONS.map((item, index) => [item.value, index]));

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function matchesSearch(row, term) {
  if (!term) return true;
  const { agreement } = row;
  return [row.entityName, agreement.orgao, agreement.uf, agreement.modalidade, agreement.tributo, agreement.codigo_parcelamento]
    .some((value) => normalize(value).includes(term));
}

export function SaldoCell({ agreement }) {
  if (agreement.saldo_oficial === null || agreement.saldo_oficial === undefined) {
    return <span className="text-xs text-slate-400">Saldo não informado</span>;
  }
  return (
    <div className="leading-tight">
      <p className="font-semibold tabular-nums text-slate-900">{formatMoney(agreement.saldo_oficial)}</p>
      <p className="text-[11px] text-slate-500">data-base {formatCivilDate(agreement.saldo_data_base)}</p>
      {isBalanceUnverified(agreement) ? <p className="text-[11px] font-medium text-amber-700">saldo não conferido</p> : null}
    </div>
  );
}

/** Próxima parcela em aberto com o valor para pagamento: o da guia, quando há; senão o cadastrado (estimado). */
export function NextInstallmentCell({ installment, guide, today }) {
  if (!installment) return <span className="text-xs text-slate-400">Nenhuma parcela a vencer ou vencida</span>;
  const overdue = isInstallmentOverdue(installment, today);
  const fromGuide = amountComesFromGuide(guide);
  return (
    <div className="leading-tight">
      <p className={cn("tabular-nums", overdue ? "font-semibold text-rose-700" : "text-slate-800")}>
        {formatCivilDate(installment.vencimento)}
        {overdue ? ` · ${INSTALLMENT_OVERDUE_LABEL}` : ""}
      </p>
      <p className="text-[11px] text-slate-500">
        Parcela {installment.numero_parcela} · {formatMoney(amountToPay(installment, guide))}
        {fromGuide ? " a pagar" : ""}
      </p>
      {fromGuide ? <p className="text-[11px] text-slate-400">estimado {formatMoney(installment.valor)}</p> : null}
      {isGuideException(guide) ? <p className="text-[11px] font-medium text-amber-800">guia em exceção</p> : null}
    </div>
  );
}

function RowActions({ row, actions }) {
  if (!actions.canWrite) return null;
  const confirmedToday = row.agreement.ultima_conferencia === actions.today;
  const stop = (handler) => (event) => {
    event.stopPropagation();
    handler(row);
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title={confirmedToday ? `Conferido hoje no ${actions.portalName}` : `Conferi hoje no ${actions.portalName}`}
        aria-label={`Conferi hoje no ${actions.portalName}`}
        disabled={confirmedToday || actions.confirmingId === row.agreement.id}
        onClick={stop(actions.onConfirmToday)}
      >
        <CalendarCheck className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Editar" aria-label="Editar parcelamento" onClick={stop(actions.onEdit)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-rose-600 hover:text-rose-700"
        title="Excluir"
        aria-label="Excluir parcelamento"
        onClick={stop(actions.onDelete)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function agencyLabel(agreement) {
  return agreement.uf ? `${agreement.orgao} · ${agreement.uf}` : agreement.orgao;
}

export default function TaxAgreementList({ esfera, rows, entities, actions, statusFilter, onStatusFilterChange }) {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("todas");
  const isState = esfera === "estadual";

  const usedEntities = useMemo(() => {
    const ids = new Set(rows.map((row) => row.agreement.entity_id));
    return entities.filter((item) => ids.has(item.id)).sort((a, b) => a.entity_name.localeCompare(b.entity_name, "pt-BR"));
  }, [rows, entities]);

  const visible = useMemo(() => {
    const term = normalize(search.trim());
    return rows
      .filter((row) => entityFilter === "todas" || row.agreement.entity_id === entityFilter)
      .filter((row) => statusFilter === "todas" || row.statusKey === statusFilter)
      .filter((row) => matchesSearch(row, term))
      .sort(
        (a, b) =>
          (STATUS_RANK[a.statusKey] ?? 99) - (STATUS_RANK[b.statusKey] ?? 99) ||
          a.entityName.localeCompare(b.entityName, "pt-BR")
      );
  }, [rows, search, entityFilter, statusFilter]);

  const newButton = actions.canWrite ? (
    <Button type="button" onClick={actions.onCreate} className="gap-1.5">
      <Plus className="h-4 w-4" />
      Novo parcelamento
    </Button>
  ) : null;

  if (rows.length === 0) {
    return (
      <TaxEmptyState title={`Nenhum parcelamento ${isState ? "estadual" : "federal"} cadastrado`}>
        <p>
          Cadastre cada acordo com o número que aparece no {isState ? "portal da Fazenda estadual" : "e-CAC"}, a empresa, o órgão e a
          modalidade. Depois inclua as parcelas ou gere todas de uma vez.
        </p>
        {newButton ? <div className="mt-4">{newButton}</div> : null}
      </TaxEmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por empresa, órgão, modalidade, tributo ou número"
            className="h-9 bg-white pl-8"
            aria-label="Buscar parcelamentos"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex">
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="h-9 bg-white lg:w-56" aria-label="Filtrar por empresa"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as empresas</SelectItem>
              {usedEntities.map((item) => <SelectItem key={item.id} value={item.id}>{item.entity_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="h-9 bg-white lg:w-60" aria-label="Filtrar por situação"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as situações</SelectItem>
              {STATUS_FILTER_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {newButton}
      </div>

      <p className="text-xs text-slate-500">
        {visible.length} de {rows.length} {rows.length === 1 ? "parcelamento" : "parcelamentos"} · dados informados manualmente — confira
        no {isState ? "portal" : "e-CAC"} e registre a conferência.
      </p>

      {visible.length === 0 ? (
        <TaxEmptyState title="Nenhum parcelamento com esses filtros">Ajuste a busca, a empresa ou a situação.</TaxEmptyState>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {visible.map((row) => (
              <li key={row.agreement.id}>
                <div className="rounded-xl border border-slate-200 bg-white">
                  <Link to={actions.detailLink(row)} className="block rounded-t-xl p-3 pb-2 text-left hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{row.entityName}</p>
                        <p className="text-xs text-slate-600">{agencyLabel(row.agreement)} · nº {row.agreement.codigo_parcelamento}</p>
                        <p className="text-xs text-slate-500">
                          {row.agreement.modalidade}
                          {row.agreement.tributo ? ` · ${row.agreement.tributo}` : ""}
                        </p>
                      </div>
                      <TaxSignalBadge signal={row.signal} recordsSignal={row.recordsSignal} situacao={row.agreement.situacao} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <SaldoCell agreement={row.agreement} />
                      <NextInstallmentCell installment={row.nextInstallment} guide={row.nextInstallmentGuide} today={actions.today} />
                    </div>
                  </Link>
                  <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5">
                    <ProvenanceNote origem={row.agreement.origem_dado} ultimaConferencia={row.agreement.ultima_conferencia} />
                    <RowActions row={row} actions={actions} />
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="relative hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
            <table className="w-full min-w-[1080px] text-xs">
              <thead className="border-b-2 border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Empresa</th>
                  <th className="px-3 py-2 font-semibold">{isState ? "Órgão · UF" : "Órgão"}</th>
                  <th className="px-3 py-2 font-semibold">Modalidade · tributo</th>
                  <th className="px-3 py-2 font-semibold">Número</th>
                  <th className="px-3 py-2 font-semibold">Situação</th>
                  <th className="px-3 py-2 font-semibold">Saldo informado</th>
                  <th className="px-3 py-2 font-semibold">Próxima parcela</th>
                  <th className="px-3 py-2 font-semibold">Procedência</th>
                  <th className="px-3 py-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row) => (
                  <tr key={row.agreement.id} className="cursor-pointer align-top hover:bg-slate-50" onClick={() => actions.onOpen(row)}>
                    <td className="px-3 py-2.5 font-medium text-slate-900">{row.entityName}</td>
                    <td className="px-3 py-2.5 text-slate-700">{agencyLabel(row.agreement)}</td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {row.agreement.modalidade}
                      {row.agreement.tributo ? <span className="block text-[11px] text-slate-500">{row.agreement.tributo}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">
                      <Link
                        to={actions.detailLink(row)}
                        className="font-medium text-slate-900 underline-offset-2 hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.agreement.codigo_parcelamento}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <TaxSignalBadge signal={row.signal} recordsSignal={row.recordsSignal} situacao={row.agreement.situacao} />
                    </td>
                    <td className="px-3 py-2.5"><SaldoCell agreement={row.agreement} /></td>
                    <td className="px-3 py-2.5"><NextInstallmentCell installment={row.nextInstallment} guide={row.nextInstallmentGuide} today={actions.today} /></td>
                    <td className="px-3 py-2.5">
                      <ProvenanceNote origem={row.agreement.origem_dado} ultimaConferencia={row.agreement.ultima_conferencia} />
                    </td>
                    <td className="px-3 py-2.5"><RowActions row={row} actions={actions} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
