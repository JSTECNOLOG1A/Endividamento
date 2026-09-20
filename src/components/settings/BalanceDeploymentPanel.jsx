import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "@/lib/notify";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, AlertTriangle, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { OPERATION_CATEGORY_LABELS } from "@/lib/accountingClosing";

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

const ACCOUNT_FIELDS = [
  { key: "transitoria_account_id", label: "Conta transitória (contrapartida da abertura)" },
];

// Contas de passivo da abertura: quatro por categoria de operação (empréstimos, financiamentos...).
const CATEGORY_PARTS = [
  { key: "principal_cp", posKey: "principalCP", label: "Principal — circulante" },
  { key: "principal_lp", posKey: "principalLP", label: "Principal — não circulante" },
  { key: "juros_cp", posKey: "jurosCP", label: "Provisão de juros — circulante" },
  { key: "juros_lp", posKey: "jurosLP", label: "Provisão de juros — não circulante" },
];

// Débito ou crédito do lançamento de abertura, sempre explícito ao lado da conta.
function DcBadge({ kind }) {
  return kind === "D" ? (
    <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-blue-700">DÉBITO</span>
  ) : (
    <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700">CRÉDITO</span>
  );
}

function parseJson(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return null; } }
  return value || null;
}

const STATUS = {
  rascunho: { label: "Rascunho", cls: "bg-slate-100 text-slate-700" },
  aprovada: { label: "Aprovada", cls: "bg-emerald-50 text-emerald-700" },
  aplicada: { label: "Aplicada aos contratos", cls: "bg-cyan-50 text-cyan-700" },
};

function isLastDayOfMonth(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m, 0).getDate() === d;
}

function nextDay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const RECON_STATUS = {
  aguardando_lancamento: { label: "Aguardando o fechamento da virada", cls: "bg-slate-100 text-slate-700" },
  aguardando_espelho: { label: "Aguardando o lançamento espelho", cls: "bg-amber-50 text-amber-700" },
  conciliada: { label: "Conciliada — transitória zerada", cls: "bg-emerald-50 text-emerald-700" },
  divergente: { label: "Divergente", cls: "bg-rose-50 text-rose-700" },
};

const emptyForm = { data_base: "", data_virada: "", transitoria_account_id: "", category_accounts: {} };

export default function BalanceDeploymentPanel() {
  const queryClient = useQueryClient();
  const [entityId, setEntityId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [openMap, setOpenMap] = useState({});
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [busy, setBusy] = useState(false);
  const previewSeq = useRef(0);
  const [recon, setRecon] = useState(null);
  const [releaseOk, setReleaseOk] = useState(false);
  const [mirror, setMirror] = useState({ amount: "", date: "", reference: "" });

  const { data: entities = [] } = useQuery({
    queryKey: ["deployment-entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    initialData: [],
  });
  const { data: chart = [] } = useQuery({
    queryKey: ["deployment-chart"],
    queryFn: () => base44.entities.ChartOfAccount.list("account_code", 20000),
    initialData: [],
  });
  const { data: configs = [] } = useQuery({
    queryKey: ["deployment-configs", entityId],
    queryFn: () => base44.entities.BalanceDeploymentConfig.filter({ entity_id: entityId }, "", 5),
    enabled: !!entityId,
    initialData: [],
  });
  const { data: mappings = [] } = useQuery({
    queryKey: ["deployment-mappings", entityId],
    queryFn: () => base44.entities.AccountingEventMapping.filter({ entity_id: entityId }, "", 1000),
    enabled: !!entityId,
    initialData: [],
  });
  // A tela só abre quando a Lógica Contábil tem as contas necessárias para contabilizar os títulos novos.
  const { data: readiness, refetch: refetchReadiness } = useQuery({
    queryKey: ["deployment-readiness", entityId],
    queryFn: async () => (await base44.functions.invoke("getDeploymentReadiness", { entityId })).data,
    enabled: !!entityId,
  });
  const cfg = configs[0] || null;
  const status = cfg?.status || "rascunho";
  const locked = status !== "rascunho";
  const gateBlocked = Boolean(entityId) && !locked && Boolean(readiness) && !readiness.ready;

  const accountOptions = useMemo(
    () => chart.filter((a) => a.account_type !== "sintetica").map((a) => ({ value: a.id, label: `${a.account_code} — ${a.account_name}` })),
    [chart]
  );
  const accountLabel = (id) => accountOptions.find((o) => o.value === id)?.label || "—";

  // carrega a configuração salva no formulário; aprovada/aplicada usa a fotografia
  useEffect(() => {
    if (!entityId) return;
    if (cfg) {
      setForm({
        data_base: String(cfg.data_base || "").slice(0, 10),
        data_virada: String(cfg.data_virada || "").slice(0, 10),
        transitoria_account_id: cfg.transitoria_account_id || "",
        category_accounts: parseJson(cfg.category_accounts) || {},
      });
      let snap = cfg.position_snapshot;
      if (typeof snap === "string") { try { snap = JSON.parse(snap); } catch { snap = null; } }
      if (snap?.contratos) {
        setOpenMap(Object.fromEntries(snap.contratos.map((c) => [c.contractId, c.openParcelas || []])));
      }
    } else {
      setForm(emptyForm);
      setOpenMap({});
      setPreview(null);
    }
  }, [entityId, cfg?.id, cfg?.status, cfg?.updated_date]);

  const baseError = form.data_base && !isLastDayOfMonth(form.data_base) ? "A data-base deve ser o último dia de um mês." : "";
  const viradaError = form.data_base && form.data_virada && form.data_virada <= form.data_base ? "A virada deve ser depois da data-base." : "";

  const runPreview = async (map = openMap) => {
    if (!entityId || !form.data_base || baseError) return;
    const seq = ++previewSeq.current;
    setLoadingPreview(true);
    try {
      const { data } = await base44.functions.invoke("previewBalanceDeployment", { entityId, dataBase: form.data_base, openParcelasByContract: map });
      if (seq === previewSeq.current) setPreview(data);
    } catch (err) {
      if (seq === previewSeq.current) { setPreview(null); toast.error(err.message || "Não foi possível calcular a prévia"); }
    } finally {
      if (seq === previewSeq.current) setLoadingPreview(false);
    }
  };

  // prévia automática ao mudar entidade, data-base ou parcelas em aberto
  useEffect(() => {
    if (!entityId || !form.data_base || baseError) return undefined;
    const t = setTimeout(() => runPreview(openMap), 350);
    return () => clearTimeout(t);
  }, [entityId, form.data_base, JSON.stringify(openMap)]);

  const setField = (k, v) => setForm((prev) => {
    const next = { ...prev, [k]: v };
    if (k === "data_base" && (!prev.data_virada || prev.data_virada <= v)) next.data_virada = nextDay(v);
    return next;
  });

  const setCategoryAccount = (category, key, value) => setForm((prev) => ({
    ...prev,
    category_accounts: { ...(prev.category_accounts || {}), [category]: { ...((prev.category_accounts || {})[category] || {}), [key]: value } },
  }));

  // Sugestão pela Lógica Contábil: na matriz, a reclassificação circulante/não circulante de cada categoria
  // já tem as contas de passivo (débito = não circulante, crédito = circulante), do principal e dos juros.
  const suggestFromMatrix = (category) => {
    const find = (type) => mappings.find((m) => m.event_type === type && (m.operation_category || "emprestimos") === category && m.status !== "inativo");
    const p = find("reclassificacao_circulante_principal");
    const j = find("reclassificacao_circulante_juros");
    const accrual = find("juros_apropriados");
    return {
      principal_lp: p?.debit_account_id || "", principal_cp: p?.credit_account_id || "",
      // Juros a pagar circulante: a reclassificação de juros; sem ela, a conta de crédito dos juros apropriados
      // (é onde os juros a pagar ficam registrados). Não circulante: a reclassificação de juros; sem ela, a conta
      // de principal não circulante (os juros a pagar quase sempre vencem em até 12 meses).
      juros_cp: j?.credit_account_id || accrual?.credit_account_id || "",
      juros_lp: j?.debit_account_id || p?.debit_account_id || "",
    };
  };
  const fillFromMatrix = (category, overwrite = false) => {
    const sug = suggestFromMatrix(category);
    setForm((prev) => {
      const cur = (prev.category_accounts || {})[category] || {};
      const next = { ...cur };
      CATEGORY_PARTS.forEach(({ key }) => { if (sug[key] && (overwrite || !cur[key])) next[key] = sug[key]; });
      return { ...prev, category_accounts: { ...(prev.category_accounts || {}), [category]: next } };
    });
  };

  const toggleParcela = (contractId, parcela) => {
    if (locked) return;
    setOpenMap((prev) => {
      const cur = new Set((prev[contractId] || []).map(String));
      const key = String(parcela);
      if (cur.has(key)) cur.delete(key); else cur.add(key);
      return { ...prev, [contractId]: [...cur] };
    });
  };

  const refreshConfig = () => queryClient.invalidateQueries({ queryKey: ["deployment-configs", entityId] });

  const loadRecon = async () => {
    if (!cfg?.id || cfg.status !== "aplicada") { setRecon(null); return; }
    try {
      const { data } = await base44.functions.invoke("getDeploymentReconciliation", { configId: cfg.id });
      setRecon(data);
    } catch {
      setRecon(null);
    }
  };
  useEffect(() => { loadRecon(); }, [cfg?.id, cfg?.status, cfg?.updated_date]);

  const releaseTitles = async () => {
    if (!window.confirm("Liberar os títulos para integração com o ERP? Confirme que os títulos antigos desses empréstimos já foram excluídos no Protheus — senão as parcelas ficam duplicadas.")) return;
    setBusy(true);
    try {
      const { data } = await base44.functions.invoke("releaseBalanceDeploymentTitles", { configId: cfg.id, confirmedOldTitlesRemoved: true });
      toast.success(`${data.total} título(s) liberado(s) para integração.`);
      setReleaseOk(false);
    } catch (err) {
      toast.error(err.message || "Não foi possível liberar os títulos");
    } finally { setBusy(false); }
  };

  const saveMirror = async () => {
    setBusy(true);
    try {
      const { data } = await base44.functions.invoke("recordDeploymentMirror", {
        configId: cfg.id, amount: Number(String(mirror.amount).replace(",", ".")), mirrorDate: mirror.date, reference: mirror.reference,
      });
      setRecon(data);
      toast.success("Lançamento espelho registrado.");
      await refreshConfig();
    } catch (err) {
      toast.error(err.message || "Não foi possível registrar o espelho");
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = { entity_id: entityId, ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      if (cfg) await base44.entities.BalanceDeploymentConfig.update(cfg.id, payload);
      else await base44.entities.BalanceDeploymentConfig.create(payload);
      toast.success("Rascunho salvo.");
      await refreshConfig();
    } catch (err) {
      toast.error(err.message || "Não foi possível salvar");
    } finally { setBusy(false); }
  };

  const callFn = async (name, okMsg) => {
    setBusy(true);
    try {
      await base44.functions.invoke(name, { configId: cfg.id, openParcelasByContract: openMap });
      toast.success(okMsg);
      await refreshConfig();
    } catch (err) {
      toast.error(err.message || "Operação não concluída");
    } finally { setBusy(false); }
  };

  const approve = async () => {
    if (!window.confirm("Aprovar a posição de abertura? A fotografia (contas, datas, parcelas em aberto e valores) fica congelada e a configuração deixa de ser editável.")) return;
    await callFn("approveBalanceDeployment", "Implantação aprovada.");
  };
  const reopen = async () => {
    if (!window.confirm("Reabrir a configuração? A fotografia aprovada será descartada.")) return;
    await callFn("reopenBalanceDeployment", "Configuração reaberta.");
  };
  const apply = async () => {
    if (!window.confirm("Aplicar aos contratos? Eles passam a gerar títulos só depois da data-base, ficam retidos fora da integração automática e o fechamento não roda até a data-base. Nada é excluído ou lançado agora.")) return;
    await callFn("applyBalanceDeployment", "Contratos marcados para implantação.");
  };

  let snapshot = cfg?.position_snapshot;
  if (typeof snapshot === "string") { try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; } }
  const view = locked && snapshot ? { totals: snapshot.totals, contracts: snapshot.contratos.map((c) => ({ ...c, parcelasAteDataBase: [] })) } : preview ? { totals: preview.totals, contracts: preview.contracts } : null;
  const categories = useMemo(() => {
    if (locked && snapshot?.contratos) {
      const cats = [...new Set(snapshot.contratos.map((c) => c.operationCategory || "emprestimos"))];
      return cats.map((category) => ({ category, label: OPERATION_CATEGORY_LABELS[category] || category, contracts: snapshot.contratos.filter((c) => (c.operationCategory || "emprestimos") === category).length }));
    }
    return preview?.categories || [];
  }, [locked, cfg?.position_snapshot, preview]);

  // Ao aparecerem as categorias, preenche as contas ainda vazias pela Lógica Contábil.
  useEffect(() => {
    if (locked || !entityId) return;
    categories.forEach((c) => fillFromMatrix(c.category, false));
  }, [categories.map((c) => c.category).join("|"), mappings.length, cfg?.id, locked]);

  const categoryComplete = (category) => CATEGORY_PARTS.every((p) => form.category_accounts?.[category]?.[p.key]);
  const accountsComplete = ACCOUNT_FIELDS.every((f) => form[f.key]) && categories.length > 0 && categories.every((c) => categoryComplete(c.category));
  const canApprove = !locked && cfg && accountsComplete && !baseError && !viradaError && preview?.contracts?.length > 0;
  const totals = view?.totals;

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="py-3 space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <CardTitle className="text-base text-slate-900">Implantação de Saldos</CardTitle>
                <p className="text-xs text-slate-500">Data-base, contas do lançamento de abertura e posição de cada contrato. Nada é lançado aqui.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Empresa</label>
                <Select value={entityId || undefined} onValueChange={setEntityId}>
                  <SelectTrigger className="h-9 w-72"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                  <SelectContent>{entities.map((e) => (<SelectItem key={e.id} value={e.id}>{e.entity_name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            {entityId && !gateBlocked && (
              <Badge className={`${STATUS[status].cls} border-0 font-medium gap-1`}>
                {locked ? <Lock className="w-3 h-3" /> : null}{STATUS[status].label}
              </Badge>
            )}
          </div>
          <details className="rounded-md border border-cyan-200 bg-cyan-50/40 px-3 py-1.5 text-xs text-slate-700">
            <summary className="cursor-pointer font-medium text-slate-900">Como a data-base afeta os títulos do Contas a Pagar</summary>
            <ul className="list-disc pl-4 space-y-1 mt-2 pb-1">
              <li>
                <strong>Só passa a valer ao aplicar aos contratos.</strong> Informar a data, salvar o rascunho ou aprovar a posição não altera nenhum título.
              </li>
              <li>
                <strong>Depois de aplicada, a data-base é o corte dos títulos.</strong> Parcelas com vencimento até a data-base não geram título; os que já existiam
                ficam como "ignorados pela implantação" (ocultos, fora do ERP, da baixa e do fechamento). Exceção: as parcelas que você marcar como vencidas em aberto.
              </li>
              <li>
                <strong>Parcelas depois da data-base</strong> geram títulos normalmente, mas ficam <strong>retidas</strong> até você usar "Liberar títulos" (depois de
                excluir os títulos antigos no Protheus). Só então seguem para o ERP.
              </li>
              <li>
                <strong>Sem implantação, nada é cortado ou retido:</strong> todas as parcelas do contrato geram título (inclusive as de datas passadas) e podem ser
                integradas ao ERP, desde que classificadas (natureza e fornecedor).
              </li>
              <li>
                O corte vale por contrato: contratos fora da implantação (por exemplo, operação posterior à data-base) continuam gerando títulos normalmente.
                O lançamento do pagamento na contabilidade depende da baixa no Contas a Pagar, com ou sem implantação.
              </li>
            </ul>
          </details>
        </CardContent>
      </Card>

      {entityId && gateBlocked && (
        <Card className="border-amber-300 bg-amber-50/60 shadow-sm">
          <CardContent className="py-4 space-y-2 text-xs text-amber-900">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="w-4 h-4" /> A Lógica Contábil ainda não está preenchida para esta empresa
            </p>
            <p>
              A implantação lança a abertura e, depois dela, o fechamento contabiliza os títulos e as parcelas novos. Para isso a Lógica Contábil precisa ter,
              em cada categoria, as contas dos eventos abaixo. Preencha e volte a esta tela.
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              {readiness.categories.filter((c) => c.missing.length).map((c) => (
                <li key={c.category}><strong>{c.label}:</strong> {c.missing.map((m) => m.label).join(", ")}</li>
              ))}
            </ul>
            <div className="flex gap-2 pt-1">
              <Link to="/SettingsAccountingLogic">
                <Button size="sm" className="h-8 text-xs">Abrir a Lógica Contábil</Button>
              </Link>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => refetchReadiness()}>Já preenchi, verificar de novo</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {entityId && !gateBlocked && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="py-3 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Data-base (último dia do mês)</label>
                  <Input type="date" className="h-9 w-40" value={form.data_base} disabled={locked} onChange={(e) => setField("data_base", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Virada (início no AllDebt)</label>
                  <Input type="date" className="h-9 w-40" value={form.data_virada} disabled={locked} onChange={(e) => setField("data_virada", e.target.value)} />
                </div>
                {cfg?.approved_by && (
                  <p className="text-xs text-slate-500 pb-2">Aprovada por {cfg.approved_by}{cfg.approved_at ? ` em ${dmy(String(cfg.approved_at).slice(0, 10))}` : ""}.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {!locked && (
                  <Button size="sm" onClick={save} disabled={busy || !form.data_base || !form.data_virada || !!baseError || !!viradaError}>
                    Salvar rascunho
                  </Button>
                )}
                {!locked && (
                  <Button size="sm" variant="outline" onClick={() => runPreview()} disabled={loadingPreview || !form.data_base || !!baseError}>
                    {loadingPreview ? "Calculando..." : "Atualizar prévia"}
                  </Button>
                )}
                {!locked && (
                  <Button size="sm" onClick={approve} disabled={busy || !canApprove} title={!cfg ? "Salve o rascunho antes" : !accountsComplete ? "Defina a conta transitória e as quatro contas de passivo de cada categoria" : ""}>
                    Aprovar posição
                  </Button>
                )}
                {status === "aprovada" && (
                  <>
                    <Button size="sm" onClick={apply} disabled={busy}>Aplicar aos contratos</Button>
                    <Button size="sm" variant="outline" onClick={reopen} disabled={busy}>Reabrir</Button>
                  </>
                )}
                {status === "aplicada" && <p className="text-xs text-slate-500 self-center">Contratos marcados. Para alterar, ajuste a marca de cada contrato pelo suporte.</p>}
              </div>
            </div>
            {baseError ? <p className="text-xs text-rose-600 -mt-1">{baseError}</p> : null}
            {viradaError ? <p className="text-xs text-rose-600 -mt-1">{viradaError}</p> : null}
            {!cfg && form.data_base ? <p className="text-xs text-amber-700 -mt-1">Salve o rascunho para poder aprovar.</p> : null}

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5 text-left w-24">Lançamento</th>
                    <th className="px-2 py-1.5 text-left w-52">Conta de</th>
                    <th className="px-2 py-1.5 text-left">Conta contábil</th>
                    <th className="px-2 py-1.5 text-right w-36">Valor previsto</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="px-2 py-1"><DcBadge kind="D" /></td>
                    <td className="px-2 py-1 text-slate-700">Transitória (contrapartida da abertura)</td>
                    <td className="px-2 py-1">
                      <Combobox
                        options={accountOptions}
                        value={form.transitoria_account_id || ""}
                        onChange={(v) => setField("transitoria_account_id", v)}
                        placeholder="Selecione a conta"
                        searchPlaceholder="Buscar conta..."
                        className="h-8 w-full text-xs"
                        disabled={locked}
                        wideList
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-medium text-slate-900">{totals ? brl(totals.total) : "—"}</td>
                  </tr>
                  {!categories.length ? (
                    <tr className="border-t border-slate-100">
                      <td colSpan={4} className="px-2 py-2 text-amber-700">Informe a data-base para listar as categorias dos contratos desta empresa.</td>
                    </tr>
                  ) : categories.map((cat) => {
                    const rows = (view?.contracts || []).filter((c) => (c.operationCategory || "emprestimos") === cat.category);
                    const sum = (k) => rows.reduce((s, c) => s + (c.position?.[k] || 0), 0);
                    return (
                      <React.Fragment key={cat.category}>
                        <tr className="border-t border-slate-200 bg-slate-50/80">
                          <td colSpan={3} className="px-2 py-1 text-slate-800">
                            <span className="font-medium">{cat.label}</span>
                            <span className="ml-2 text-slate-500">{cat.contracts} contrato(s)</span>
                            {categoryComplete(cat.category) ? null : <span className="ml-2 text-amber-700">contas incompletas</span>}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {!locked && (
                              <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => fillFromMatrix(cat.category, true)}>
                                Preencher pela Lógica Contábil
                              </Button>
                            )}
                          </td>
                        </tr>
                        {CATEGORY_PARTS.map((p) => (
                          <tr key={p.key} className="border-t border-slate-100">
                            <td className="px-2 py-1"><DcBadge kind="C" /></td>
                            <td className="px-2 py-1 text-slate-700">{p.label}</td>
                            <td className="px-2 py-1">
                              <Combobox
                                options={accountOptions}
                                value={form.category_accounts?.[cat.category]?.[p.key] || ""}
                                onChange={(v) => setCategoryAccount(cat.category, p.key, v)}
                                placeholder="Selecione a conta"
                                searchPlaceholder="Buscar conta..."
                                className="h-8 w-full text-xs"
                                disabled={locked}
                                wideList
                              />
                            </td>
                            <td className="px-2 py-1 text-right text-slate-700">{view ? brl(sum(p.posKey)) : "—"}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                {totals && categories.length > 0 && (
                  <tfoot className="border-t border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <td colSpan={3} className="px-2 py-1.5">Débito = soma dos créditos. A transitória deve fechar em zero depois do lançamento espelho no sistema antigo.</td>
                      <td className="px-2 py-1.5 text-right font-medium text-slate-900">{brl(totals.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {entityId && !gateBlocked && view && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Posição em {dmy(form.data_base)} {locked ? "(fotografia aprovada)" : "(prévia)"}
            </CardTitle>
            <CardDescription>
              Parcelas até a data-base contam como pagas, exceto as marcadas como vencidas em aberto (entram como vencido, no circulante).
              Circulante = vence até a data-base + 12 meses (CPC 26).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview?.excluded?.length && !locked ? (
              <p className="text-xs text-slate-500">
                Fora da posição: {preview.excluded.map((e) => `${e.contractNumber} (${e.motivo})`).join("; ")}.
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-left">Contrato</th>
                    <th className="px-2 py-2 text-right">Principal vencido</th>
                    <th className="px-2 py-2 text-right">Principal circ.</th>
                    <th className="px-2 py-2 text-right">Principal não circ.</th>
                    <th className="px-2 py-2 text-right">Juros circ.</th>
                    <th className="px-2 py-2 text-right">Juros não circ.</th>
                    <th className="px-2 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {view.contracts.map((c) => {
                    const open = (openMap[c.contractId] || []).length;
                    const isOpen = expanded[c.contractId];
                    return (
                      <React.Fragment key={c.contractId}>
                        <tr className="border-t border-slate-100">
                          <td className="px-2 py-2">
                            <button type="button" className="inline-flex items-center gap-1 font-medium text-slate-800" onClick={() => setExpanded((p) => ({ ...p, [c.contractId]: !p[c.contractId] }))}>
                              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              {c.contractNumber}
                            </button>
                            {open ? <span className="ml-2 text-[10px] text-amber-700">{open} vencida(s) em aberto</span> : null}
                            {c.ptax ? (
                              <span className="ml-2 text-[10px] text-slate-500">{c.currency} · PTAX {Number(c.ptax).toLocaleString("pt-BR", { minimumFractionDigits: 4 })} ({String(c.ptaxDate || "").split("-").reverse().join("/")})</span>
                            ) : null}
                            {c.missingPtax ? <span className="ml-2 text-[10px] font-medium text-red-600">sem PTAX da data-base</span> : null}
                            {c.warnings?.length ? (
                              <span title={c.warnings.join("\n")} className="ml-2 inline-flex items-center text-amber-600"><AlertTriangle className="w-3 h-3" /></span>
                            ) : null}
                          </td>
                          <td className="px-2 py-2 text-right">{brl(c.position.principalVencido)}</td>
                          <td className="px-2 py-2 text-right">{brl(c.position.principalCP)}</td>
                          <td className="px-2 py-2 text-right">{brl(c.position.principalLP)}</td>
                          <td className="px-2 py-2 text-right">{brl(c.position.jurosCP)}</td>
                          <td className="px-2 py-2 text-right">{brl(c.position.jurosLP)}</td>
                          <td className="px-2 py-2 text-right font-medium">{brl(c.position.total)}</td>
                        </tr>
                        {isOpen && !locked && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={7} className="px-3 py-2">
                              <p className="text-[11px] text-slate-500 mb-1">Marque as parcelas vencidas até a data-base que continuam em aberto:</p>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 max-h-48 overflow-y-auto">
                                {c.parcelasAteDataBase.map((p) => (
                                  <label key={p.parcela} className="flex items-center gap-2 text-[11px] text-slate-700">
                                    <Checkbox checked={(openMap[c.contractId] || []).map(String).includes(String(p.parcela))} onCheckedChange={() => toggleParcela(c.contractId, p.parcela)} />
                                    {String(p.parcela).padStart(3, "0")} · {dmy(p.dataVencimento)} · {brl(p.principal + p.juros)}
                                  </label>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                        {isOpen && c.warnings?.length ? (
                          <tr><td colSpan={7} className="px-3 py-1 text-[11px] text-amber-700">{c.warnings.join(" ")}</td></tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                {totals && (
                  <tfoot className="border-t border-slate-200 bg-slate-50 font-medium">
                    <tr>
                      <td className="px-2 py-2">Total</td>
                      <td className="px-2 py-2 text-right">{brl(totals.principalVencido)}</td>
                      <td className="px-2 py-2 text-right">{brl(totals.principalCP)}</td>
                      <td className="px-2 py-2 text-right">{brl(totals.principalLP)}</td>
                      <td className="px-2 py-2 text-right">{brl(totals.jurosCP)}</td>
                      <td className="px-2 py-2 text-right">{brl(totals.jurosLP)}</td>
                      <td className="px-2 py-2 text-right">{brl(totals.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

          </CardContent>
        </Card>
      )}

      {entityId && status === "aplicada" && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Títulos no financeiro (integração com o ERP)</CardTitle>
            <CardDescription>
              Os títulos dos contratos desta implantação estão <strong>retidos</strong>: não são integrados ao ERP, nem automática nem manualmente.
              Libere só depois de excluir no Protheus os títulos antigos desses empréstimos — os títulos do AllDebt passam a ser os que se pagam lá,
              e a baixa volta para cá pela consulta ao ERP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <label className="flex items-center gap-2 text-slate-700">
              <Checkbox checked={releaseOk} onCheckedChange={(v) => setReleaseOk(Boolean(v))} />
              Confirmo que os títulos antigos já foram excluídos no ERP
            </label>
            <Button size="sm" variant="outline" onClick={releaseTitles} disabled={busy || !releaseOk}>Liberar títulos para integração</Button>
          </CardContent>
        </Card>
      )}

      {entityId && status === "aplicada" && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Lançamento de abertura e conciliação da transitória</CardTitle>
            <CardDescription>
              A abertura entra no Fechamento Contábil da competência da virada ({dmy(form.data_virada)}): aprove esse fechamento para lançá-la.
              Depois, registre aqui o lançamento espelho feito no sistema antigo (Débito no passivo antigo / Crédito na conta transitória).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {recon ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`${RECON_STATUS[recon.status]?.cls || ""} border-0 font-medium`}>{RECON_STATUS[recon.status]?.label || recon.status}</Badge>
                  <span className="text-slate-600">Fotografia: {brl(recon.esperado)} · Lançado (débito): {brl(recon.lancadoDebito)} · Espelho: {recon.espelho ? brl(recon.espelho.valor) : "—"} · Saldo da transitória: <strong>{brl(recon.saldoTransitoria)}</strong></span>
                </div>
                {recon.problemas?.length ? (
                  <ul className="list-disc pl-5 text-rose-700">{recon.problemas.map((p) => <li key={p}>{p}</li>)}</ul>
                ) : null}
                {recon.contratosComDiferenca?.length ? (
                  <p className="text-rose-700">Diferença por contrato: {recon.contratosComDiferenca.map((c) => `${c.contractNumber} (esperado ${brl(c.esperado)}, lançado ${brl(c.lancado)})`).join("; ")}</p>
                ) : null}
                {recon.espelho ? <p className="text-slate-500">Espelho registrado por {recon.espelho.por} — ref. {recon.espelho.referencia} em {dmy(recon.espelho.data)}.</p> : null}
              </>
            ) : <p className="text-slate-500">Carregando conciliação…</p>}
            {recon && recon.status !== "aguardando_lancamento" && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end max-w-3xl">
                <div className="space-y-1"><label className="text-slate-600">Valor lançado no sistema antigo</label><Input inputMode="decimal" value={mirror.amount} onChange={(e) => setMirror((m) => ({ ...m, amount: e.target.value }))} /></div>
                <div className="space-y-1"><label className="text-slate-600">Data</label><Input type="date" value={mirror.date} onChange={(e) => setMirror((m) => ({ ...m, date: e.target.value }))} /></div>
                <div className="space-y-1"><label className="text-slate-600">Referência (lote/lançamento)</label><Input value={mirror.reference} onChange={(e) => setMirror((m) => ({ ...m, reference: e.target.value }))} /></div>
                <Button size="sm" onClick={saveMirror} disabled={busy || !mirror.amount || !mirror.date || !mirror.reference}>Registrar espelho</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
