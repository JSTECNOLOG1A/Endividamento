import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const today = () => new Date().toISOString().slice(0, 10);
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Baixa manual de um título a pagar: uma das duas fontes de "baixa efetiva" do fechamento contábil
// (a outra é o retorno do ERP). Aceita baixa parcial.
export default function ManualSettlementDialog({ title, open, onOpenChange, submitting, onSubmit }) {
  const [paymentDate, setPaymentDate] = useState(today());
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open && title) {
      setPaymentDate(today());
      setAmount(String(Number(title.saldo || 0).toFixed(2)));
    }
  }, [open, title]);

  if (!title) return null;
  const saldo = Number(title.saldo || 0);
  const paid = Number(String(amount).replace(",", "."));
  const invalid = !paymentDate || !(paid > 0) || paid - saldo > 0.009;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar baixa manual</DialogTitle>
          <DialogDescription>
            Título {title.prefixo} {title.titulo_numero}-{title.parcela} · saldo em aberto {brl(saldo)}. A baixa vale para o
            fechamento contábil como pagamento efetivo desta parcela.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Data do pagamento</Label>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Valor pago (baixa parcial se menor que o saldo)</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {paid - saldo > 0.009 ? <p className="text-xs text-rose-600">O valor não pode passar do saldo em aberto.</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" disabled={submitting || invalid} onClick={() => onSubmit({ id: title.id, paymentDate, amountPaid: paid })}>
            {submitting ? "Registrando…" : "Registrar baixa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
