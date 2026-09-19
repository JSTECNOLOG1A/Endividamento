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

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

const ACCOUNT_FIELDS = [
  { key: "principal_cp_account_id", label: "Passivo — principal circulante" },
  { key: "principal_lp_account_id", label: "Passivo — principal não circulante" },
  { key: "juros_cp_account_id", label: "Juros a pagar — circulante" },
  { key: "juros_lp_account_id", label: "Juros a pagar — não circulante" },
  { key: "transitoria_account_id", label: "Conta transitória (contrapartida da abertura)" },
];

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

const emptyForm = { data_base: "", data_virada: "", principal_cp_account_id: "", principal_lp_account_id: "", juros_cp_account_id: "", juros_lp_account_id: "", transitoria_account_id: "" };

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
  const cfg = configs[0] || null;
  const status = cfg?.status || "rascunho";
  const locked = status !== "rascunho";

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
        principal_cp_account_id: cfg.principal_cp_account_id || "",
        principal_lp_account_id: cfg.principal_lp_account_id || "",
        juros_cp_account_id: cfg.juros_cp_account_id || "",
        juros_lp_account_id: cfg.juros_lp_account_id || "",
        transitoria_account_id: cfg.transitoria_account_id || "",
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
  const accountsComplete = ACCOUNT_FIELDS.every((f) => form[f.key]);
  const canApprove = !locked && cfg && accountsComplete && !baseError && !viradaError && preview?.contracts?.length > 0;
  const totals = view?.totals;

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Implantação de Saldos</CardTitle>
          <CardDescription>
            Define a data-base (sempre o último dia de um mês), as contas do lançamento de abertura e a posição de cada contrato. Nada é lançado
            aqui: a aprovação congela a posição e a aplicação marca os contratos. O lançamento de abertura e a troca no Protheus são etapas seguintes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Empresa</label>
          <Select value={entityId || undefined} onValueChange={setEntityId}>
            <SelectTrigger className="h-9 w-72"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
            <SelectContent>{entities.map((e) => (<SelectItem key={e.id} value={e.id}>{e.entity_name}</SelectItem>))}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      {entityId && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base text-slate-900">Datas e contas</CardTitle>
              {cfg?.approved_by && (
                <CardDescription>Aprovada por {cfg.approved_by}{cfg.approved_at ? ` em ${dmy(String(cfg.approved_at).slice(0, 10))}` : ""}.</CardDescription>
              )}
            </div>
            <Badge className={`${STATUS[status].cls} border-0 font-medium gap-1`}>
              {locked ? <Lock className="w-3 h-3" /> : null}{STATUS[status].label}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Data-base (último dia do mês)</label>
                <Input type="date" value={form.data_base} disabled={locked} onChange={(e) => setField("data_base", e.target.value)} />
                {baseError ? <p className="text-xs text-rose-600">{baseError}</p> : null}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Início da competência no AllDebt (virada)</label>
                <Input type="date" value={form.data_virada} disabled={locked} onChange={(e) => setField("data_virada", e.target.value)} />
                {viradaError ? <p className="text-xs text-rose-600">{viradaError}</p> : null}
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {ACCOUNT_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">{f.label}</label>
                  <Combobox
                    options={accountOptions}
                    value={form[f.key] || ""}
                    onChange={(v) => setField(f.key, v)}
                    placeholder="Selecione a conta"
                    searchPlaceholder="Buscar conta..."
                    className="h-9 w-full text-xs"
                    disabled={locked}
                    wideList
                  />
                </div>
              ))}
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
                <Button size="sm" onClick={approve} disabled={busy || !canApprove} title={!cfg ? "Salve o rascunho antes" : !accountsComplete ? "Defina as cinco contas" : ""}>
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
            {!cfg && form.data_base ? <p className="text-xs text-amber-700">Salve o rascunho para poder aprovar.</p> : null}
          </CardContent>
        </Card>
      )}

      {entityId && view && (
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

            {totals && (
              <div className="rounded-lg border border-cyan-200 bg-cyan-50/40 p-3 text-xs text-slate-700 space-y-1">
                <p className="font-medium text-slate-900">Lançamento de abertura previsto (executado na etapa seguinte)</p>
                <p>Débito — {accountLabel(form.transitoria_account_id)}: <strong>{brl(totals.total)}</strong></p>
                <p>Crédito — {accountLabel(form.principal_cp_account_id)}: {brl(totals.principalCP)}</p>
                <p>Crédito — {accountLabel(form.principal_lp_account_id)}: {brl(totals.principalLP)}</p>
                <p>Crédito — {accountLabel(form.juros_cp_account_id)}: {brl(totals.jurosCP)}</p>
                <p>Crédito — {accountLabel(form.juros_lp_account_id)}: {brl(totals.jurosLP)}</p>
                <p className="text-slate-500">A conta transitória deve fechar em zero depois do lançamento espelho no sistema antigo.</p>
              </div>
            )}
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
