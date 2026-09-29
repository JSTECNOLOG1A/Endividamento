import React, { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import PreImplantationBanner from "@/components/accounting/PreImplantationBanner";
import { combineGuaranteeLabel } from "@/lib/contractOptions";

const fmtBRL = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtPct = (v) => `${(Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const CHART_COLORS = ["#155EEF", "#0EA5E9", "#7C3AED", "#0D9488", "#D97706", "#DB2777", "#4338CA", "#059669"];

// Dropdown de data-base: sempre fim de mês, dos últimos 36 meses até o atual — o mês em curso é marcado
// como provisório (a posição nele é projetada, não fechada). Gerado no front pra não precisar de uma
// chamada só pra listar competências — qualquer fim de mês é uma data-base válida, o motor recalcula ao vivo.
function monthEndOptions() {
  const out = [];
  const today = new Date();
  for (let i = 0; i < 36; i++) {
    const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    const iso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    const provisional = end >= today;
    const label = end.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    out.push({ value: iso, label: `${label.charAt(0).toUpperCase()}${label.slice(1)}${provisional ? " (em curso, provisório)" : ""}` });
  }
  return out;
}
const DATA_BASE_OPTIONS = monthEndOptions();
const DEFAULT_DATA_BASE = DATA_BASE_OPTIONS.find((o) => !o.label.includes("em curso"))?.value || DATA_BASE_OPTIONS[1]?.value || DATA_BASE_OPTIONS[0].value;

function IndicatorCard({ label, value, sub, tone = "slate" }) {
  const toneClass = { slate: "text-slate-900", red: "text-red-700", amber: "text-amber-700" }[tone] || "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

// Uma barra por bucket (banco ou garantia); clicar abre a lista de contratos daquele bucket embaixo — é o
// drill-down "do consolidado até a origem do número". Guardado na URL (?drill=banco:<label>) pra dar pra
// compartilhar o link e voltar pelo botão do navegador sem perder o estado.
function DrilldownBarChart({ data, drillKey, activeLabel, onSelect }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-400">Sem dados para esta data-base</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => fmtBRL(v)} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => fmtBRL(v)} />
        <Bar dataKey="total" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => onSelect(d.label)}>
          {data.map((entry, i) => (
            <Cell key={entry.label} fill={CHART_COLORS[i % CHART_COLORS.length]} opacity={activeLabel && activeLabel !== entry.label ? 0.35 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DrilldownContracts({ bucket, onClose }) {
  if (!bucket) return null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">Contratos em "{bucket.label}"</p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-1">
        {(bucket.contracts || []).map((c) => (
          <a
            key={c.contractId}
            href={`${createPageUrl("Simulator")}?edit=${c.contractId}`}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-white"
          >
            <span className="text-slate-700">{c.contractNumber}</span>
            <span className="flex items-center gap-1.5 font-medium tabular-nums text-slate-900">
              {fmtBRL(c.total)} <ExternalLink className="h-3 w-3 text-slate-400" />
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function DashboardView() {
  const [params, setParams] = useSearchParams();
  const entityId = params.get("entity") || "all";
  const dataBase = params.get("data_base") || DEFAULT_DATA_BASE;
  const drillBanco = params.get("drill_banco") || "";
  const drillGarantia = params.get("drill_garantia") || "";

  const { data: entities = [] } = useQuery({
    queryKey: ["dashboard-entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 200),
    initialData: [],
  });

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["dashboard-summary", entityId, dataBase],
    queryFn: () => base44.dashboard.getSummary(entityId, dataBase),
    enabled: Boolean(dataBase),
  });

  const bancoBucket = useMemo(() => summary?.indicators?.concentracaoPorBanco?.find((b) => b.label === drillBanco) || null, [summary, drillBanco]);
  const garantiaData = useMemo(
    () => (summary?.indicators?.garantias || []).map((g) => ({ ...g, label: combineGuaranteeLabel(g.realType, g.personalType) })),
    [summary]
  );
  const garantiaBucket = useMemo(() => garantiaData.find((g) => g.label === drillGarantia) || null, [garantiaData, drillGarantia]);

  return (
    <div className="w-full px-4 sm:px-6 py-8" data-tour="dashboard-workspace">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-600 mt-0.5">Posição consolidada da dívida, numa data-base à sua escolha.</p>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">Empresa</label>
          <select
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
            value={entityId}
            onChange={(e) => setParam("entity", e.target.value === "all" ? null : e.target.value)}
          >
            <option value="all">Todas (consolidado)</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.entity_name}</option>)}
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">Data-base</label>
          <select
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
            value={dataBase}
            onChange={(e) => setParam("data_base", e.target.value)}
          >
            {DATA_BASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {entityId !== "all" ? <PreImplantationBanner entityId={entityId} className="mb-5" /> : <PreImplantationBanner className="mb-5" />}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>
      ) : isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Calculando a posição…</div>
      ) : summary?.blocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-600" />
          <p className="text-sm font-medium text-amber-900">
            {entityId === "all" ? "Nenhuma empresa liberada para o Dashboard ainda." : "Esta empresa está aguardando a implantação de saldos."}
          </p>
          <p className="mt-1 text-xs text-amber-800">O Dashboard só mostra números depois que a implantação de saldos é aplicada.</p>
        </div>
      ) : summary?.indicators ? (
        <>
          {summary.skippedContracts?.length ? (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {summary.skippedContracts.length} contrato(s) em moeda estrangeira ficaram fora da conta — falta a PTAX da data-base (cadastre em Indexadores e Feriados).
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <IndicatorCard label="Saldo total atualizado da dívida" value={fmtBRL(summary.indicators.saldoTotal)} sub={`Data-base: ${new Date(dataBase + "T12:00:00").toLocaleDateString("pt-BR")}`} />
            <IndicatorCard label="Principal em aberto" value={fmtBRL(summary.indicators.principalEmAberto)} />
            <IndicatorCard label="Juros e encargos acumulados" value={fmtBRL(summary.indicators.jurosEncargosAcumulados)} />
            <IndicatorCard
              label="Exposição cambial"
              value={fmtBRL(summary.indicators.exposicaoCambial.valor)}
              sub={`${fmtPct(summary.indicators.exposicaoCambial.percentual)} do saldo total`}
              tone={summary.indicators.exposicaoCambial.percentual > 30 ? "amber" : "slate"}
            />
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vencimentos, a partir da data-base</p>
            <div className="mt-2 grid grid-cols-3 divide-x divide-slate-100">
              {[["30 dias", summary.indicators.vencimentos.d30], ["90 dias", summary.indicators.vencimentos.d90], ["180 dias", summary.indicators.vencimentos.d180]].map(([label, value]) => (
                <div key={label} className="px-3 text-center first:pl-0">
                  <p className="text-[11px] text-slate-500">{label}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{fmtBRL(value)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Concentração por banco</p>
              <DrilldownBarChart
                data={summary.indicators.concentracaoPorBanco}
                activeLabel={drillBanco}
                onSelect={(label) => setParam("drill_banco", label === drillBanco ? null : label)}
              />
              <DrilldownContracts bucket={bancoBucket} onClose={() => setParam("drill_banco", null)} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Principais garantias</p>
              <DrilldownBarChart
                data={garantiaData}
                activeLabel={drillGarantia}
                onSelect={(label) => setParam("drill_garantia", label === drillGarantia ? null : label)}
              />
              <DrilldownContracts bucket={garantiaBucket} onClose={() => setParam("drill_garantia", null)} />
              <p className="mt-2 text-[11px] leading-snug text-slate-400">
                Cada combinação de garantia (real + pessoal) forma seu próprio grupo — um contrato com duas garantias conta uma vez só, no grupo combinado, não nos dois separados. É o volume do contrato, não o valor avaliado da garantia em si (esse dado ainda não existe no cadastro).
              </p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
