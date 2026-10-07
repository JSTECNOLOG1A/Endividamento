import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CircleSlash, Eye, Landmark, Loader2, MoreHorizontal, RefreshCw, Search, Upload } from "lucide-react";
import { taxTitlesApi } from "@/api/taxTitles";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { formatCivilDate } from "@/lib/taxDates";
import { formatDateTime } from "@/lib/taxGuides";
import { formatMoney } from "@/lib/taxLabels";
import {
  TAX_TITLE_FORECAST_LABEL,
  TAX_TITLE_URL_PARAM,
  filterTaxTitles,
  isTaxTitleForecast,
  formatPaymentLine,
  taxTitleActionOutcome,
  taxTitleKey,
  taxTitleOrigin,
  taxTitleSituationOptions,
  taxTitleTotals,
} from "@/lib/taxTitles";
import { TAX_QUERY_KEYS, useInvalidateTaxTitles, usePayableTaxTitles } from "@/hooks/useTaxData";
import TaxConfirmDialog from "@/components/tax/TaxConfirmDialog";
import { CopyableCode, TaxTitleBadge, TaxTitleNotes } from "@/components/tax/TaxTitleStatus";

const ALL = "__all__";

const ACTIONS = {
  integrate: { call: taxTitlesApi.integrate, busy: "Enviando ao Protheus…" },
  consult: { call: taxTitlesApi.consult, busy: "Consultando no Protheus…" },
  confirmAbsence: { call: taxTitlesApi.confirmAbsence, busy: "Confirmando…" },
};

function date(value) {
  return value ? formatCivilDate(String(value).slice(0, 10)) || "—" : "—";
}

/** Marca do dado previsto a partir da guia (título pendente). */
function ForecastTag({ className, title = TAX_TITLE_FORECAST_LABEL }) {
  return (
    <span title={title} className={cn("inline-block rounded bg-amber-50 px-1 text-[10px] font-medium normal-case tracking-normal text-amber-800", className)}>
      previsto
    </span>
  );
}

/** Célula da tabela: valor com a marca "previsto" no título pendente; vazio, "—" com a explicação no toque. */
function ForecastCell({ forecast, children, align = "left" }) {
  const filled = children !== null && children !== undefined && children !== "";
  if (!filled) {
    return (
      <span className="text-slate-400" title={forecast ? "Ainda não dá para prever: veja o motivo na situação." : undefined}>—</span>
    );
  }
  return (
    <span className={cn("block leading-tight", align === "right" && "text-right")}>
      <span className="block">{children}</span>
      {forecast ? <ForecastTag className="mt-0.5" /> : null}
    </span>
  );
}

/** `forecast`: o dado é previsto; `emptyHint`: o que dizer no lugar do "—". */
function Field({ label, children, span = false, forecast = false, emptyHint = null }) {
  const filled = children !== null && children !== undefined && children !== "" && children !== false;
  return (
    <div className={cn("min-w-0", span && "col-span-2")}>
      <dt className="flex flex-wrap items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
        {forecast && filled ? <ForecastTag /> : null}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">
        {filled ? children : (
          <>
            <span className="text-slate-400">—</span>
            {emptyHint ? <span className="block text-[11px] text-slate-500">{emptyHint}</span> : null}
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * Ações do título de tributo que a pessoa pode fazer agora. O servidor diz quais valem para o título; integrar e
 * confirmar ausência ficam com o proprietário (como nos empréstimos), consultar com quem tem escrita.
 */
function availableActions(title, { canOwnerErp, canWrite }) {
  if (!title) return [];
  const list = [];
  if (canOwnerErp && title.pode_integrar) list.push({ kind: "integrate", label: "Integrar no Protheus", icon: Upload });
  if (canWrite && title.pode_consultar) list.push({ kind: "consult", label: "Consultar no Protheus", icon: RefreshCw });
  if (canOwnerErp && title.pode_confirmar_ausencia) {
    list.push({ kind: "confirmAbsence", label: "Confirmar ausência", icon: CircleSlash, danger: true });
  }
  return list;
}

function TaxTitleViewDialog({ title, notFound, permissions, runningKind, onAction, onOpenChange }) {
  const open = Boolean(title) || notFound;
  const actions = availableActions(title, permissions);
  const forecast = isTaxTitleForecast(title);
  const unknown = forecast ? "Ainda não dá para prever: veja o motivo acima." : null;
  const atSend = forecast ? "Definido no envio ao Protheus." : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        {title ? (
          <>
            <DialogHeader>
              <DialogTitle>Título de tributo</DialogTitle>
              <DialogDescription>{taxTitleOrigin(title)}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <TaxTitleBadge title={title} />
                <TaxTitleNotes title={title} />
              </div>
              {forecast ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span className="font-semibold">Dados previstos, ainda não enviados ao Protheus.</span> Vêm da guia vinculada e da configuração
                  em Configurações → Lógica Contábil e podem mudar até o envio. Campo com “—” ainda não pode ser previsto: falta
                  guia vinculada com valor ou falta configurar tipo, prefixo, natureza ou fornecedor dos tributos.
                </p>
              ) : null}
              <dl className="grid grid-cols-2 gap-3">
                <Field label="Empresa">{title.entity_name}</Field>
                <Field label="Órgão">{title.orgao}</Field>
                <Field label="Parcelamento">{title.codigo_parcelamento ? `nº ${title.codigo_parcelamento}` : null}</Field>
                <Field label="Parcela">{title.numero_parcela !== null && title.numero_parcela !== undefined ? String(title.numero_parcela) : null}</Field>
                <Field label="Título no Protheus" forecast={forecast} emptyHint={unknown}>{taxTitleKey(title)}</Field>
                <Field label="Tipo" forecast={forecast} emptyHint={unknown}>{title.tipo}</Field>
                <Field label="Natureza" forecast={forecast} emptyHint={unknown}>{title.natureza}</Field>
                <Field label="Fornecedor / loja" forecast={forecast} emptyHint={unknown}>
                  {title.fornecedor ? `${title.fornecedor}${title.loja ? ` / ${title.loja}` : ""}` : null}
                </Field>
                <Field label="Filial" emptyHint={atSend}>{title.filial ? `${title.filial}${title.fil_orig ? ` (origem ${title.fil_orig})` : ""}` : null}</Field>
                <Field label="Emissão" emptyHint={atSend}>{title.emissao ? date(title.emissao) : null}</Field>
                <Field label="Vencimento" forecast={forecast} emptyHint={unknown}>{title.vencimento ? date(title.vencimento) : null}</Field>
                <Field label="Valor" forecast={forecast} emptyHint={unknown}>
                  {title.valor !== null && title.valor !== undefined ? formatMoney(title.valor) : null}
                </Field>
                <Field label="Saldo no Protheus">{title.saldo !== null && title.saldo !== undefined ? formatMoney(title.saldo) : null}</Field>
                <Field label="Data da baixa">{title.baixa_data ? date(title.baixa_data) : null}</Field>
                <Field label="Linha digitável" span forecast={forecast} emptyHint={unknown}>
                  {title.linha_digitavel ? (
                    <CopyableCode label="Linha digitável" value={title.linha_digitavel} display={formatPaymentLine(title.linha_digitavel)} />
                  ) : null}
                </Field>
                <Field label="Código de barras" span forecast={forecast} emptyHint={unknown}>
                  {title.codigo_barras ? <CopyableCode label="Código de barras" value={title.codigo_barras} /> : null}
                </Field>
                <Field label="Histórico" span forecast={forecast} emptyHint={unknown}>{title.historico}</Field>
                <Field label="Enviado ao Protheus em">{title.enviado_em ? formatDateTime(title.enviado_em) : null}</Field>
                <Field label="Estornado em">{title.estornado_em ? formatDateTime(title.estornado_em) : null}</Field>
                <Field label="Última consulta no Protheus">{title.consultado_em ? formatDateTime(title.consultado_em) : null}</Field>
              </dl>
            </div>
            {actions.length ? (
              <DialogFooter className="gap-2 sm:gap-2">
                {actions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Button
                      key={action.kind}
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn("gap-1.5", action.danger && "text-rose-700 hover:text-rose-800")}
                      disabled={Boolean(runningKind)}
                      onClick={() => onAction(action.kind, title)}
                    >
                      {runningKind === action.kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                      {runningKind === action.kind ? ACTIONS[action.kind].busy : action.label}
                    </Button>
                  );
                })}
              </DialogFooter>
            ) : null}
          </>
        ) : (
          <DialogHeader>
            <DialogTitle>Título de tributo não encontrado</DialogTitle>
            <DialogDescription>Ele pode ter sido excluído junto com a parcela. Confira a lista de títulos de tributo.</DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Títulos a pagar das parcelas de tributo, em Contas a Pagar — lista e ações próprias, separadas dos títulos de
 * empréstimo. A busca e a empresa vêm dos filtros do topo da página; a situação tem filtro próprio.
 */
export default function TaxPayableTitlesSection({ search, entityId, canOwnerErp, canWrite }) {
  const permissions = { canOwnerErp, canWrite };
  const queryClient = useQueryClient();
  const sectionRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedId = searchParams.get(TAX_TITLE_URL_PARAM);
  const [situacao, setSituacao] = useState(ALL);
  const [confirmingAbsence, setConfirmingAbsence] = useState(null);
  const { titles, isLoading, isFetching, error, refetch } = usePayableTaxTitles();
  const invalidateTaxTitles = useInvalidateTaxTitles();

  const rows = filterTaxTitles(titles, { term: search, entityId, situacao: situacao === ALL ? null : situacao });
  const totals = taxTitleTotals(rows);
  const situationOptions = taxTitleSituationOptions(titles);
  const viewTitle = linkedId ? titles.find((item) => item.id === linkedId) || null : null;
  const linkNotFound = Boolean(linkedId) && !isLoading && !error && !viewTitle;

  // Atalho vindo da parcela: leva a página até os títulos de tributo.
  useEffect(() => {
    if (linkedId) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [linkedId]);

  const setLinked = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set(TAX_TITLE_URL_PARAM, id);
    else next.delete(TAX_TITLE_URL_PARAM);
    setSearchParams(next, { replace: !id });
  };

  const mutation = useMutation({
    mutationFn: ({ kind, title }) => ACTIONS[kind].call(title.id),
    onSuccess: async (updated) => {
      if (updated?.id) {
        queryClient.setQueryData(TAX_QUERY_KEYS.payableTitles, (current) =>
          Array.isArray(current) ? current.map((item) => (item.id === updated.id ? updated : item)) : current
        );
      }
      setConfirmingAbsence(null);
      const outcome = taxTitleActionOutcome(updated);
      toast[outcome.type](outcome.message, outcome.description ? { description: outcome.description } : undefined);
      await invalidateTaxTitles();
    },
    onError: async (err) => {
      setConfirmingAbsence(null);
      toast.error(err.message);
      // Ocupado ou fora de conferência: a lista pode estar velha.
      if (err?.status === 409) await invalidateTaxTitles();
    },
  });

  const runningFor = (title) => (mutation.isPending && mutation.variables?.title.id === title?.id ? mutation.variables.kind : null);

  const runAction = (kind, title) => {
    if (kind === "confirmAbsence") setConfirmingAbsence(title);
    else mutation.mutate({ kind, title });
  };

  let body;
  if (isLoading) {
    body = (
      <p className="flex items-center justify-center gap-2 p-8 text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Carregando títulos de tributo…
      </p>
    );
  } else if (error) {
    body = (
      <div role="alert" className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-center">
        <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-rose-700">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Não foi possível carregar os títulos de tributo
        </p>
        <p className="mt-1 text-xs text-rose-600">
          {error.message} Os títulos de empréstimo acima não são afetados.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-3 bg-white" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  } else if (titles.length === 0) {
    body = (
      <div className="p-8 text-center">
        <p className="text-sm font-medium text-slate-600">Nenhum título de tributo a pagar</p>
        <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">
          O título é criado quando a guia de uma parcela fica vinculada em Gestão Tributária, com o valor e o código de
          barras da guia.
        </p>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="p-8 text-center">
        <p className="text-sm font-medium text-slate-600">Nenhum título de tributo neste filtro</p>
        <p className="mt-1 text-xs text-slate-500">A busca e a entidade escolhidas no topo da página também valem aqui.</p>
        {situacao !== ALL ? (
          <Button type="button" variant="outline" className="mt-4 h-8 text-xs" onClick={() => setSituacao(ALL)}>
            Ver todas as situações
          </Button>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-[11px]">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-600">
              <th className="h-10 px-3 align-middle font-medium">Situação</th>
              <th className="h-10 px-2 align-middle font-medium">Entidade</th>
              <th className="h-10 px-2 align-middle font-medium">Tributo</th>
              <th className="h-10 px-2 align-middle font-medium">Título</th>
              <th className="h-10 px-2 align-middle font-medium">Vencimento</th>
              <th className="h-10 px-2 text-right align-middle font-medium">Valor</th>
              <th className="h-10 px-2 text-right align-middle font-medium">Saldo</th>
              <th className="h-10 px-2 align-middle font-medium">Linha digitável</th>
              <th className="sticky right-0 h-10 bg-slate-50 px-3 text-right align-middle font-medium shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((title) => {
              const actions = availableActions(title, permissions);
              const forecast = isTaxTitleForecast(title);
              const running = runningFor(title);
              return (
                <tr
                  key={title.id}
                  className={cn("cursor-pointer border-b last:border-0 hover:bg-slate-50/80", linkedId === title.id && "bg-sky-50/70")}
                  onDoubleClick={() => setLinked(title.id)}
                >
                  <td className="max-w-[260px] px-3 py-1.5 align-top">
                    <TaxTitleBadge title={title} />
                    <TaxTitleNotes title={title} compact className="mt-0.5" />
                  </td>
                  <td className="max-w-[170px] truncate px-2 py-1.5 align-top font-medium text-slate-800" title={title.entity_name || ""}>
                    {title.entity_name || "—"}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                      <Landmark className="h-3 w-3" aria-hidden="true" />
                      Tributo
                    </span>
                    <span className="mt-0.5 block whitespace-nowrap text-slate-700">nº {title.codigo_parcelamento || "—"} · parcela {title.numero_parcela ?? "—"}</span>
                    <span className="block max-w-[200px] truncate text-slate-500" title={title.orgao || ""}>{title.orgao || "—"}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-top text-slate-700">
                    <ForecastCell forecast={forecast}>{taxTitleKey(title)}</ForecastCell>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-top text-slate-600">
                    <ForecastCell forecast={forecast}>{title.vencimento ? date(title.vencimento) : null}</ForecastCell>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right align-top tabular-nums">
                    <ForecastCell forecast={forecast} align="right">
                      {title.valor !== null && title.valor !== undefined ? formatMoney(title.valor) : null}
                    </ForecastCell>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right align-top tabular-nums">
                    {title.saldo !== null && title.saldo !== undefined ? formatMoney(title.saldo) : "—"}
                  </td>
                  <td className="max-w-[260px] px-2 py-1 align-top" onDoubleClick={(event) => event.stopPropagation()}>
                    {title.linha_digitavel ? (
                      <CopyableCode label="Linha digitável" value={title.linha_digitavel} display={formatPaymentLine(title.linha_digitavel)} />
                    ) : title.codigo_barras ? (
                      <CopyableCode label="Código de barras" value={title.codigo_barras} />
                    ) : (
                      <ForecastCell forecast={forecast}>{null}</ForecastCell>
                    )}
                    {forecast && (title.linha_digitavel || title.codigo_barras) ? <ForecastTag /> : null}
                  </td>
                  <td
                    className="sticky right-0 bg-white px-3 py-1.5 text-right align-top shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]"
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-600"
                          aria-label={`Ações do título de tributo da parcela ${title.numero_parcela ?? ""}`}
                        >
                          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setLinked(title.id)}>
                          <Eye className="mr-2 h-3.5 w-3.5" />
                          Visualizar
                        </DropdownMenuItem>
                        {actions.map((action) => {
                          const Icon = action.icon;
                          return (
                            <DropdownMenuItem
                              key={action.kind}
                              className={action.danger ? "text-rose-700" : undefined}
                              disabled={Boolean(running)}
                              onClick={() => runAction(action.kind, title)}
                            >
                              <Icon className="mr-2 h-3.5 w-3.5" />
                              {action.label}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-slate-50">
              <td className="px-3 py-1.5 font-medium text-slate-600" colSpan={5}>
                {rows.length} {rows.length === 1 ? "título de tributo" : "títulos de tributo"}
                {rows.some(isTaxTitleForecast) ? <span className="font-normal text-slate-500"> · o total inclui valores previstos</span> : null}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800">{formatMoney(totals.valor)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800">{formatMoney(totals.saldo)}</td>
              <td />
              <td className="sticky right-0 bg-slate-50" />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  return (
    <section ref={sectionRef} id="titulos-de-tributo" className="mt-6 scroll-mt-4 rounded-lg border border-slate-200 bg-white" aria-labelledby="titulos-de-tributo-titulo">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 id="titulos-de-tributo-titulo" className="flex items-center gap-1.5 text-base font-semibold text-slate-900">
            <Landmark className="h-4 w-4 text-violet-700" aria-hidden="true" />
            Títulos de tributo
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Parcelas de tributo com guia vinculada (Gestão Tributária). Vão ao Protheus com o valor e o código de barras da guia,
            separadas dos títulos de empréstimo. Situação e saldo vêm do Protheus.
          </p>
          {!canWrite ? (
            <p className="mt-1 text-xs text-slate-500">Você pode ver a lista; as ações ficam com quem tem permissão de edição.</p>
          ) : !canOwnerErp ? (
            <p className="mt-1 text-xs text-slate-500">
              Integrar e confirmar ausência ficam com o proprietário, como nos títulos de empréstimo; você pode consultar no Protheus.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2 lg:shrink-0 lg:flex-nowrap">
          <div className="w-full space-y-1 sm:w-48">
            <Label htmlFor="tax-title-situation" className="text-xs font-medium uppercase tracking-wider text-slate-600">Situação</Label>
            <Select value={situacao} onValueChange={setSituacao} disabled={!titles.length}>
              <SelectTrigger id="tax-title-situation" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas</SelectItem>
                {situationOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar lista
          </Button>
        </div>
      </div>
      {search?.trim() || entityId ? (
        <p className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-500">
          <Search className="h-3 w-3 shrink-0" aria-hidden="true" />
          Filtrado pela busca e pela entidade do topo da página.
        </p>
      ) : null}
      {body}

      <TaxTitleViewDialog
        title={viewTitle}
        notFound={linkNotFound}
        permissions={permissions}
        runningKind={runningFor(viewTitle)}
        onAction={runAction}
        onOpenChange={(open) => { if (!open) setLinked(null); }}
      />
      <TaxConfirmDialog
        open={Boolean(confirmingAbsence)}
        title="Confirmar que o título não existe no Protheus?"
        description={
          `Use só depois de procurar o título ${taxTitleKey(confirmingAbsence) || ""} no Protheus e ter certeza de que ele não está lá. ` +
          "O AllDebt passa a tratá-lo como fora do Protheus (estornado) e, se a guia da parcela continuar vinculada, envia um título novo. " +
          "Se o título existir e você confirmar, a parcela pode ficar com dois títulos a pagar no Protheus."
        }
        confirmLabel="Confirmar ausência"
        busy={mutation.isPending && mutation.variables?.kind === "confirmAbsence"}
        busyLabel="Confirmando…"
        onConfirm={() => mutation.mutate({ kind: "confirmAbsence", title: confirmingAbsence })}
        onCancel={() => setConfirmingAbsence(null)}
      />
    </section>
  );
}
