import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { parametersApi } from "@/api/parameters";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { ACCOUNTING_LOGIC_PARAM_KEYS } from "@/lib/accountingLogicParams";

export function ChartRecommendationCard() {
  return (
    <Card className="border-cyan-200 bg-cyan-50/40 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-slate-900">Recomendação: contas exclusivas no balancete</CardTitle>
        <CardDescription>
          Para facilitar a integração dos lançamentos da ferramenta com a contabilidade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-700">
        <p>
          Crie no balancete duas contas exclusivas da plataforma e concentre nelas todos os lançamentos gerados aqui:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Empréstimos e Financiamentos</strong> — Passivo Circulante</li>
          <li><strong>Empréstimos e Financiamentos</strong> — Passivo Não Circulante</li>
        </ul>
        <p>
          Com o saldo dessas contas vindo apenas da ferramenta, a integração fica direta e a conciliação com o balancete
          fecha sem ajustes manuais. Eventuais aberturas (por banco, contrato, modalidade ou vencimento) devem ser
          tratadas dentro da ferramenta, nos relatórios e no fechamento contábil, e não como contas separadas no balancete.
        </p>
      </CardContent>
    </Card>
  );
}

export function BankAccountAccountsCard() {
  const queryClient = useQueryClient();
  const [savingId, setSavingId] = useState(null);

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["accounting-logic-bank-accounts"],
    queryFn: () => base44.entities.BankAccount.list("nome", 2000),
    initialData: [],
  });
  const { data: chart = [] } = useQuery({
    queryKey: ["accounting-logic-chart"],
    queryFn: () => base44.entities.ChartOfAccount.list("account_code", 20000),
    initialData: [],
  });

  const accountOptions = useMemo(
    () => chart
      .filter((a) => a.account_type !== "sintetica")
      .map((a) => ({ value: a.id, label: `${a.account_code} — ${a.account_name}` })),
    [chart]
  );

  const handleChange = async (account, value) => {
    setSavingId(account.id);
    try {
      await base44.entities.BankAccount.update(account.id, { chart_account_id: value || null });
      await queryClient.invalidateQueries({ queryKey: ["accounting-logic-bank-accounts"] });
      toast.success("Conta contábil da conta bancária atualizada.");
    } catch (err) {
      toast.error("Erro ao salvar: " + (err.message || "tente novamente"));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">Contas bancárias × conta contábil</CardTitle>
        <CardDescription>
          Vincula cada conta bancária a uma conta do plano de contas. O fechamento usa essa conta na liberação e no
          pagamento feitos por ela, em vez da conta padrão da matriz.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {bankAccounts.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma conta bancária cadastrada em Governança.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {bankAccounts.map((account) => (
              <div key={account.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 px-3 py-2">
                <div className="text-xs text-slate-700">
                  <span className="font-medium">{account.nome || "Conta bancária"}</span>
                  <span className="ml-2 text-slate-500">
                    Ag. {account.agencia || "—"} · Conta {account.conta || "—"}{account.digito ? `-${account.digito}` : ""}
                  </span>
                </div>
                <Combobox
                  options={accountOptions}
                  value={account.chart_account_id || ""}
                  onChange={(v) => handleChange(account, v)}
                  placeholder="Selecione (opcional)"
                  searchPlaceholder="Buscar conta..."
                  className="h-8 w-full text-xs"
                  disabled={savingId === account.id}
                  wideList
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TitleClassificationCard() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const result = await parametersApi.list({});
      const rows = (result.data || []).filter((p) => ACCOUNTING_LOGIC_PARAM_KEYS.includes(p.key));
      rows.sort((a, b) => ACCOUNTING_LOGIC_PARAM_KEYS.indexOf(a.key) - ACCOUNTING_LOGIC_PARAM_KEYS.indexOf(b.key));
      setItems(rows);
      setDraft(Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])));
    } catch {
      setItems([]);
    }
  };

  useEffect(() => { load(); }, []);

  const dirty = items.filter((i) => (draft[i.key] ?? "") !== (i.value ?? ""));

  const save = async () => {
    setSaving(true);
    try {
      for (const item of dirty) await parametersApi.update(item.key, draft[item.key], "TENANT");
      toast.success("Classificação dos títulos salva.");
      await load();
    } catch (err) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">Classificação dos títulos do Contas a Pagar</CardTitle>
        <CardDescription>
          Natureza e conta contábil aplicadas automaticamente aos títulos gerados (principal, juros e IOF). Deixe vazio
          para classificar manualmente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((item) => (
            <div key={item.key} className="space-y-1">
              <label className="text-xs font-medium text-slate-600">{item.label}</label>
              <Input
                className="h-9 font-mono uppercase tracking-wide"
                value={draft[item.key] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [item.key]: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
          ))}
        </div>
        <Button size="sm" disabled={saving || dirty.length === 0} onClick={save}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </CardContent>
    </Card>
  );
}
