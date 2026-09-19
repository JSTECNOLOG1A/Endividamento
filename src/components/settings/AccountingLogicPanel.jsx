import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountingMatrixFields } from "@/components/accounting/AccountingMatrixConfig";
import { SETTLEMENT_MATERIALITY_CONFIG } from "@/lib/accountingClosing";
import { ChartRecommendationCard, BankAccountAccountsCard, TitleClassificationCard } from "@/components/settings/AccountingLogicExtras";

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
        timing: "Uma vez, na data da operação",
        note: "Reconhece o passivo pelo saldo devedor do contrato (valor de face, incluindo IOF e taxas financiados). Sem conta retificadora.",
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
        timing: "Mensal, até o último dia do mês",
        note: "Reconhece o juro acumulado até o fim do mês (rateado por dias corridos dentro do período de cada parcela), mesmo antes de pago — regime de competência. Não gera título no financeiro: o título de juros segue com o valor cheio no vencimento.",
      },
      {
        label: "Capitalização de juros",
        timing: "Na data da parcela que capitaliza",
        note: "Juros incorporados ao principal (carência com capitalização): sai de juros a pagar e entra no principal.",
      },
      {
        label: "IOF",
        timing: "Uma vez, na data da operação",
        note: "Despesa integral, não amortizada, na conta própria do IOF. Valor vem direto de contract.iof_value.",
      },
      {
        label: "Custo de transação (outras taxas)",
        timing: "Uma vez, na data da operação",
        note: "Política única da ferramenta: reconhecido integralmente no ato, cada verba na sua conta (IOF na conta do IOF, demais taxas na conta de custo de transação). Sem apropriação mensal.",
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

  const { data: entities = [] } = useQuery({
    queryKey: ["accounting-logic-entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    initialData: [],
  });

  return (
    <div className="space-y-4">
      <ChartRecommendationCard />

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Matriz de contas por empresa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Empresa</label>
          <Select value={entityId || undefined} onValueChange={setEntityId}>
            <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
            <SelectContent>
              {entities.map((e) => (<SelectItem key={e.id} value={e.id}>{e.entity_name}</SelectItem>))}
            </SelectContent>
          </Select>
        </CardContent>
        {entityId && (
          <CardContent className="pt-0">
            {/* key={entityId} força remontagem ao trocar de empresa — sem
                isso, o estado de rascunho (campos editados mas não salvos)
                vaza de uma empresa pra outra, já que fica guardado
                localmente, não por entityId. */}
            <AccountingMatrixFields key={entityId} entityId={entityId} />
          </CardContent>
        )}
      </Card>

      <BankAccountAccountsCard />

      <TitleClassificationCard />

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
    </div>
  );
}
