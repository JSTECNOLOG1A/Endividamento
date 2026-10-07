import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/notify";
import { formatCivilDate, todayInBrazil } from "@/lib/taxDates";
import { formatMoney, parseCurrencyField, toCurrencyField } from "@/lib/taxLabels";
import { isInstallmentConflict, undoesErpPayment, withInstallmentVersion } from "@/lib/taxInstallmentPayment";
import { useInvalidateTax } from "@/hooks/useTaxData";
import { FieldError, serverErrorField } from "./TaxBadges";
import { ErpPaymentNote, InstallmentConflictNotice, UndoErpPaymentDialog, useReloadInstallment } from "./TaxInstallmentConflict";

/**
 * Registra o pagamento de uma parcela: ela fica "Paga, aguardando reconhecimento" até constar no e-CAC/portal.
 * `amount` é o valor para pagamento (o da guia, quando há; senão o cadastrado) e só sugere o valor pago.
 */
export default function TaxPaymentDialog({ installment, amount, onOpenChange }) {
  const open = Boolean(installment);
  const today = todayInBrazil();
  const [paymentDate, setPaymentDate] = useState(today);
  const [amountPaid, setAmountPaid] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  // Parcela como a tela a carregou (a versão vai junto); troca só ao recarregar depois de um conflito.
  const [base, setBase] = useState(installment);
  const [conflict, setConflict] = useState("");
  const [reloaded, setReloaded] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const invalidateTax = useInvalidateTax();
  const reloader = useReloadInstallment();

  useEffect(() => {
    if (!installment) return;
    setPaymentDate(todayInBrazil());
    setAmountPaid(toCurrencyField(amount ?? installment.valor));
    setFieldErrors({});
    setBase(installment);
    setConflict("");
    setReloaded(null);
    setConfirmUndo(false);
  }, [installment]);

  const changes = () => ({
    situacao: "paga_aguardando_reconhecimento",
    data_pagamento: paymentDate || null,
    valor_pago: parseCurrencyField(amountPaid),
  });

  const mutation = useMutation({
    mutationFn: () => base44.entities.TaxInstallment.update(base.id, withInstallmentVersion(changes(), base)),
    onSuccess: async () => {
      toast.success("Pagamento registrado. A parcela agora consta como Paga, aguardando reconhecimento.");
      setConfirmUndo(false);
      await invalidateTax();
      onOpenChange(false);
    },
    onError: (error) => {
      setConfirmUndo(false);
      if (isInstallmentConflict(error)) {
        setReloaded(null);
        setConflict(error.message);
        return;
      }
      const field = serverErrorField(error);
      if (field) setFieldErrors({ [field]: error.message });
      toast.error(error.message);
    },
  });

  const busy = mutation.isPending;

  const submit = () => {
    if (undoesErpPayment(base, changes())) setConfirmUndo(true);
    else mutation.mutate();
  };

  const reload = async () => {
    const fresh = await reloader.reload(base.id);
    if (!fresh) return;
    setBase(fresh);
    setConflict("");
    setReloaded(fresh);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento da parcela {installment?.numero_parcela}</DialogTitle>
          <DialogDescription>
            Vencimento {formatCivilDate(installment?.vencimento)} · valor para pagamento {formatMoney(amount ?? installment?.valor)}. A parcela passa a constar
            como “Paga, aguardando reconhecimento”. Quando o pagamento aparecer no e-CAC/portal, use “Confirmar reconhecimento”
            para ela passar a “Paga”.
          </DialogDescription>
        </DialogHeader>
        <form
          id="tax-payment-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2 sm:col-span-2 empty:hidden">
            <ErpPaymentNote installment={base} />
            <InstallmentConflictNotice
              message={conflict}
              reloaded={reloaded}
              reloading={reloader.reloading}
              reloadError={reloader.error}
              today={todayInBrazil()}
              onReload={reload}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="pay-date">Data do pagamento</Label>
            <Input
              id="pay-date"
              type="date"
              max={today}
              className="h-9"
              value={paymentDate}
              onChange={(event) => {
                setPaymentDate(event.target.value);
                setFieldErrors({});
              }}
            />
            <FieldError message={fieldErrors.data_pagamento} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="pay-amount">Valor pago</Label>
            <CurrencyInput
              id="pay-amount"
              className="h-9"
              value={amountPaid}
              onChange={(event) => {
                setAmountPaid(event.target.value);
                setFieldErrors({});
              }}
              placeholder="0,00"
            />
            <FieldError message={fieldErrors.valor_pago} />
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="tax-payment-form" disabled={busy || Boolean(conflict)}>
            {busy ? "Registrando…" : "Registrar pagamento"}
          </Button>
        </DialogFooter>
        <UndoErpPaymentDialog
          open={confirmUndo}
          installment={base}
          busy={busy}
          onConfirm={() => mutation.mutate()}
          onCancel={() => setConfirmUndo(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
