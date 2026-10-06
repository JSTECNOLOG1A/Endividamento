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
import { useInvalidateTax } from "@/hooks/useTaxData";
import { FieldError, serverErrorField } from "./TaxBadges";

/** Registra o pagamento de uma parcela: ela fica "Paga, aguardando reconhecimento" até constar no e-CAC/portal. */
export default function TaxPaymentDialog({ installment, onOpenChange }) {
  const open = Boolean(installment);
  const today = todayInBrazil();
  const [paymentDate, setPaymentDate] = useState(today);
  const [amountPaid, setAmountPaid] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const invalidateTax = useInvalidateTax();

  useEffect(() => {
    if (!installment) return;
    setPaymentDate(todayInBrazil());
    setAmountPaid(toCurrencyField(installment.valor));
    setFieldErrors({});
  }, [installment]);

  const mutation = useMutation({
    mutationFn: () =>
      base44.entities.TaxInstallment.update(installment.id, {
        situacao: "paga_aguardando_reconhecimento",
        data_pagamento: paymentDate || null,
        valor_pago: parseCurrencyField(amountPaid),
      }),
    onSuccess: async () => {
      toast.success("Pagamento registrado. A parcela agora consta como Paga, aguardando reconhecimento.");
      await invalidateTax();
      onOpenChange(false);
    },
    onError: (error) => {
      const field = serverErrorField(error);
      if (field) setFieldErrors({ [field]: error.message });
      toast.error(error.message);
    },
  });

  const busy = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento da parcela {installment?.numero_parcela}</DialogTitle>
          <DialogDescription>
            Vencimento {formatCivilDate(installment?.vencimento)} · valor {formatMoney(installment?.valor)}. A parcela passa a constar
            como “Paga, aguardando reconhecimento”. Quando o pagamento aparecer no e-CAC/portal, use “Confirmar reconhecimento”
            para ela passar a “Paga”.
          </DialogDescription>
        </DialogHeader>
        <form
          id="tax-payment-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
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
          <Button type="submit" form="tax-payment-form" disabled={busy}>
            {busy ? "Registrando…" : "Registrar pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
