import React, { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/notify";
import { formatCivilDate, todayInBrazil } from "@/lib/taxDates";
import { MAX_GENERATED_INSTALLMENTS, buildMonthlySchedule } from "@/lib/taxSignal";
import { formatMoney, parseCurrencyField } from "@/lib/taxLabels";
import { useInvalidateTax } from "@/hooks/useTaxData";

const PREVIEW_HEAD = 3;

function nextNumber(installments) {
  return installments.reduce((max, item) => Math.max(max, item.numero_parcela || 0), 0) + 1;
}

/** Gera parcelas mensais de uma vez (gravação tudo-ou-nada); depois cada uma pode ser editada. */
export default function TaxScheduleDialog({ open, onOpenChange, agreement, installments }) {
  const [firstDueDate, setFirstDueDate] = useState("");
  const [count, setCount] = useState("");
  const [amount, setAmount] = useState("");
  const [startNumber, setStartNumber] = useState("1");
  const invalidateTax = useInvalidateTax();

  useEffect(() => {
    if (!open) return;
    const start = nextNumber(installments);
    setFirstDueDate("");
    setStartNumber(String(start));
    setCount(agreement?.qtd_parcelas && agreement.qtd_parcelas >= start ? String(agreement.qtd_parcelas - start + 1) : "");
    setAmount("");
  }, [open]); // sugestões calculadas só na abertura, para um refetch não apagar o que foi digitado

  const countNumber = Number(count);
  const startNumberValue = Number(startNumber);
  const amountValue = parseCurrencyField(amount);
  const countValid = Number.isInteger(countNumber) && countNumber >= 1 && countNumber <= MAX_GENERATED_INSTALLMENTS;
  const startValid = Number.isInteger(startNumberValue) && startNumberValue >= 1;

  const schedule = useMemo(
    () =>
      countValid && startValid
        ? buildMonthlySchedule({ firstDueDate, count: countNumber, amount: amountValue, startNumber: startNumberValue })
        : [],
    [firstDueDate, countNumber, amountValue, startNumberValue, countValid, startValid]
  );

  const existingNumbers = useMemo(() => new Set(installments.map((item) => item.numero_parcela)), [installments]);
  const conflicts = schedule.filter((item) => existingNumbers.has(item.numero_parcela)).map((item) => item.numero_parcela);
  const lastNumber = schedule.length ? schedule[schedule.length - 1].numero_parcela : 0;
  const exceedsQuantity = Boolean(agreement?.qtd_parcelas) && lastNumber > agreement.qtd_parcelas;
  const today = todayInBrazil();
  const pastDue = schedule.filter((item) => item.vencimento < today).length;
  const canSubmit = schedule.length > 0 && amountValue !== null && conflicts.length === 0;

  const mutation = useMutation({
    mutationFn: () =>
      base44.entities.TaxInstallment.bulkCreate(
        schedule.map((item) => ({ ...item, agreement_id: agreement.id, situacao: "em_aberto" }))
      ),
    onSuccess: async (created) => {
      toast.success(`${created.length} ${created.length === 1 ? "parcela gerada" : "parcelas geradas"}`);
      await invalidateTax();
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message),
  });

  const busy = mutation.isPending;
  const preview = schedule.length > PREVIEW_HEAD + 1 ? [...schedule.slice(0, PREVIEW_HEAD), null, schedule[schedule.length - 1]] : schedule;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerar parcelas</DialogTitle>
          <DialogDescription>
            Vencimentos mensais no mesmo dia do 1º vencimento — em meses mais curtos, no último dia do mês. Depois de geradas, cada
            parcela pode ser editada.
          </DialogDescription>
        </DialogHeader>

        <form
          id="tax-schedule-form"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="sched-first">1º vencimento</Label>
              <Input id="sched-first" type="date" className="h-9" value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="sched-amount">Valor mensal</Label>
              <CurrencyInput id="sched-amount" className="h-9" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="sched-count">Quantidade de parcelas</Label>
              <Input
                id="sched-count"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_GENERATED_INSTALLMENTS}
                className="h-9"
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
              {count !== "" && !countValid ? (
                <p className="text-xs text-rose-600">Informe uma quantidade entre 1 e {MAX_GENERATED_INSTALLMENTS}.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="sched-start">Começar pela parcela nº</Label>
              <Input
                id="sched-start"
                type="number"
                inputMode="numeric"
                min={1}
                className="h-9"
                value={startNumber}
                onChange={(event) => setStartNumber(event.target.value)}
              />
            </div>
          </div>

          {conflicts.length ? (
            <p className="flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {conflicts.length === 1 ? "A parcela" : "As parcelas"} {conflicts.slice(0, 5).join(", ")}
              {conflicts.length > 5 ? "…" : ""} já {conflicts.length === 1 ? "existe" : "existem"} neste parcelamento. Ajuste o número
              inicial ou a quantidade.
            </p>
          ) : null}
          {exceedsQuantity ? (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              O parcelamento foi cadastrado com {agreement.qtd_parcelas} parcelas e a geração vai até a parcela {lastNumber}. Confira — a
              geração continua permitida.
            </p>
          ) : null}

          {pastDue ? (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {pastDue === 1 ? "1 parcela tem" : pastDue === schedule.length ? `Todas as ${pastDue} parcelas têm` : `${pastDue} parcelas têm`}{" "}
              vencimento antes de hoje e {pastDue === 1 ? "será criada como “Vencida”" : "serão criadas como “Vencida”"} — o parcelamento
              vai aparecer em atraso. Se já foram pagas, use “Registrar pagamento” em cada uma, com a data real do pagamento.
            </p>
          ) : null}

          {schedule.length ? (
            <div className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                Prévia: {schedule.length} {schedule.length === 1 ? "parcela" : "parcelas"}
                {amountValue !== null ? ` · total ${formatMoney(amountValue * schedule.length)}` : ""}
              </p>
              <ul className="divide-y divide-slate-100 text-xs">
                {preview.map((item, index) =>
                  item ? (
                    <li key={item.numero_parcela} className="flex justify-between px-3 py-1.5">
                      <span>Parcela {item.numero_parcela}</span>
                      <span className="tabular-nums text-slate-600">
                        {formatCivilDate(item.vencimento)} · {amountValue !== null ? formatMoney(amountValue) : "—"}
                      </span>
                    </li>
                  ) : (
                    <li key={`gap-${index}`} className="px-3 py-1 text-center text-slate-400">…</li>
                  )
                )}
              </ul>
            </div>
          ) : null}
        </form>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="tax-schedule-form" disabled={busy || !canSubmit}>
            {busy ? "Gerando…" : schedule.length ? `Gerar ${schedule.length} ${schedule.length === 1 ? "parcela" : "parcelas"}` : "Gerar parcelas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
