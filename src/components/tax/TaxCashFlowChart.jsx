import React, { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/taxLabels";
import { ESTIMATE_EXPLANATION, cashFlowSeries, installmentCount } from "@/lib/taxPlanning";

// Mesmas cores dos selos: guia em índigo, pago em verde. O estimado é o mesmo índigo, claro e listrado, para se ler
// como "parte do a pagar, mas ainda sem a guia".
const COLORS = { comGuia: "#4338CA", estimadoFill: "#C7D2FE", estimadoStroke: "#6366F1", pago: "#059669" };
const ESTIMATE_PATTERN = "tax-estimate-stripes";

const compactMoney = (value) =>
  (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-md">
      <p className="mb-1 font-semibold text-slate-900">{point.nome}</p>
      <p className="text-slate-700">
        A pagar: <span className="font-semibold tabular-nums">{formatMoney(point.a_pagar)}</span>
        <span className="text-slate-500"> ({installmentCount(point.parcelas_a_pagar)})</span>
      </p>
      <p className="pl-2 text-indigo-700">com guia {formatMoney(point.com_guia)}</p>
      <p className="pl-2 text-amber-800">estimado {formatMoney(point.estimado)}</p>
      <p className="mt-1 text-emerald-700">Pago: {formatMoney(point.pago)}</p>
      {point.parcelas_pagas_sem_valor ? (
        <p className="text-amber-800">{installmentCount(point.parcelas_pagas_sem_valor)} paga(s) sem valor informado</p>
      ) : null}
    </div>
  );
}

function LegendItem({ swatch, children }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

/** Fluxo de caixa: por mês, o a pagar (com guia + estimado, empilhados) e, ao lado, o já pago. */
export default function TaxCashFlowChart({ meses }) {
  const data = useMemo(() => cashFlowSeries(meses), [meses]);
  const hasValues = data.some((point) => point.a_pagar > 0 || point.pago > 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Fluxo de caixa por mês</h3>
      <p className="text-xs text-slate-500">Quanto sai em cada mês do período. Parcelas vencidas não entram: estão no quadro das vencidas.</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <LegendItem swatch={<span className="h-3 w-3 rounded-sm" style={{ background: COLORS.comGuia }} aria-hidden="true" />}>
          A pagar com guia
        </LegendItem>
        <LegendItem
          swatch={
            <span
              className="h-3 w-3 rounded-sm border border-dashed"
              style={{
                borderColor: COLORS.estimadoStroke,
                background: `repeating-linear-gradient(45deg, ${COLORS.estimadoFill} 0 2px, #fff 2px 4px)`,
              }}
              aria-hidden="true"
            />
          }
        >
          A pagar estimado (sem guia)
        </LegendItem>
        <LegendItem swatch={<span className="h-3 w-3 rounded-sm" style={{ background: COLORS.pago }} aria-hidden="true" />}>Pago</LegendItem>
      </div>
      {hasValues ? (
        <div className="sr-only">
          <table>
            <caption>Fluxo de caixa por mês: a pagar com guia, a pagar estimado e pago</caption>
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col">A pagar com guia</th>
                <th scope="col">A pagar estimado (sem guia)</th>
                <th scope="col">Pago</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.mes}>
                  <th scope="row">{point.nome}</th>
                  <td>{formatMoney(point.com_guia)}</td>
                  <td>{formatMoney(point.estimado)}</td>
                  <td>{formatMoney(point.pago)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {hasValues ? (
        <div className="mt-2 h-64 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} barGap={2}>
              <defs>
                <pattern id={ESTIMATE_PATTERN} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="#fff" />
                  <rect width="3" height="6" fill={COLORS.estimadoFill} />
                </pattern>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11 }} width={76} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
              <Bar dataKey="com_guia" name="A pagar com guia" stackId="a_pagar" fill={COLORS.comGuia} />
              <Bar
                dataKey="estimado"
                name="A pagar estimado"
                stackId="a_pagar"
                fill={`url(#${ESTIMATE_PATTERN})`}
                stroke={COLORS.estimadoStroke}
                strokeDasharray="3 2"
                radius={[3, 3, 0, 0]}
              />
              <Bar dataKey="pago" name="Pago" fill={COLORS.pago} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-slate-400">Nenhum valor a pagar ou pago nos meses do período.</p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-slate-500">{ESTIMATE_EXPLANATION}</p>
    </section>
  );
}
