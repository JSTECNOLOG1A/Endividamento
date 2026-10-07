import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/notify";
import { todayInBrazil } from "@/lib/taxDates";
import {
  INSTALLMENT_STATUS_OPTIONS,
  PAID_INSTALLMENT_STATUSES,
  parseCurrencyField,
  toCurrencyField,
} from "@/lib/taxLabels";
import { isInstallmentConflict, undoesErpPayment, withInstallmentVersion } from "@/lib/taxInstallmentPayment";
import { useInvalidateTax } from "@/hooks/useTaxData";
import { FieldError, serverErrorField } from "./TaxBadges";
import { ErpPaymentNote, InstallmentConflictNotice, UndoErpPaymentDialog, useReloadInstallment } from "./TaxInstallmentConflict";

function nextNumber(installments) {
  return installments.reduce((max, item) => Math.max(max, item.numero_parcela || 0), 0) + 1;
}

function toForm(installment, installments) {
  if (!installment) {
    return {
      numero_parcela: String(nextNumber(installments)),
      vencimento: "",
      valor: "",
      situacao: "em_aberto",
      data_pagamento: "",
      valor_pago: "",
      observacoes: "",
    };
  }
  return {
    numero_parcela: String(installment.numero_parcela ?? ""),
    vencimento: installment.vencimento || "",
    valor: toCurrencyField(installment.valor),
    situacao: installment.situacao || "em_aberto",
    data_pagamento: installment.data_pagamento || "",
    valor_pago: toCurrencyField(installment.valor_pago),
    observacoes: installment.observacoes || "",
  };
}

/** Aviso (não bloqueia) quando o número da parcela passa da quantidade combinada no acordo. */
export function ExceedsQuantityWarning({ number, quantity }) {
  if (!quantity || !(number > quantity)) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      O parcelamento foi cadastrado com {quantity} parcelas, e esta é a parcela {number}. Confira se o número está certo — a
      gravação continua permitida.
    </p>
  );
}

export default function TaxInstallmentFormDialog({ open, onOpenChange, agreement, installment, installments }) {
  const isEdit = Boolean(installment);
  const [form, setForm] = useState(() => toForm(null, []));
  const [fieldErrors, setFieldErrors] = useState({});
  // Parcela como a tela a carregou (a versão vai junto ao salvar); troca só ao recarregar depois de um conflito.
  const [base, setBase] = useState(installment);
  const [conflict, setConflict] = useState("");
  const [reloaded, setReloaded] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const invalidateTax = useInvalidateTax();
  const reloader = useReloadInstallment();
  const today = todayInBrazil();

  useEffect(() => {
    if (!open) return;
    setForm(toForm(installment, installments));
    setFieldErrors({});
    setBase(installment);
    setConflict("");
    setReloaded(null);
    setConfirmUndo(false);
  }, [open]); // preenchido só na abertura, para um refetch não apagar o que foi digitado

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => (current[field] ? { ...current, [field]: null } : current));
  };

  const isPaid = PAID_INSTALLMENT_STATUSES.has(form.situacao);
  const wasPaid = isEdit && PAID_INSTALLMENT_STATUSES.has(base?.situacao);

  const buildPayload = () => ({
    numero_parcela: form.numero_parcela === "" ? null : Number(form.numero_parcela),
    vencimento: form.vencimento || null,
    valor: parseCurrencyField(form.valor),
    situacao: form.situacao,
    // A vencer/vencida e cancelada não aceitam pagamento: limpar os dois campos é o que reabre uma parcela paga.
    data_pagamento: isPaid ? form.data_pagamento || null : null,
    valor_pago: isPaid ? parseCurrencyField(form.valor_pago) : null,
    observacoes: form.observacoes,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      return isEdit
        ? base44.entities.TaxInstallment.update(base.id, withInstallmentVersion(payload, base))
        : base44.entities.TaxInstallment.create({ ...payload, agreement_id: agreement.id });
    },
    onSuccess: async () => {
      toast.success(isEdit ? "Parcela atualizada" : "Parcela incluída");
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

  const busy = saveMutation.isPending;

  const submit = () => {
    if (isEdit && undoesErpPayment(base, buildPayload())) setConfirmUndo(true);
    else saveMutation.mutate();
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
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar parcela ${base?.numero_parcela ?? installment.numero_parcela}` : "Nova parcela"}</DialogTitle>
          <DialogDescription>Parcelamento nº {agreement?.codigo_parcelamento}. Os dados ficam marcados como informados manualmente.</DialogDescription>
        </DialogHeader>

        <form
          id="tax-installment-form"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {isEdit ? <ErpPaymentNote installment={base} /> : null}
          <InstallmentConflictNotice
            message={conflict}
            reloaded={reloaded}
            reloading={reloader.reloading}
            reloadError={reloader.error}
            today={today}
            onReload={reload}
            onUseCurrent={() => {
              setForm(toForm(reloaded, installments));
              setFieldErrors({});
              setReloaded(null);
            }}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="inst-numero">Nº da parcela</Label>
              <Input
                id="inst-numero"
                type="number"
                inputMode="numeric"
                min={1}
                className="h-9"
                value={form.numero_parcela}
                onChange={(event) => update("numero_parcela", event.target.value)}
              />
              <FieldError message={fieldErrors.numero_parcela} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="inst-vencimento">Vencimento</Label>
              <Input id="inst-vencimento" type="date" className="h-9" value={form.vencimento} onChange={(event) => update("vencimento", event.target.value)} />
              <FieldError message={fieldErrors.vencimento} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="inst-valor">Valor</Label>
              <CurrencyInput id="inst-valor" className="h-9" value={form.valor} onChange={(event) => update("valor", event.target.value)} placeholder="0,00" />
              <FieldError message={fieldErrors.valor} />
            </div>
          </div>

          <ExceedsQuantityWarning number={Number(form.numero_parcela)} quantity={agreement?.qtd_parcelas} />

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="inst-situacao">Situação</Label>
            <Select value={form.situacao} onValueChange={(value) => update("situacao", value)}>
              <SelectTrigger id="inst-situacao" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INSTALLMENT_STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.situacao} />
            {wasPaid && form.situacao === "em_aberto" ? (
              <p className="text-xs text-amber-700">
                A parcela volta a constar como “A vencer” ou “Vencida”, conforme o vencimento, e os dados do pagamento serão apagados.
              </p>
            ) : null}
          </div>

          {isPaid ? (
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="inst-data-pag">Data do pagamento</Label>
                <Input
                  id="inst-data-pag"
                  type="date"
                  max={today}
                  className="h-9 bg-white"
                  value={form.data_pagamento}
                  onChange={(event) => update("data_pagamento", event.target.value)}
                />
                <FieldError message={fieldErrors.data_pagamento} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="inst-valor-pago">Valor pago (opcional)</Label>
                <CurrencyInput
                  id="inst-valor-pago"
                  className="h-9 bg-white"
                  value={form.valor_pago}
                  onChange={(event) => update("valor_pago", event.target.value)}
                  placeholder="0,00"
                />
                <FieldError message={fieldErrors.valor_pago} />
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="inst-obs">Observações (opcional)</Label>
            <Textarea id="inst-obs" rows={2} value={form.observacoes} onChange={(event) => update("observacoes", event.target.value)} />
            <FieldError message={fieldErrors.observacoes} />
          </div>
        </form>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="tax-installment-form" disabled={busy || Boolean(conflict)}>
            {busy ? "Salvando…" : isEdit ? "Salvar alterações" : "Incluir parcela"}
          </Button>
        </DialogFooter>
        <UndoErpPaymentDialog
          open={confirmUndo}
          installment={base}
          busy={busy}
          onConfirm={() => saveMutation.mutate()}
          onCancel={() => setConfirmUndo(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
