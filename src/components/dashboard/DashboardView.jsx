import React, { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { AlertTriangle, ExternalLink, X, ChevronRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import PreImplantationBanner from "@/components/accounting/PreImplantationBanner";
import { combineGuaranteeLabel, OPERATION_TYPES } from "@/lib/contractOptions";

const fmtBRL = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtPct = (v) => `${(Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const CHART_COLORS = ["#155EEF", "#0EA5E9", "#7C3AED", "#0D9488", "#D97706", "#DB2777", "#4338CA", "#059669"];
const OPERATION_TYPE_LABELS = Object.fromEntries(Object.values(OPERATION_TYPES).flat().map((o) => [o.value, o.label]));

// Dropdown de data-base: fim de mês, dos últimos 36 meses até 24 meses pra frente — o mês em curso é
// marcado como provisório (posição projetada, não fechada) e os futuros como projetados (o cronograma já
// existente é que sustenta a projeção; contratos ainda não aprovados não entram). Gerado no front pra não
// precisar de uma chamada só pra listar competências — qualquer fim de mês é uma data-base válida, o motor
// recalcula ao vivo, pra trás ou pra frente.
const FUTURE_MONTHS = 24;
const PAST_MONTHS = 36;
function monthEndOptions() {
  const out = [];
  const today = new Date();
  const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  for (let i = -FUTURE_MONTHS; i < PAST_MONTHS; i++) {
    const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    const iso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    const isCurrent = end.getFullYear() === currentMonthEnd.getFullYear() && end.getMonth() === currentMonthEnd.getMonth();
    const isFuture = end.getTime() > currentMonthEnd.getTime();
    const label = end.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const suffix = isCurrent ? " (em curso, provisório)" : isFuture ? " (projetado)" : "";
    out.push({ value: iso, label: `${label.charAt(0).toUpperCase()}${label.slice(1)}${suffix}` });
  }
  return out;
}
const DATA_BASE_OPTIONS = monthEndOptions();
const DEFAULT_DATA_BASE = DATA_BASE_OPTIONS.find((o) => !o.label.includes("em curso") && !o.label.includes("projetado"))?.value || DATA_BASE_OPTIONS[0].value;

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

// Pizza simples (bancos, moeda): legenda embaixo em vez de rótulo na própria fatia — mais legível no
// celular, onde não há espaço pra texto ao lado de cada pedaço.
function SimplePieChart({ data }) {
  if (!data?.length) return <p className="py-8 text-center text-sm text-slate-400">Sem dados para esta data-base</p>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="label" cx="50%" cy="50%" outerRadius={80} paddingAngle={1}>
          {data.map((entry, i) => <Cell key={entry.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => fmtBRL(v)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Donut de dois anéis: categoria por dentro, tipo de operação por fora — a "derivação" pedida, sem
// precisar clicar. Os dois anéis usam o MESMO total (a soma dos tipos de cada categoria é a categoria),
// então os ângulos batem exatamente: cada fatia de tipo fica encostada na fatia da sua categoria.
function CategoriaTipoDonut({ data }) {
  const outerData = useMemo(
    () => (data || []).flatMap((c) => c.tipos.map((t) => ({ ...t, label: OPERATION_TYPE_LABELS[t.type] || t.label, categoryLabel: c.label }))),
    [data]
  );
  if (!data?.length) return <p className="py-8 text-center text-sm text-slate-400">Sem dados para esta data-base</p>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="label" cx="50%" cy="50%" innerRadius={38} outerRadius={68} paddingAngle={1}>
          {data.map((entry, i) => <Cell key={entry.category} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Pie data={outerData} dataKey="total" nameKey="label" cx="50%" cy="50%" innerRadius={72} outerRadius={98} paddingAngle={1}>
          {outerData.map((entry, i) => <Cell key={`${entry.type}-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.55} />)}
        </Pie>
        <Tooltip formatter={(v, n, p) => [fmtBRL(v), p?.payload?.categoryLabel ? `${n} (${p.payload.categoryLabel})` : n]} />
        <Legend wrapperStyle={{ fontSize: 11 }} payload={data.map((c, i) => ({ value: c.label, type: "square", color: CHART_COLORS[i % CHART_COLORS.length] }))} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Quadro de CET escalonado: banco → categoria → tipo de operação. Cada nível mostra a MÉDIA PONDERADA
// pelo saldo devedor atual (não a média simples, nem o valor contratado) — clicar numa linha desce um
// nível; a trilha no topo volta pra qualquer nível anterior. Estado na URL (igual aos outros drill-downs
// desta tela), pra dar pra compartilhar o link já aberto no nível certo.
function CetDrilldownPanel({ cetPorBanco, drillBanco, drillCategoria, setParam }) {
  const bankNode = (cetPorBanco || []).find((b) => b.label === drillBanco) || null;
  const catNode = bankNode?.categorias.find((c) => c.category === drillCategoria) || null;

  const selectBanco = (label) => { setParam("drill_cet_banco", label); setParam("drill_cet_categoria", null); };
  const selectCategoria = (category) => setParam("drill_cet_categoria", category);
  const goToBancos = () => { setParam("drill_cet_banco", null); setParam("drill_cet_categoria", null); };
  const goToCategorias = () => setParam("drill_cet_categoria", null);

  let rows = [];
  let onSelectRow = null;
  let emptyMsg = "Sem contratos com CET calculado nesta data-base.";
  if (catNode) {
    rows = catNode.tipos.map((t) => ({ key: t.type, label: OPERATION_TYPE_LABELS[t.type] || t.label, cetPercent: t.cetPercent, saldoBase: t.saldoBase }));
  } else if (bankNode) {
    rows = bankNode.categorias.map((c) => ({ key: c.category, label: c.label, cetPercent: c.cetPercent, saldoBase: c.saldoBase }));
    onSelectRow = selectCategoria;
    emptyMsg = "Sem categorias.";
  } else {
    rows = (cetPorBanco || []).map((b) => ({ key: b.label, label: b.label, cetPercent: b.cetPercent, saldoBase: b.saldoBase }));
    onSelectRow = selectBanco;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">CET médio ponderado (por saldo atual)</p>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        <button type="button" onClick={goToBancos} className={bankNode ? "text-blue-600 hover:underline" : "font-medium text-slate-700"}>Bancos</button>
        {bankNode ? (
          <>
            <ChevronRight className="h-3 w-3 text-slate-400" />
            <button type="button" onClick={goToCategorias} className={catNode ? "text-blue-600 hover:underline" : "font-medium text-slate-700"}>{bankNode.label}</button>
          </>
        ) : null}
        {catNode ? (
          <>
            <ChevronRight className="h-3 w-3 text-slate-400" />
            <span className="font-medium text-slate-700">{catNode.label}</span>
          </>
        ) : null}
      </div>
      {rows.length ? (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              disabled={!onSelectRow}
              onClick={() => onSelectRow?.(r.key)}
              className={`flex w-full items-center justify-between gap-3 px-1 py-2 text-left text-sm ${onSelectRow ? "cursor-pointer hover:bg-slate-50" : ""}`}
            >
              <span className="flex items-center gap-1 text-slate-700">
                {r.label}
                {onSelectRow ? <ChevronRight className="h-3.5 w-3.5 text-slate-300" /> : null}
              </span>
              <span className="flex items-center gap-3 tabular-nums">
                <span className="text-xs text-slate-400">{fmtBRL(r.saldoBase)}</span>
                <span className="font-semibold text-slate-900">
                  {r.cetPercent != null ? `${r.cetPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% a.a.` : "—"}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-slate-400">{emptyMsg}</p>
      )}
    </div>
  );
}

export default function DashboardView() {
  const [params, setParams] = useSearchParams();
  const entityId = params.get("entity") || "all";
  const dataBase = params.get("data_base") || DEFAULT_DATA_BASE;
  const drillBanco = params.get("drill_banco") || "";
  const drillGarantia = params.get("drill_garantia") || "";
  const drillCetBanco = params.get("drill_cet_banco") || "";
  const drillCetCategoria = params.get("drill_cet_categoria") || "";

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

          <div className="mt-3">
            <CetDrilldownPanel
              cetPorBanco={summary.indicators.cetPorBanco}
              drillBanco={drillCetBanco}
              drillCategoria={drillCetCategoria}
              setParam={setParam}
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Bancos mais tomados (volume contratado)</p>
              <SimplePieChart data={summary.indicators.volumeContratado?.porBanco} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Volume por moeda</p>
              <SimplePieChart data={summary.indicators.volumeContratado?.porMoeda} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:col-span-2 lg:col-span-1">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Categorias mais tomadas, por tipo de operação</p>
              <CategoriaTipoDonut data={summary.indicators.volumeContratado?.porCategoria} />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-400">
            Volume contratado: soma do valor original das operações aprovadas até a data-base escolhida — diferente do saldo atual usado nos gráficos abaixo, mostra com quem/no quê a empresa mais tomou crédito, não quem ela mais deve hoje.
          </p>

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
