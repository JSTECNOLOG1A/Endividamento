import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings2, Save } from "lucide-react";
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
                      <Select value={draft.debit_account_id || undefined} onValueChange={(v) => setDraft(type, { debit_account_id: v })}>
                        <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {chartOfAccounts.map((a) => (<SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={draft.credit_account_id || undefined} onValueChange={(v) => setDraft(type, { credit_account_id: v })}>
                        <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {chartOfAccounts.map((a) => (<SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>))}
                        </SelectContent>
                      </Select>
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
