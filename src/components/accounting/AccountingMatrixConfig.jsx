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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings2, Save, Copy, Info } from "lucide-react";
import { SETTLEMENT_EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/accountingClosing";
import { OPERATION_CATEGORIES } from "@/lib/contractOptions";
import { SORT_HEAD_CLASS } from "@/components/ui/sortable-table";

const EVENT_TYPES_ORDERED = Object.values(SETTLEMENT_EVENT_TYPES);

const RECLASSIFICATION_TYPES = new Set([
  SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_PRINCIPAL,
  SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_JUROS,
]);

// "(i)" ao lado do nome — passa o mouse pra ver o que a conta representa e
// que tipo de conta do plano do cliente selecionar ali. Pensado pra quem
// nunca configurou a matriz não precisar adivinhar ou ler o código.
function InfoTip({ text, side = "right" }) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Info className="w-3 h-3 inline-block ml-1 text-slate-400 hover:text-slate-600 cursor-help align-text-top" />
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs">
          <p className="text-xs">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const CATEGORY_HINTS = {
  emprestimos: "Empréstimos bancários de capital de giro — recursos de curto/médio prazo pro dia a dia da operação, sem vínculo a um bem específico.",
  financiamentos: "Financiamentos vinculados a investimento/CAPEX — aquisição de máquinas, imóveis, veículos ou outro bem específico.",
  mutuos_partes_relacionadas: "Empréstimos entre empresas do mesmo grupo econômico ou com sócios — mantenha contas separadas das demais: é obrigação de divulgação (CPC 05), não escolha de organização.",
  mutuos_terceiros: "Empréstimos com credores que não são banco nem parte relacionada — ex.: outra empresa do mercado, pessoa física sem vínculo societário.",
};

const CIRCULANTE_HINT = "Conta de PASSIVO — parcela da dívida desta categoria que vence em até 12 meses da data-base do fechamento.";
const NAO_CIRCULANTE_HINT = "Conta de PASSIVO — parcela da dívida desta categoria que vence depois de 12 meses da data-base do fechamento.";

const EVENT_TYPE_HINTS = {
  liberacao: "Contas movimentadas quando o empréstimo é liberado — reconhece o passivo já líquido (valor captado menos fee de estruturação, se houver).",
  juros_apropriados: "Débito = despesa financeira; Crédito = passivo de juros a pagar. Lançado todo mês, mesmo antes de pago (regime de competência).",
  pagamento_principal: "Contas usadas quando o principal é baixado (pago) na conciliação do fechamento.",
  pagamento_juros: "Contas usadas quando os juros são baixados (pagos) na conciliação do fechamento.",
  variacao_cambial_ativa: "Só contratos em USD. Débito = despesa/redução; calculada mês a mês pela curva de PTAX do cronograma (projeção, não o pagamento real).",
  variacao_cambial_passiva: "Só contratos em USD. Débito = despesa/aumento do passivo; calculada mês a mês pela curva de PTAX do cronograma (projeção, não o pagamento real).",
  variacao_cambial_ativa_realizada: "Só contratos em USD, e só quando a PTAX do dia do pagamento é informada na baixa — recalcula a variação sobre o valor efetivamente liquidado, separada da provisão.",
  variacao_cambial_passiva_realizada: "Só contratos em USD, e só quando a PTAX do dia do pagamento é informada na baixa — recalcula a variação sobre o valor efetivamente liquidado, separada da provisão.",
  tarifa_bancaria: "Conta de despesa pra tarifas cobradas pelo banco, informadas manualmente na baixa da parcela.",
  iof: "Conta de despesa pro IOF da operação — lançado integral no mês da liberação (não é amortizado, diferente do fee de estruturação abaixo).",
  custo_transacao_inicial: "Não gera lançamento hoje — o custo de captação já entra líquido no passivo na liberação (ver nota acima). Deixe sem configurar.",
  custo_transacao_apropriacao: "Conta de despesa pro fee de estruturação — só é lançada mês a mês quando o valor foi financiado (somado ao principal do contrato).",
  reclassificacao_circulante_principal: "Contas de passivo (as mesmas de Circulante/Não circulante acima) movimentadas quando o prazo restante do principal migra entre um balde e outro.",
  reclassificacao_circulante_juros: "Contas de passivo movimentadas quando o prazo restante dos juros a pagar migra entre circulante e não circulante.",
  multa_mora: "Conta de despesa pra multa e mora, informadas manualmente na baixa da parcela.",
  desconto_financeiro: "Conta de RECEITA (não despesa) — usada quando o valor pago é menor que o devido, por desconto de pontualidade ou remissão.",
  ajuste_arredondamento: "Conta de despesa pra pequenas diferenças entre o previsto e o pago, dentro da margem de materialidade configurada — não precisa de justificativa caso a caso.",
  outros: "Conta de despesa/receita genérica pra valores da baixa que não se encaixam em nenhuma das categorias acima.",
};

// Tabela de uma única categoria (13 eventos x débito/crédito). Componente
// próprio (não uma função dentro do pai) de propósito: cada instância tem
// seu próprio estado de rascunho isolado por categoria — trocar de aba no
// modal (que desmonta/remonta essa tabela) ou empilhar 4 delas na página de
// configurações (uma instância por categoria, todas montadas ao mesmo tempo)
// funciona igual, sem precisar prefixar chave de rascunho por categoria.
function EventMappingTable({ entityId, category, accountOptions, mappings, onSaved }) {
  const queryClient = useQueryClient();

  const mappingByType = useMemo(() => {
    const map = new Map();
    mappings
      .filter((m) => (m.operation_category || "emprestimos") === category)
      .forEach((m) => map.set(m.event_type, m));
    return map;
  }, [mappings, category]);

  const [drafts, setDrafts] = useState({});
  const [savingType, setSavingType] = useState(null);

  const draftFor = (type) => {
    if (drafts[type]) return drafts[type];
    const existing = mappingByType.get(type);
    return { debit_account_id: existing?.debit_account_id || "", credit_account_id: existing?.credit_account_id || "" };
  };

  const setDraft = (type, patch) => {
    setDrafts((prev) => ({ ...prev, [type]: { ...draftFor(type), ...patch } }));
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
      queryClient.invalidateQueries({ queryKey: ["accounting-event-mappings", entityId] });
      await onSaved?.();
      toast.success("Matriz atualizada.");
    } catch (err) {
      toast.error("Erro ao salvar: " + (err.message || "tente novamente"));
    } finally {
      setSavingType(null);
    }
  };

  return (
    <table className="w-full text-[11px]">
      <thead>
        {/* Sem reordenação por clique: é um formulário de configuração
            (cada linha é um tipo de evento contábil com Selects de
            débito/crédito editáveis) numa ordem fixa e proposital — não é
            uma lista de dados navegável. Só o estilo visual do cabeçalho é
            padronizado com o resto do app. */}
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
                {EVENT_TYPE_HINTS[type] && <InfoTip text={EVENT_TYPE_HINTS[type]} />}
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
  );
}

// Conteúdo completo da matriz (busca de dados + cópia entre empresas + as
// tabelas por categoria) — sem moldura de diálogo, pra poder ser usado tanto
// dentro do modal (Fechamento Contábil, um espaço apertado — tabs, uma
// categoria por vez) quanto direto numa página de configurações com mais
// espaço (stacked, as 4 categorias empilhadas e visíveis de uma vez, sem
// precisar clicar entre abas pra fazer a manutenção).
export function AccountingMatrixFields({ entityId, stacked = false }) {
  const [category, setCategory] = useState(OPERATION_CATEGORIES[0].value);

  const { data: chartOfAccounts = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => base44.entities.ChartOfAccount.list("account_code", 2000),
    initialData: [],
  });

  // Construído UMA vez e reaproveitado por todas as tabelas de categoria —
  // antes cada Select fazia seu próprio chartOfAccounts.map(...) inline no
  // JSX (26x972 elementos recriados a cada render), o que deixava a matriz
  // lenta pra abrir com um plano de contas grande (Grupo Cangaia tem quase
  // mil contas).
  const accountOptions = useMemo(
    () => chartOfAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.account_name}` })),
    [chartOfAccounts]
  );

  const { data: otherEntities = [] } = useQuery({
    queryKey: ["accounting-matrix-entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    initialData: [],
  });
  const copyCandidates = otherEntities.filter((e) => e.id !== entityId);
  const [copySourceId, setCopySourceId] = useState("");
  const [copying, setCopying] = useState(false);

  // Traz todas as categorias de uma vez (14 eventos x até 4 categorias — bem
  // pouca coisa) e filtra no cliente, pra trocar de categoria (ou mostrar
  // todas empilhadas) sem precisar de nova requisição.
  const { data: mappings = [], refetch } = useQuery({
    queryKey: ["accounting-event-mappings", entityId],
    queryFn: () => base44.entities.AccountingEventMapping.filter({ entity_id: entityId }, "", 200),
    enabled: !!entityId,
    initialData: [],
  });

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
      await refetch();
      toast.success(`${sourceMappings.length} mapeamento(s) copiado(s) de ${sourceName}.`);
    } catch (err) {
      toast.error("Erro ao copiar: " + (err.message || "tente novamente"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
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

      {stacked ? (
        <div className="space-y-4">
          {OPERATION_CATEGORIES.map((c) => {
            const count = mappings.filter((m) => (m.operation_category || "emprestimos") === c.value).length;
            return (
              <div key={c.value} className="rounded-lg border border-slate-200">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">
                    {c.label}
                    {CATEGORY_HINTS[c.value] && <InfoTip text={CATEGORY_HINTS[c.value]} />}
                  </span>
                  <span className="text-[11px] text-slate-500">{count}/{EVENT_TYPES_ORDERED.length} configuradas</span>
                </div>
                <div className="overflow-x-auto">
                  <EventMappingTable
                    entityId={entityId}
                    category={c.value}
                    accountOptions={accountOptions}
                    mappings={mappings}
                    onSaved={refetch}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <Tabs value={category} onValueChange={setCategory}>
            <TabsList className="bg-slate-100">
              {OPERATION_CATEGORIES.map((c) => (
                <TabsTrigger key={c.value} value={c.value} className="text-xs">{c.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <EventMappingTable
              entityId={entityId}
              category={category}
              accountOptions={accountOptions}
              mappings={mappings}
              onSaved={refetch}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function AccountingMatrixConfig({ entityId, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings2 className="w-4 h-4" /> Matriz contábil desta empresa</DialogTitle>
        </DialogHeader>
        {open && <AccountingMatrixFields entityId={entityId} />}
      </DialogContent>
    </Dialog>
  );
}
