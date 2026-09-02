import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings2, Save, Copy } from "lucide-react";
import { SETTLEMENT_EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/accountingClosing";
import { OPERATION_CATEGORIES } from "@/lib/contractOptions";
import { SORT_HEAD_CLASS } from "@/components/ui/sortable-table";

const EVENT_TYPES_ORDERED = Object.values(SETTLEMENT_EVENT_TYPES);

const RECLASSIFICATION_TYPES = new Set([
  SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_PRINCIPAL,
  SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_JUROS,
]);

export default function AccountingMatrixConfig({ entityId, open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState(OPERATION_CATEGORIES[0].value);

  const { data: chartOfAccounts = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => base44.entities.ChartOfAccount.list("account_code", 2000),
    enabled: open,
    initialData: [],
  });

  // Construído UMA vez e reaproveitado pelos ~26 Selects (13 eventos x
  // débito/crédito) — antes cada Select fazia seu próprio
  // chartOfAccounts.map(...) inline no JSX, ou seja 26x972 elementos
  // recriados a cada render. Era isso que deixava a matriz lenta pra abrir
  // com um plano de contas grande (Grupo Cangaia tem quase mil contas).
  const accountOptions = useMemo(
    () => chartOfAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.account_name}` })),
    [chartOfAccounts]
  );

  const { data: otherEntities = [] } = useQuery({
    queryKey: ["accounting-matrix-entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    enabled: open,
    initialData: [],
  });
  const copyCandidates = otherEntities.filter((e) => e.id !== entityId);
  const [copySourceId, setCopySourceId] = useState("");
  const [copying, setCopying] = useState(false);

  // Traz todas as categorias de uma vez (14 eventos x até 3 categorias — bem
  // pouca coisa) e filtra por aba no cliente, pra trocar de categoria sem
  // precisar de nova requisição.
  const { data: mappings = [], refetch } = useQuery({
    queryKey: ["accounting-event-mappings", entityId],
    queryFn: () => base44.entities.AccountingEventMapping.filter({ entity_id: entityId }, "", 200),
    enabled: open && !!entityId,
    initialData: [],
  });

  const mappingByType = useMemo(() => {
    const map = new Map();
    mappings
      .filter((m) => (m.operation_category || "emprestimos") === category)
      .forEach((m) => map.set(m.event_type, m));
    return map;
  }, [mappings, category]);

  const [drafts, setDrafts] = useState({});
  const [savingType, setSavingType] = useState(null);

  const draftKey = (type) => `${category}:${type}`;

  const draftFor = (type) => {
    const key = draftKey(type);
    if (drafts[key]) return drafts[key];
    const existing = mappingByType.get(type);
    return { debit_account_id: existing?.debit_account_id || "", credit_account_id: existing?.credit_account_id || "" };
  };

  const setDraft = (type, patch) => {
    const key = draftKey(type);
    setDrafts((prev) => ({ ...prev, [key]: { ...draftFor(type), ...patch } }));
  };

  const handleSave = async (type) => {
    const draft = draftFor(type);
    if (!draft.debit_account_id || !draft.credit_account_id) {
      toast.warning("Selecione a conta de débito e de crédito.");
      return;
    }
    setSavingType(type);
    try {
      const existing = mappingByType.get(type);
      if (existing) {
        await base44.entities.AccountingEventMapping.update(existing.id, {
          debit_account_id: draft.debit_account_id,
          credit_account_id: draft.credit_account_id,
          status: "ativo",
        });
      } else {
        await base44.entities.AccountingEventMapping.create({
          entity_id: entityId,
          event_type: type,
          operation_category: category,
          debit_account_id: draft.debit_account_id,
          credit_account_id: draft.credit_account_id,
          status: "ativo",
        });
      }
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["accounting-event-mappings", entityId] });
      toast.success("Matriz atualizada.");
    } catch (err) {
      toast.error("Erro ao salvar: " + (err.message || "tente novamente"));
    } finally {
      setSavingType(null);
    }
  };

  // Empresas do mesmo grupo econômico compartilham o mesmo plano de contas
  // (chart_of_accounts não tem entity_id — é escopado só por group_id), então
  // copiar o mapeamento de outra empresa é seguro: os debit_account_id/
  // credit_account_id já apontam pra contas que existem igualmente aqui.
  // Sobrescreve o que já estiver configurado nesta empresa (create-ou-update
  // por evento+categoria) — é uma cópia integral de propósito, não um merge
  // parcial, pra "ficar igual à empresa de origem" ser literal.
  const handleCopyFrom = async () => {
    if (!copySourceId) return;
    const sourceName = copyCandidates.find((e) => e.id === copySourceId)?.entity_name || "empresa selecionada";
    if (!window.confirm(`Copiar a matriz contábil de "${sourceName}" pra esta empresa? Isso substitui o que já estiver configurado aqui.`)) {
      return;
    }
    setCopying(true);
    try {
      const sourceMappings = await base44.entities.AccountingEventMapping.filter({ entity_id: copySourceId }, "", 500);
      for (const m of sourceMappings) {
        const targetCategory = m.operation_category || "emprestimos";
        const existing = mappings.find((x) => x.event_type === m.event_type && (x.operation_category || "emprestimos") === targetCategory);
        if (existing) {
          await base44.entities.AccountingEventMapping.update(existing.id, {
            debit_account_id: m.debit_account_id,
            credit_account_id: m.credit_account_id,
            status: "ativo",
          });
        } else {
          await base44.entities.AccountingEventMapping.create({
            entity_id: entityId,
            event_type: m.event_type,
            operation_category: targetCategory,
            debit_account_id: m.debit_account_id,
            credit_account_id: m.credit_account_id,
            status: "ativo",
          });
        }
      }
      setDrafts({});
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["accounting-event-mappings", entityId] });
      toast.success(`${sourceMappings.length} mapeamento(s) copiado(s) de ${sourceName}.`);
    } catch (err) {
      toast.error("Erro ao copiar: " + (err.message || "tente novamente"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings2 className="w-4 h-4" /> Matriz contábil desta empresa</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-600 -mt-2">
          Cada categoria de operação tem seu próprio conjunto de contas — obrigatório separar mútuos com
          partes relacionadas e com terceiros entre si e das demais operações para o balancete.
        </p>
        {copyCandidates.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                Copiar matriz de outra empresa do grupo
              </label>
              <Select value={copySourceId || undefined} onValueChange={setCopySourceId}>
                <SelectTrigger className="h-8 w-64 text-xs"><SelectValue placeholder="Selecione a empresa de origem" /></SelectTrigger>
                <SelectContent>
                  {copyCandidates.map((e) => (<SelectItem key={e.id} value={e.id}>{e.entity_name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={!copySourceId || copying} onClick={handleCopyFrom}>
              <Copy className="w-3 h-3" /> {copying ? "Copiando..." : "Copiar"}
            </Button>
          </div>
        )}
        <Tabs value={category} onValueChange={setCategory}>
          <TabsList className="bg-slate-100">
            {OPERATION_CATEGORIES.map((c) => (
              <TabsTrigger key={c.value} value={c.value} className="text-xs">{c.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <table className="w-full text-[11px]">
            <thead>
              {/* Sem reordenação por clique: é um formulário de configuração
                  (cada linha é um tipo de evento contábil com Selects de
                  débito/crédito editáveis) numa ordem fixa e proposital —
                  não é uma lista de dados navegável. Só o estilo visual do
                  cabeçalho é padronizado com o resto do app. */}
              <tr className="border-b border-slate-200 sticky top-0 bg-white">
                <th className={SORT_HEAD_CLASS}>Evento</th>
                <th className={SORT_HEAD_CLASS}>Conta de débito</th>
                <th className={SORT_HEAD_CLASS}>Conta de crédito</th>
                <th className="px-2 py-1.5 bg-slate-50" />
              </tr>
            </thead>
            <tbody>
              {EVENT_TYPES_ORDERED.map((type) => {
                const draft = draftFor(type);
                const configured = !!mappingByType.get(type);
                return (
                  <tr key={type} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 text-slate-700">
                      {EVENT_TYPE_LABELS[type]}
                      {!configured && <span className="ml-1.5 text-[10px] text-amber-600">não configurado</span>}
                      {RECLASSIFICATION_TYPES.has(type) && (
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Débito = conta não circulante · Crédito = conta circulante (o sistema inverte o lado
                          sozinho se o saldo migrar de volta pro não circulante)
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Combobox
                        options={accountOptions}
                        value={draft.debit_account_id || ""}
                        onChange={(v) => setDraft(type, { debit_account_id: v })}
                        placeholder="Selecione"
                        searchPlaceholder="Buscar conta..."
                        className="h-8 w-56 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Combobox
                        options={accountOptions}
                        value={draft.credit_account_id || ""}
                        onChange={(v) => setDraft(type, { credit_account_id: v })}
                        placeholder="Selecione"
                        searchPlaceholder="Buscar conta..."
                        className="h-8 w-56 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={savingType === type} onClick={() => handleSave(type)}>
                        <Save className="w-3 h-3" /> {savingType === type ? "..." : "Salvar"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
