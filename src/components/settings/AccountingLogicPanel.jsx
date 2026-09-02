import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2 } from "lucide-react";
import AccountingMatrixConfig from "@/components/accounting/AccountingMatrixConfig";
import { SETTLEMENT_MATERIALITY_CONFIG, SETTLEMENT_EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/accountingClosing";
import { OPERATION_CATEGORIES } from "@/lib/contractOptions";

// Ordem de leitura pedida: circulante/não circulante primeiro (patrimonial),
// depois juros, depois o resto — mesma sequência do "circulante x não
// circulante x juros x variações" combinado desde o início do desenho.
const SUMMARY_EVENT_ORDER = [
  SETTLEMENT_EVENT_TYPES.JUROS_APROPRIADOS,
  SETTLEMENT_EVENT_TYPES.IOF,
  SETTLEMENT_EVENT_TYPES.CUSTO_TRANSACAO_APROPRIACAO,
  SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA,
  SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA,
  SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_ATIVA_REALIZADA,
  SETTLEMENT_EVENT_TYPES.VARIACAO_CAMBIAL_PASSIVA_REALIZADA,
  SETTLEMENT_EVENT_TYPES.MULTA_MORA,
  SETTLEMENT_EVENT_TYPES.TARIFA_BANCARIA,
  SETTLEMENT_EVENT_TYPES.DESCONTO_FINANCEIRO,
  SETTLEMENT_EVENT_TYPES.AJUSTE_ARREDONDAMENTO,
];

function accountLabel(id, accountsById) {
  const acc = accountsById.get(id);
  return acc ? `${acc.account_code} — ${acc.account_name}` : null;
}

function CategoryAccountSummary({ entityId }) {
  // Mesma queryKey que AccountingMatrixConfig.jsx usa pro próprio fetch —
  // garante que salvar uma conta na matriz invalida o cache daqui também
  // (ela já chama invalidateQueries com essa key ao salvar), sem precisar
  // de lógica de sincronização própria.
  const { data: mappings = [] } = useQuery({
    queryKey: ["accounting-event-mappings", entityId],
    queryFn: () => base44.entities.AccountingEventMapping.filter({ entity_id: entityId }, "", 500),
    enabled: !!entityId,
    initialData: [],
  });
  const { data: chartOfAccounts = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => base44.entities.ChartOfAccount.list("account_code", 2000),
    initialData: [],
  });
  const accountsById = new Map(chartOfAccounts.map((a) => [a.id, a]));

  const byCategory = new Map(
    OPERATION_CATEGORIES.map((c) => [c.value, new Map(mappings.filter((m) => m.operation_category === c.value).map((m) => [m.event_type, m]))])
  );

  return (
    <div className="space-y-4">
      {OPERATION_CATEGORIES.map((cat) => {
        const eventsByType = byCategory.get(cat.value);
        const reclass = eventsByType.get(SETTLEMENT_EVENT_TYPES.RECLASSIFICACAO_CIRCULANTE_PRINCIPAL);
        const circulante = reclass ? accountLabel(reclass.credit_account_id, accountsById) : null;
        const naoCirculante = reclass ? accountLabel(reclass.debit_account_id, accountsById) : null;

        const rows = [
          { label: `${cat.label} — Circulante`, value: circulante },
          { label: `${cat.label} — Não circulante`, value: naoCirculante },
          ...SUMMARY_EVENT_ORDER.map((type) => {
            const m = eventsByType.get(type);
            return { label: EVENT_TYPE_LABELS[type], value: m ? accountLabel(m.debit_account_id, accountsById) : null };
          }),
        ];
        const configuredCount = rows.filter((r) => r.value).length;

        return (
          <div key={cat.value} className="rounded-lg border border-slate-200">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{cat.label}</span>
              <span className="text-[11px] text-slate-500">{configuredCount}/{rows.length} configuradas</span>
            </div>
            <div className="divide-y divide-slate-100">
              {rows.map((row) => (
                <div key={row.label} className="px-3 py-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-600 shrink-0">{row.label}</span>
                  <span className={row.value ? "text-slate-900 font-medium text-right" : "text-amber-600 text-right"}>
                    {row.value || "não configurada"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Referência viva da lógica do motor de fechamento contábil
// (src/lib/accountingClosing.js) — cada mudança de regra ali (novo evento,
// novo timing) deve ser refletida aqui também, pra esta tela nunca ficar
// desatualizada em relação ao que o sistema realmente calcula.
const EVENT_REFERENCE = [
  {
    group: "Patrimonial (balanço)",
    color: "bg-slate-100 text-slate-700",
    items: [
      {
        label: "Liberação do empréstimo",
        timing: "Uma vez, no mês da liberação",
        note: "Reconhece o passivo já líquido (valor captado − fee de estruturação, se houver) — sem conta retificadora no balanço.",
      },
      {
        label: "Reclassificação de principal/juros para circulante",
        timing: "Mensal, automático",
        note: "Migra saldo entre circulante e não circulante pela regra dos 12 meses. Não muda o total da dívida — só troca de conta com a passagem do tempo.",
      },
    ],
  },
  {
    group: "DRE — despesas financeiras",
    color: "bg-red-50 text-red-700",
    items: [
      {
        label: "Juros apropriados (competência)",
        timing: "Mensal",
        note: "Reconhece o juro do mês mesmo antes de pago — regime de competência, independe da baixa.",
      },
      {
        label: "IOF",
        timing: "Uma vez, no mês da liberação",
        note: "Despesa integral, não amortizada — é um tributo incidente na operação, diferente do fee de estruturação abaixo. Valor vem direto de contract.iof_value.",
      },
      {
        label: "Apropriação de custo de transação (fee de estruturação)",
        timing: "Mensal, linear, só se financiado",
        note: "Só gera lançamento quando \"Taxas financiadas\" está marcado no contrato — dividido em partes iguais pelo prazo total. Se pago à vista, não passa por aqui.",
      },
      {
        label: "Multa e mora",
        timing: "Só quando existir na baixa da parcela",
        note: "Informado manualmente na tela de baixa (Fechamento Contábil, Passo 1).",
      },
      {
        label: "Tarifa bancária",
        timing: "Só quando existir na baixa da parcela",
        note: "Idem — informado na baixa manual.",
      },
      {
        label: "Ajuste de arredondamento",
        timing: "Automático, dentro da margem de materialidade",
        note: `Diferença entre previsto e pago até ${(SETTLEMENT_MATERIALITY_CONFIG.percentThreshold * 100).toFixed(0)}% da parcela (ou R$ ${SETTLEMENT_MATERIALITY_CONFIG.floorAmount.toFixed(2)}, o que for maior) cai aqui sozinha. Acima disso, o sistema bloqueia a baixa até reclassificar manualmente.`,
      },
    ],
  },
  {
    group: "DRE — receita financeira",
    color: "bg-emerald-50 text-emerald-700",
    items: [
      {
        label: "Desconto financeiro obtido",
        timing: "Só na baixa, uso excepcional",
        note: "Quando o valor pago é menor que o devido por remissão/desconto de pontualidade — não confundir com ajuste de arredondamento (que é ruído de metodologia, não um ganho real).",
      },
    ],
  },
  {
    group: "Variação cambial (contratos USD)",
    color: "bg-blue-50 text-blue-700",
    items: [
      {
        label: "Variação cambial ativa/passiva (provisão)",
        timing: "Mensal, por competência",
        note: "Calculada a partir da curva de PTAX do cronograma (projeção) — lançada todo mês, pago ou não.",
      },
      {
        label: "Variação cambial ativa/passiva (realizada na baixa)",
        timing: "Só na baixa, se a PTAX do pagamento for informada",
        note: "Recalcula a variação sobre o valor efetivamente liquidado usando a PTAX real do dia do pagamento — separada da provisão, sem exigir recálculo do contrato.",
      },
    ],
  },
];

export default function AccountingLogicPanel() {
  const [entityId, setEntityId] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(false);

  const { data: entities = [] } = useQuery({
    queryKey: ["accounting-logic-entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    initialData: [],
  });

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Matriz de contas por empresa</CardTitle>
          <CardDescription>
            Onde cada evento abaixo é amarrado à conta de débito/crédito real do plano de contas do cliente — separado
            por categoria de operação (empréstimos, financiamentos, mútuos com partes relacionadas e com terceiros).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Empresa</label>
            <Select value={entityId || undefined} onValueChange={setEntityId}>
              <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => (<SelectItem key={e.id} value={e.id}>{e.entity_name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" className="h-9 gap-1.5" disabled={!entityId} onClick={() => setMatrixOpen(true)}>
            <Settings2 className="w-3.5 h-3.5" /> Abrir matriz contábil
          </Button>
        </CardContent>
        {entityId && (
          <CardContent className="pt-0">
            <CategoryAccountSummary entityId={entityId} />
          </CardContent>
        )}
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Como o fechamento contábil calcula cada evento</CardTitle>
          <CardDescription>
            Referência de manutenção — o que o sistema lança, quando, e por quê. Qualquer ajuste nessas regras exige
            mudança de código (src/lib/accountingClosing.js); esta tela documenta o comportamento atual, não o edita.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {EVENT_REFERENCE.map((group) => (
            <div key={group.group} className="space-y-2">
              <Badge className={`${group.color} border-0 font-medium`}>{group.group}</Badge>
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {group.items.map((item) => (
                  <div key={item.label} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="text-sm font-medium text-slate-800">{item.label}</span>
                      <span className="text-[11px] text-slate-500">{item.timing}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{item.note}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <p className="font-medium">Fora do escopo atual (planejado, ainda não implementado):</p>
            <p className="mt-1">
              Regras de IOF específicas para mútuos com terceiros e partes relacionadas, e "mútuo concedido"
              (empresa como credora — ativo a receber com juros ativos, espelhando esta mesma lógica).
            </p>
          </div>
        </CardContent>
      </Card>

      {entityId && (
        <AccountingMatrixConfig entityId={entityId} open={matrixOpen} onOpenChange={setMatrixOpen} />
      )}
    </div>
  );
}
