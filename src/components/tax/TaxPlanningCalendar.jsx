import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/taxLabels";
import { firstMonthWithInstallments, installmentCount, monthName } from "@/lib/taxPlanning";
import TaxPlanningInstallment from "./TaxPlanningInstallment";

function MonthTotals({ month }) {
  const due = month.a_pagar;
  const paid = month.pago;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
      {due.parcelas ? (
        <span>
          a pagar <span className="font-semibold tabular-nums text-slate-800">{formatMoney(due.total)}</span>
          {due.estimado ? <span className="text-amber-800"> · {formatMoney(due.estimado)} estimado</span> : null}
        </span>
      ) : null}
      {paid.parcelas ? (
        <span>
          pago <span className="font-semibold tabular-nums text-emerald-700">{formatMoney(paid.total)}</span>
          {paid.parcelas_sem_valor ? <span className="text-amber-800"> · {installmentCount(paid.parcelas_sem_valor)} sem valor informado</span> : null}
        </span>
      ) : null}
      {month.parcelas_vencidas ? (
        <span className="font-medium text-rose-700">
          {month.parcelas_vencidas === 1 ? "1 vencida, fora da soma" : `${month.parcelas_vencidas} vencidas, fora da soma`}
        </span>
      ) : null}
      {month.parcelas.length === 0 ? <span>nenhuma parcela</span> : null}
    </span>
  );
}

/**
 * Calendário: um bloco por mês do período, com as parcelas que vencem nele. Parcela vencida aparece no mês do
 * vencimento, mas não entra na soma do mês (está no bloco das vencidas).
 */
export default function TaxPlanningCalendar({ meses, today }) {
  const [open, setOpen] = useState(() => new Set([firstMonthWithInstallments(meses)].filter(Boolean)));
  const toggle = (mes) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(mes)) next.delete(mes);
      else next.add(mes);
      return next;
    });

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Calendário de vencimentos</h3>
        <p className="text-xs text-slate-500">Toque num mês para ver as parcelas que vencem nele.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {meses.map((month) => {
          const isOpen = open.has(month.mes);
          const hasItems = month.parcelas.length > 0;
          return (
            <li key={month.mes}>
              <button
                type="button"
                onClick={() => toggle(month.mes)}
                disabled={!hasItems}
                aria-expanded={hasItems ? isOpen : undefined}
                className={cn(
                  "flex w-full items-start justify-between gap-3 px-4 py-3 text-left",
                  hasItems ? "hover:bg-slate-50" : "cursor-default"
                )}
              >
                <span className="min-w-0 space-y-0.5">
                  <span className={cn("block text-sm font-medium", hasItems ? "text-slate-900" : "text-slate-400")}>
                    {monthName(month.mes)}
                    {hasItems ? <span className="font-normal text-slate-500"> · {installmentCount(month.parcelas.length)}</span> : null}
                  </span>
                  <MonthTotals month={month} />
                </span>
                {hasItems ? (
                  <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                ) : null}
              </button>
              {isOpen && hasItems ? (
                <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/60">
                  {month.parcelas.map((item) => (
                    <li key={item.id}>
                      <TaxPlanningInstallment item={item} today={today} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
