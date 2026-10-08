import React, { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/taxLabels";
import { PLANNING_BREAKDOWNS, installmentCount, monthName, shortMonthLabel } from "@/lib/taxPlanning";

function DueCell({ due, compact = false }) {
  if (!due.parcelas) return <span className="text-slate-300">—</span>;
  return (
    <span className="block leading-tight">
      <span className="block font-semibold tabular-nums text-slate-900">{formatMoney(due.total)}</span>
      {due.estimado ? (
        <span className={cn("block whitespace-nowrap text-[11px] text-amber-800", compact && "text-[10px]")}>
          {formatMoney(due.estimado)} estimado
        </span>
      ) : null}
    </span>
  );
}

function PaidCell({ paid }) {
  if (!paid.parcelas) return <span className="text-slate-300">—</span>;
  return (
    <span className="block leading-tight">
      <span className="block tabular-nums text-emerald-700">{formatMoney(paid.total)}</span>
      {paid.parcelas_sem_valor ? (
        <span className="block whitespace-nowrap text-[10px] text-amber-800">{paid.parcelas_sem_valor} sem valor</span>
      ) : null}
    </span>
  );
}

function OverdueCell({ due }) {
  if (!due.parcelas) return <span className="text-slate-300">—</span>;
  return (
    <span className="block leading-tight">
      <span className="block font-semibold tabular-nums text-rose-700">{formatMoney(due.total)}</span>
      <span className="block text-[11px] text-rose-600">{installmentCount(due.parcelas)}</span>
    </span>
  );
}

/** Celular: um cartão por linha do recorte, com os totais e os meses que têm valor. */
function BreakdownCards({ rows }) {
  return (
    <ul className="space-y-2 md:hidden">
      {rows.map((row) => {
        const months = row.meses.filter((month) => month.a_pagar.parcelas || month.pago.parcelas);
        return (
          <li key={row.chave ?? "sem-chave"} className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-900">{row.label}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-[11px] text-slate-500">A pagar</dt>
                <dd><DueCell due={row.a_pagar} compact /></dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Vencidas</dt>
                <dd><OverdueCell due={row.vencidas} /></dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Pago</dt>
                <dd><PaidCell paid={row.pago} /></dd>
              </div>
            </dl>
            {months.length ? (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-slate-600">Ver por mês</summary>
                <ul className="mt-1 divide-y divide-slate-100">
                  {months.map((month) => (
                    <li key={month.mes} className="flex items-start justify-between gap-3 py-1.5">
                      <span className="text-slate-700">{monthName(month.mes)}</span>
                      <span className="text-right">
                        <DueCell due={month.a_pagar} compact />
                        {month.pago.parcelas ? <span className="block text-[11px] text-emerald-700">pago {formatMoney(month.pago.total)}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Tela larga: tabela com totais e o a pagar de cada mês (a tabela rola dentro do quadro, não a página). */
function BreakdownTable({ rows, column, meses }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-xs">
        <thead className="border-b-2 border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="sticky left-0 z-10 min-w-[200px] bg-slate-50 px-3 py-2 font-semibold">{column}</th>
            <th className="px-3 py-2 font-semibold">A pagar</th>
            <th className="px-3 py-2 font-semibold">Vencidas</th>
            <th className="px-3 py-2 font-semibold">Pago</th>
            {meses.map((month) => (
              <th key={month.mes} className="whitespace-nowrap px-3 py-2 text-right font-semibold" title={monthName(month.mes)}>
                {shortMonthLabel(month.mes)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.chave ?? "sem-chave"} className="align-top">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-900">{row.label}</td>
              <td className="px-3 py-2"><DueCell due={row.a_pagar} /></td>
              <td className="px-3 py-2"><OverdueCell due={row.vencidas} /></td>
              <td className="px-3 py-2"><PaidCell paid={row.pago} /></td>
              {row.meses.map((month) => (
                <td key={month.mes} className="px-3 py-2 text-right">
                  <DueCell due={month.a_pagar} compact />
                  {month.pago.parcelas ? (
                    <span className="block whitespace-nowrap text-[10px] text-emerald-700">pago {formatMoney(month.pago.total)}</span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Recortes do período por empresa, esfera, tributo, órgão e parcelamento, com o total de cada mês. */
export default function TaxPlanningBreakdown({ data }) {
  const [active, setActive] = useState(PLANNING_BREAKDOWNS[0].key);
  const breakdown = PLANNING_BREAKDOWNS.find((item) => item.key === active) || PLANNING_BREAKDOWNS[0];
  const rows = data[breakdown.key] || [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Por recorte</h3>
          <p className="text-xs text-slate-500">Totais do período e o a pagar de cada mês. Vencidas e pago aparecem à parte.</p>
        </div>
        <Tabs value={active} onValueChange={setActive}>
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 sm:w-auto">
            {PLANNING_BREAKDOWNS.map((item) => (
              <TabsTrigger key={item.key} value={item.key} className="text-xs">
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="p-3 md:p-0">
        {rows.length ? (
          <>
            <BreakdownCards rows={rows} />
            <BreakdownTable rows={rows} column={breakdown.column} meses={data.meses} />
          </>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">Nenhuma parcela para mostrar neste recorte.</p>
        )}
      </div>
    </section>
  );
}
