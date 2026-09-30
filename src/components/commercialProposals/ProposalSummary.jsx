import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { formatDateOnlyBR, serverMessage, todayInSaoPaulo } from "./proposalOutcome";

const PERIOD_OPTIONS = [
  { value: "mes_atual", label: "Mês atual" },
  { value: "mes_anterior", label: "Mês anterior" },
  { value: "personalizado", label: "Outro período" },
];

const pad = (n) => String(n).padStart(2, "0");

// Mês (1 = janeiro) em AAAA-MM-DD, primeiro e último dia.
function monthBounds(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { de: `${year}-${pad(month)}-01`, ate: `${year}-${pad(month)}-${pad(lastDay)}` };
}

function currentMonth() {
  const [year, month] = todayInSaoPaulo().split("-").map(Number);
  return monthBounds(year, month);
}

function previousMonth() {
  const [year, month] = todayInSaoPaulo().split("-").map(Number);
  return month === 1 ? monthBounds(year - 1, 12) : monthBounds(year, month - 1);
}

// Valor decimal em texto ("4500.50") formatado como moeda sem passar por
// número de ponto flutuante, que poderia arredondar valores altos.
function formatDecimalBRL(value) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? "0").trim());
  if (!match) return "R$ 0,00";
  const [, sign, integer, fraction = ""] = match;
  const grouped = integer.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = `${fraction}00`.slice(0, 2);
  // Espaço inseparável: "R$" nunca fica numa linha e o número em outra.
  return `${sign}R$\u00a0${grouped},${cents}`;
}

// O valor nunca quebra de linha: cada grade abaixo garante largura para ele.
function SummaryCard({ label, value, hint }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-lg sm:text-xl font-bold text-slate-900 mt-1 whitespace-nowrap tabular-nums">{value}</div>
        {hint ? <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

// Resumo das propostas no topo da lista. "Em aberto" é a situação de hoje;
// aceites, recusas e valores contam o que foi registrado no período escolhido.
export default function ProposalSummary() {
  const [period, setPeriod] = useState("mes_atual");
  const [custom, setCustom] = useState(currentMonth);

  let range = null; // null = mês atual (padrão do servidor)
  let rangeError = "";
  if (period === "mes_anterior") range = previousMonth();
  if (period === "personalizado") {
    if (!custom.de || !custom.ate) rangeError = "Informe as duas datas do período.";
    else if (custom.de > custom.ate) rangeError = "A data inicial não pode ser depois da data final.";
    else range = custom;
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["commercial-proposals", "summary", range?.de || null, range?.ate || null],
    queryFn: () => commercialProposalsApi.summary(range || {}),
    enabled: !rangeError,
  });

  const periodo = data?.periodo;
  // Com o período inválido, os números não são exibidos — e o texto não cita o
  // período anterior como se fosse o escolhido.
  const periodText = periodo && !rangeError ? `${formatDateOnlyBR(periodo.de)} a ${formatDateOnlyBR(periodo.ate)}` : "";
  const porSituacao = data?.em_aberto_por_situacao;

  return (
    <section className="mb-6 space-y-3" aria-label="Resumo das propostas">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Resumo</h2>
          <p className="text-xs text-slate-500">
            &quot;Em aberto&quot; mostra a situação de hoje. Aceitas, recusadas e valores contam o que foi registrado
            {periodText ? ` de ${periodText}` : " no período escolhido"}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="proposal-summary-period" className="text-xs text-slate-500">Período</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger id="proposal-summary-period" className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {period === "personalizado" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="proposal-summary-from" className="text-xs text-slate-500">De</Label>
                <Input
                  id="proposal-summary-from"
                  type="date"
                  className="h-8 w-40 text-sm"
                  value={custom.de}
                  onChange={(e) => setCustom((current) => ({ ...current, de: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="proposal-summary-to" className="text-xs text-slate-500">Até</Label>
                <Input
                  id="proposal-summary-to"
                  type="date"
                  className="h-8 w-40 text-sm"
                  value={custom.ate}
                  onChange={(e) => setCustom((current) => ({ ...current, ate: e.target.value }))}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {rangeError ? (
        <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{rangeError}</p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando resumo...
        </div>
      ) : isError ? (
        <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {serverMessage(error, "Não foi possível carregar o resumo agora.")}
        </p>
      ) : (
        <div className="space-y-3">
          {/* Contagens: números curtos, cabem em três colunas em qualquer largura. */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard
              label="Em aberto hoje"
              value={data.em_aberto}
              hint={porSituacao ? `${porSituacao.elaborando} elaborando · ${porSituacao.enviada} enviada(s)` : null}
            />
            <SummaryCard label="Aceitas no período" value={data.aceitas} />
            <SummaryCard label="Recusadas no período" value={data.recusadas} />
          </div>
          {/* Valores: cada cartão tem no mínimo 13rem, o bastante para
              "R$ 1.234.567,89" numa linha; sem espaço, um fica embaixo do outro. */}
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
            <SummaryCard label="Valor mensal das aceitas" value={formatDecimalBRL(data.valor_mensalidade_aceitas)} hint="No período" />
            <SummaryCard label="Implantação das aceitas" value={formatDecimalBRL(data.valor_implantacao_aceitas)} hint="No período" />
          </div>
        </div>
      )}
    </section>
  );
}
