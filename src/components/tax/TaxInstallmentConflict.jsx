import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { formatCivilDate } from "@/lib/taxDates";
import { formatMoney, installmentStatusLabel } from "@/lib/taxLabels";
import { erpPaymentNote } from "@/lib/taxInstallmentPayment";
import { useInvalidateTax } from "@/hooks/useTaxData";
import TaxConfirmDialog from "./TaxConfirmDialog";

/**
 * Recarregar a parcela depois de um conflito de versão: lê a parcela atual (com a versão nova) e atualiza as listas.
 * @returns {{ reload: (id: string) => Promise<object | null>, reloading: boolean, error: string }}
 */
export function useReloadInstallment() {
  const invalidateTax = useInvalidateTax();
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState("");
  const reload = async (id) => {
    setReloading(true);
    setError("");
    try {
      const fresh = await base44.entities.TaxInstallment.get(id);
      await invalidateTax();
      return fresh;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setReloading(false);
    }
  };
  return { reload, reloading, error };
}

/** Resumo da parcela como está agora (depois de recarregar), para a pessoa conferir antes de salvar de novo. */
function CurrentSummary({ installment, today }) {
  const parts = [`Situação: ${installmentStatusLabel(installment, today)}`];
  if (installment.data_pagamento) parts.push(`pago em ${formatCivilDate(installment.data_pagamento)}`);
  if (installment.valor_pago !== null && installment.valor_pago !== undefined) parts.push(formatMoney(installment.valor_pago));
  const erpNote = erpPaymentNote(installment);
  return (
    <span className="block">
      {parts.join(" · ")}
      {erpNote ? <span className="block">{erpNote}.</span> : null}
    </span>
  );
}

/**
 * Aviso de conflito (409 TAX_INSTALLMENT_CHANGED / TAX_INSTALLMENT_PAID_BY_ERP) com o botão de recarregar; depois de
 * recarregar, o resumo da parcela atual e, se o formulário guarda o que foi digitado, a opção de descartar.
 */
export function InstallmentConflictNotice({ message, reloaded, reloading, reloadError, today, onReload, onUseCurrent }) {
  if (reloaded) {
    return (
      <div role="status" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        <p className="flex items-start gap-1.5 font-medium">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Parcela recarregada. Confira como ela está agora antes de salvar:
        </p>
        <div className="mt-1 pl-5">
          <CurrentSummary installment={reloaded} today={today} />
          {onUseCurrent ? (
            <p className="mt-1">
              O que você digitou foi mantido.{" "}
              <button type="button" className="font-medium underline underline-offset-2" onClick={onUseCurrent}>
                Usar os dados atuais da parcela
              </button>
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </p>
      {reloadError ? <p className="mt-1 pl-5 text-rose-700">Não foi possível recarregar: {reloadError}</p> : null}
      <Button type="button" variant="outline" size="sm" className="ml-5 mt-2 h-7 gap-1.5 bg-white text-xs" disabled={reloading} onClick={onReload}>
        {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {reloading ? "Recarregando…" : "Recarregar a parcela"}
      </Button>
    </div>
  );
}

/** Nota fixa da parcela paga pela baixa no Protheus (formulários e guia). */
export function ErpPaymentNote({ installment, className }) {
  const note = erpPaymentNote(installment);
  if (!note) return null;
  return <p className={className ?? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"}>{note}.</p>;
}

/** Confirmação antes de desfazer ou trocar um pagamento que veio da baixa no Protheus. */
export function UndoErpPaymentDialog({ open, installment, busy, onConfirm, onCancel }) {
  return (
    <TaxConfirmDialog
      open={open}
      title="Alterar o pagamento registrado pelo Protheus?"
      description={
        `${erpPaymentNote(installment) || "O pagamento desta parcela veio da baixa no Protheus"}. ` +
        "Ao salvar, o pagamento passa a ser o informado aqui, à mão, e o AllDebt não o muda mais pela baixa. " +
        "O título de tributo continua pago no Protheus: se o pagamento não aconteceu, acerte também lá."
      }
      confirmLabel="Alterar mesmo assim"
      busy={busy}
      busyLabel="Salvando…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
