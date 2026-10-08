import React, { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/taxLabels";
import { installmentCount, monthName } from "@/lib/taxPlanning";
import TaxPlanningInstallment from "./TaxPlanningInstallment";

const OVERDUE_PREVIEW = 5;

function SummaryCard({ label, value, tone = "slate", children }) {
  const toneClass = { slate: "text-slate-900", emerald: "text-emerald-700", indigo: "text-indigo-700", amber: "text-amber-800" }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1.5 text-xl font-bold tabular-nums sm:text-2xl", toneClass)}>{value}</p>
      {children ? <div className="mt-1 space-y-0.5 text-xs text-slate-500">{children}</div> : null}
    </div>
  );
}

/** Totais do período: a pagar (com guia × estimado) e pago, cada um com quantas parcelas o compõem. */
export function TaxPlanningTotals({ data }) {
  const due = data.totais.a_pagar;
  const paid = data.totais.pago;
  const period = `${monthName(data.periodo.inicio)} a ${monthName(data.periodo.fim).toLowerCase()}`;
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="A pagar no período" value={formatMoney(due.total)}>
          <p>{installmentCount(due.parcelas)} a vencer, de hoje em diante</p>
        </SummaryCard>
        <SummaryCard label="Com guia" value={formatMoney(due.com_guia)} tone="indigo">
          <p>{installmentCount(due.parcelas_com_guia)} com o valor da guia vinculada</p>
        </SummaryCard>
        <SummaryCard label="Estimado (sem guia)" value={formatMoney(due.estimado)} tone="amber">
          <p>{installmentCount(due.parcelas_estimadas)} pelo valor cadastrado; pode subir com a correção até a guia</p>
        </SummaryCard>
        <SummaryCard label="Pago no período" value={formatMoney(paid.total)} tone="emerald">
          <p>{installmentCount(paid.parcelas)} paga{paid.parcelas === 1 ? "" : "s"}, pelo mês do vencimento</p>
          {paid.parcelas_sem_valor ? (
            <p className="font-medium text-amber-800">
              {paid.parcelas_sem_valor === 1
                ? "1 paga sem valor informado, fora da soma"
                : `${paid.parcelas_sem_valor} pagas sem valor informado, fora da soma`}
            </p>
          ) : null}
        </SummaryCard>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Período: {period}. Só parcelamentos ativos. O pago não entra no a pagar, e as parcelas vencidas ficam no quadro abaixo, fora
        dessas somas.
      </p>
    </div>
  );
}

/**
 * Parcelas vencidas e não pagas (qualquer data, mesmo fora do período), à parte e nunca somadas a mês nenhum.
 * "Nenhuma vencida" só aparece porque a leitura deu certo — com erro a tela inteira mostra o erro.
 */
export function TaxPlanningOverdue({ vencidas, today }) {
  const [showAll, setShowAll] = useState(false);
  const items = vencidas.parcelas;
  const due = vencidas.a_pagar;
  if (items.length === 0) {
    return (
      <section className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Nenhuma parcela vencida em aberto</h3>
          <p className="text-xs text-slate-500">Com os filtros escolhidos, não há parcela de parcelamento ativo vencida e não paga.</p>
        </div>
      </section>
    );
  }
  const visible = showAll ? items : items.slice(0, OVERDUE_PREVIEW);
  return (
    <section className="rounded-xl border border-rose-300 bg-white">
      <div className="flex flex-col gap-2 border-b border-rose-100 bg-rose-50 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-rose-800">
              {items.length === 1 ? "1 parcela vencida e não paga" : `${items.length} parcelas vencidas e não pagas`}
            </h3>
            <p className="text-xs text-rose-700">
              Contadas à parte, de qualquer data, mesmo fora do período. Não entram no a pagar de nenhum mês.
            </p>
          </div>
        </div>
        <div className="pl-7 sm:pl-0 sm:text-right">
          <p className="text-xl font-bold tabular-nums text-rose-700">{formatMoney(due.total)}</p>
          <p className="text-[11px] text-rose-700">
            {formatMoney(due.com_guia)} com guia · {formatMoney(due.estimado)} estimado
          </p>
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {visible.map((item) => (
          <li key={item.id}>
            <TaxPlanningInstallment item={item} today={today} />
          </li>
        ))}
      </ul>
      {items.length > OVERDUE_PREVIEW ? (
        <div className="border-t border-slate-100 p-2 text-center">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Mostrar menos" : `Mostrar todas as ${items.length}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
