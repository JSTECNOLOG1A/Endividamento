import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, BadgeCheck, CalendarCheck, CalendarPlus, FileText, Paperclip, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/notify";
import { formatCivilDate } from "@/lib/taxDates";
import { AGREEMENT_STATUS_LABELS, SPHERE_LABELS, formatMoney, isInstallmentOverdue } from "@/lib/taxLabels";
import { GUIDE_URL_PARAM, amountToPay, isGuideException } from "@/lib/taxGuides";
import { useAgreementInstallments, useInvalidateTax } from "@/hooks/useTaxData";
import { TaxErrorState } from "./TaxPageShell";
import { AmountToPay, GuideStatusBadge, InstallmentStatusBadge, ProvenanceNote, TaxSignalBadge } from "./TaxBadges";
import { NextInstallmentCell, SaldoCell } from "./TaxAgreementList";
import TaxInstallmentFormDialog from "./TaxInstallmentFormDialog";
import TaxPaymentDialog from "./TaxPaymentDialog";
import TaxScheduleDialog from "./TaxScheduleDialog";
import TaxConfirmDialog from "./TaxConfirmDialog";
import TaxGuideDialog from "./TaxGuideDialog";

function Info({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function countBy(installments, today, guidesByInstallment) {
  const counts = { aVencer: 0, vencidas: 0, aguardando: 0, pagas: 0, guiasEmExcecao: 0 };
  for (const item of installments) {
    if (item.situacao === "em_aberto") {
      if (isInstallmentOverdue(item, today)) counts.vencidas += 1;
      else counts.aVencer += 1;
      if (isGuideException(guidesByInstallment.get(item.id))) counts.guiasEmExcecao += 1;
    }
    if (item.situacao === "paga_aguardando_reconhecimento") counts.aguardando += 1;
    if (item.situacao === "reconhecida") counts.pagas += 1;
  }
  return counts;
}

export default function TaxAgreementDetail({ row, guidesByInstallment, actions, onBack }) {
  const { agreement, entityName } = row;
  const { installments, isLoading: installmentsLoading, error: installmentsError, refetch: refetchInstallments } =
    useAgreementInstallments(agreement.id);
  const installmentsReady = !installmentsLoading && !installmentsError;
  const { canWrite, portalName, today } = actions;
  const invalidateTax = useInvalidateTax();

  const [installmentForm, setInstallmentForm] = useState({ open: false, installment: null });
  const [payingInstallment, setPayingInstallment] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [deletingInstallment, setDeletingInstallment] = useState(null);

  // A guia aberta fica na URL: a Visão geral leva direto a ela, e voltar no navegador a fecha.
  const [searchParams, setSearchParams] = useSearchParams();
  const guideInstallmentId = searchParams.get(GUIDE_URL_PARAM);
  const guideInstallment = guideInstallmentId ? installments.find((item) => item.id === guideInstallmentId) || null : null;
  const setGuideInstallment = (installment) => {
    const next = new URLSearchParams(searchParams);
    if (installment) next.set(GUIDE_URL_PARAM, installment.id);
    else next.delete(GUIDE_URL_PARAM);
    setSearchParams(next);
  };

  const recognizeMutation = useMutation({
    mutationFn: (installment) => base44.entities.TaxInstallment.update(installment.id, { situacao: "reconhecida" }),
    onSuccess: async () => {
      toast.success("Reconhecimento confirmado. A parcela agora consta como Paga.");
      await invalidateTax();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteInstallmentMutation = useMutation({
    mutationFn: (installment) => base44.entities.TaxInstallment.delete(installment.id),
    onSuccess: async () => {
      toast.success("Parcela excluída");
      setDeletingInstallment(null);
      await invalidateTax();
    },
    onError: (err) => toast.error(err.message),
  });

  const counts = countBy(installments, today, guidesByInstallment);
  const confirmedToday = agreement.ultima_conferencia === today;
  const quantity = agreement.qtd_parcelas;

  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1.5 text-slate-600" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Voltar para a lista
      </Button>

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">
              Parcelamento {SPHERE_LABELS[agreement.esfera]?.toLowerCase()} · {agreement.orgao}
              {agreement.uf ? ` · ${agreement.uf}` : ""}
            </p>
            <h2 className="mt-0.5 break-words text-lg font-bold text-slate-900">nº {agreement.codigo_parcelamento}</h2>
            <p className="text-sm text-slate-600">{entityName}</p>
          </div>
          <TaxSignalBadge signal={row.signal} recordsSignal={row.recordsSignal} situacao={agreement.situacao} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
          <ProvenanceNote origem={agreement.origem_dado} ultimaConferencia={agreement.ultima_conferencia} className="text-xs" />
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto h-8 gap-1.5 bg-white"
              disabled={confirmedToday || actions.confirmingId === agreement.id}
              onClick={() => actions.onConfirmToday(row)}
            >
              <CalendarCheck className="h-4 w-4" />
              {confirmedToday ? `Conferido hoje no ${portalName}` : `Conferi hoje no ${portalName}`}
            </Button>
          ) : null}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          <Info label="Modalidade">{agreement.modalidade}</Info>
          <Info label="Tributo">{agreement.tributo}</Info>
          <Info label="Situação do acordo">{AGREEMENT_STATUS_LABELS[agreement.situacao]}</Info>
          <Info label="Data de adesão">{formatCivilDate(agreement.data_adesao)}</Info>
          <Info label="Quantidade de parcelas">{quantity ? String(quantity) : null}</Info>
          <Info label="Saldo informado"><SaldoCell agreement={agreement} /></Info>
          <Info label="Próxima parcela">
            <NextInstallmentCell installment={row.nextInstallment} guide={row.nextInstallmentGuide} today={today} />
          </Info>
        </dl>
        {agreement.observacoes ? (
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{agreement.observacoes}</p>
        ) : null}

        {canWrite ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => actions.onEdit(row)}>
              <Pencil className="h-4 w-4" />
              Editar parcelamento
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-rose-600 hover:text-rose-700"
              onClick={() => actions.onDelete(row)}
            >
              <Trash2 className="h-4 w-4" />
              Excluir parcelamento
            </Button>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Parcelas</h3>
            {installmentsReady ? (
              <p className="text-xs text-slate-500">
                {installments.length} {installments.length === 1 ? "cadastrada" : "cadastradas"}
                {quantity ? ` de ${quantity} combinadas` : ""} · {counts.aVencer} a vencer · {counts.vencidas}{" "}
                {counts.vencidas === 1 ? "vencida" : "vencidas"} · {counts.aguardando}{" "}
                {counts.aguardando === 1 ? "paga, aguardando reconhecimento" : "pagas, aguardando reconhecimento"} · {counts.pagas}{" "}
                {counts.pagas === 1 ? "paga" : "pagas"}
                {counts.guiasEmExcecao ? (
                  <span className="font-medium text-amber-800">
                    {" "}· {counts.guiasEmExcecao} {counts.guiasEmExcecao === 1 ? "guia em exceção" : "guias em exceção"}
                  </span>
                ) : null}
              </p>
            ) : null}
            <ProvenanceNote origem={agreement.origem_dado} ultimaConferencia={agreement.ultima_conferencia} className="mt-1" />
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!installmentsReady} onClick={() => setScheduleOpen(true)}>
                <CalendarPlus className="h-4 w-4" />
                Gerar parcelas
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={!installmentsReady}
                onClick={() => setInstallmentForm({ open: true, installment: null })}
              >
                <Plus className="h-4 w-4" />
                Nova parcela
              </Button>
            </div>
          ) : null}
        </div>

        {installmentsLoading ? (
          <p className="p-6 text-center text-xs text-slate-500">Carregando parcelas…</p>
        ) : installmentsError ? (
          <div className="p-4">
            <TaxErrorState title="Não foi possível carregar as parcelas" message={installmentsError.message} onRetry={refetchInstallments} />
          </div>
        ) : installments.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">
            Nenhuma parcela cadastrada.{" "}
            {canWrite ? "Use “Gerar parcelas” para criar todas de uma vez a partir do 1º vencimento, ou inclua uma a uma." : ""}
          </p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="border-b-2 border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Nº</th>
                  <th className="px-3 py-2 font-semibold">Vencimento</th>
                  <th className="px-3 py-2 text-right font-semibold">Valor</th>
                  <th className="px-3 py-2 font-semibold">Situação</th>
                  <th className="px-3 py-2 font-semibold">Guia</th>
                  <th className="px-3 py-2 font-semibold">Pagamento</th>
                  {canWrite ? <th className="px-3 py-2"><span className="sr-only">Ações</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {installments.map((item) => {
                  const exceeds = Boolean(quantity) && item.numero_parcela > quantity;
                  const guide = guidesByInstallment.get(item.id) || null;
                  return (
                    <tr key={item.id} className="align-middle">
                      <td className="px-3 py-2 tabular-nums font-medium text-slate-900">
                        <span className="inline-flex items-center gap-1">
                          {item.numero_parcela}
                          {exceeds ? (
                            <span title={`Passa da quantidade de parcelas do acordo (${quantity})`}>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                              <span className="sr-only">Passa da quantidade de parcelas do acordo ({quantity})</span>
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{formatCivilDate(item.vencimento)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-800">
                        <AmountToPay installment={item} guide={guide} align="right" />
                      </td>
                      <td className="px-3 py-2"><InstallmentStatusBadge installment={item} today={today} /></td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <GuideStatusBadge guide={guide} />
                          {guide || canWrite ? (
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto gap-1 p-0 text-xs"
                              aria-label={`${guide ? "Ver guia" : "Anexar guia"} da parcela ${item.numero_parcela}`}
                              onClick={() => setGuideInstallment(item)}
                            >
                              {guide ? <FileText className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
                              {guide ? "Ver guia" : "Anexar guia"}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums leading-tight text-slate-600">
                        {item.data_pagamento ? (
                          <>
                            <span className="block">{formatCivilDate(item.data_pagamento)}</span>
                            {item.valor_pago !== null && item.valor_pago !== undefined ? (
                              <span className="block text-[11px] text-slate-500">{formatMoney(item.valor_pago)}</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      {canWrite ? (
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {item.situacao === "em_aberto" ? (
                              <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setPayingInstallment(item)}>
                                <Wallet className="h-3.5 w-3.5" />
                                Registrar pagamento
                              </Button>
                            ) : null}
                            {item.situacao === "paga_aguardando_reconhecimento" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={recognizeMutation.isPending && recognizeMutation.variables?.id === item.id}
                                onClick={() => recognizeMutation.mutate(item)}
                              >
                                <BadgeCheck className="h-3.5 w-3.5" />
                                Confirmar reconhecimento
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Editar parcela"
                              aria-label={`Editar parcela ${item.numero_parcela}`}
                              onClick={() => setInstallmentForm({ open: true, installment: item })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-rose-600 hover:text-rose-700"
                              title="Excluir parcela"
                              aria-label={`Excluir parcela ${item.numero_parcela}`}
                              onClick={() => setDeletingInstallment(item)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TaxInstallmentFormDialog
        open={installmentForm.open}
        onOpenChange={(open) => setInstallmentForm((current) => ({ ...current, open }))}
        agreement={agreement}
        installment={installmentForm.installment}
        installments={installments}
      />
      <TaxPaymentDialog
        installment={payingInstallment}
        amount={payingInstallment ? amountToPay(payingInstallment, guidesByInstallment.get(payingInstallment.id)) : null}
        onOpenChange={(open) => { if (!open) setPayingInstallment(null); }}
      />
      <TaxGuideDialog
        installment={guideInstallment}
        agreement={agreement}
        entityName={entityName}
        canWrite={canWrite}
        onOpenChange={(open) => { if (!open) setGuideInstallment(null); }}
      />
      <TaxScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} agreement={agreement} installments={installments} />
      <TaxConfirmDialog
        open={Boolean(deletingInstallment)}
        title={`Excluir a parcela ${deletingInstallment?.numero_parcela ?? ""}?`}
        description={`Vencimento ${formatCivilDate(deletingInstallment?.vencimento)} · ${formatMoney(deletingInstallment?.valor)}. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir parcela"
        busy={deleteInstallmentMutation.isPending}
        onConfirm={() => deleteInstallmentMutation.mutate(deletingInstallment)}
        onCancel={() => setDeletingInstallment(null)}
      />
    </div>
  );
}
