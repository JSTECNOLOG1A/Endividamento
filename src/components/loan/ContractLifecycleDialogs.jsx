import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/lib/notify";
import { createPageUrl } from "@/utils";

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(Number(value) || 0);
}
const parseBRNumber = (str) => {
  if (!str) return 0;
  const cleaned = String(str).replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
};
const todayIso = () => new Date().toISOString().split("T")[0];

// Reaproveitado pelos dois diálogos: busca o saldo devedor projetado do
// contrato numa data de corte (backend: calculateContractBalanceAsOf em
// backend/src/modules/functions/contractLifecycle.js), direto do
// schedule_data já calculado — sem chamada ao motor de novo.
function useContractBalance(contractId, asOfDate) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  React.useEffect(() => {
    if (!contractId || !asOfDate) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    base44.functions.invoke("calculateContractBalanceAsOf", { contractId, asOfDate })
      .then((res) => { if (!cancelled) setBalance(res.data.balance); })
      .catch(() => { if (!cancelled) setBalance(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contractId, asOfDate]);
  return { balance, loading };
}

// Renegociação: encerra o contrato atual ("Renegociado") e cria um NOVO,
// com o saldo (líquido de entrada) como principal, linkado via
// renegotiated_from_id — o usuário preenche os termos novos do banco (taxa,
// prazo, sistema) na própria Calculadora, sem nenhuma novidade no motor.
export function RenegotiateDialog({ open, onOpenChange, contract }) {
  const [renegotiationDate, setRenegotiationDate] = useState(todayIso());
  const [entrada, setEntrada] = useState("0");
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (open) {
      setRenegotiationDate(todayIso());
      setEntrada("0");
    }
  }, [open, contract]);

  const { balance, loading: loadingBalance } = useContractBalance(contract?.id, renegotiationDate);
  const novoPrincipal = balance != null ? Math.max(0, balance - parseBRNumber(entrada)) : null;

  const mutation = useMutation({
    mutationFn: () => base44.functions.invoke("renegotiateContract", {
      contractId: contract.id,
      renegotiationDate,
      entrada: parseBRNumber(entrada),
    }),
    onSuccess: async (res) => {
      toast.success(`Renegociado — novo contrato ${res.data.new_contract_number} criado com principal de ${formatCurrency(res.data.novo_principal)}`);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      window.location.href = createPageUrl("Simulator") + "?edit=" + res.data.new_contract_id;
    },
    onError: (err) => toast.error("Erro ao renegociar: " + err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Renegociar Contrato</DialogTitle>
          <DialogDescription>
            Encerra este contrato ("Renegociado") e cria um novo com o saldo devedor
            (líquido da entrada, se houver) como principal — você preenche os termos novos
            do banco (taxa, prazo, sistema) na Calculadora em seguida.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Data da Renegociação</Label>
            <Input className="h-9" type="date" value={renegotiationDate} onChange={(e) => setRenegotiationDate(e.target.value)} />
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Saldo devedor projetado: </span>
            <span className="font-semibold">{loadingBalance ? "calculando..." : balance != null ? formatCurrency(balance) : "—"}</span>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Entrada (opcional)</Label>
            <CurrencyInput className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="0,00" />
          </div>
          {novoPrincipal != null && (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Novo principal: </span>
              <span className="font-semibold text-cyan-700">{formatCurrency(novoPrincipal)}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!renegotiationDate || balance == null || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Renegociando..." : "Confirmar Renegociação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DISCOUNT_MODE_OPTIONS = [
  { value: "juros_futuros", label: "Desconto sobre juros futuros", hint: "Informe o valor do desconto (R$)" },
  { value: "percentual_saldo", label: "Percentual sobre o saldo total", hint: "Informe o percentual (%)" },
  { value: "valor_fixo", label: "Valor fixo negociado", hint: "Informe o valor final a pagar (R$)" },
];

// Quitação antecipada: registra a baixa extraordinária (contract_settlements,
// mesmo schema do Fechamento Contábil) e envia o contrato pra
// 'pendente_aprovacao' — só vira 'quitado' quando aprovado (mesma alçada de
// aprovação de um contrato novo, ver applyLoanContractRules em
// backend/src/modules/entities/store.js).
export function SettleEarlyDialog({ open, onOpenChange, contract }) {
  const [payoffDate, setPayoffDate] = useState(todayIso());
  const [discountMode, setDiscountMode] = useState("percentual_saldo");
  const [discountValue, setDiscountValue] = useState("0");
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (open) {
      setPayoffDate(todayIso());
      setDiscountMode("percentual_saldo");
      setDiscountValue("0");
    }
  }, [open, contract]);

  const { balance, loading: loadingBalance } = useContractBalance(contract?.id, payoffDate);

  let valorFinal = balance;
  const dv = parseBRNumber(discountValue);
  if (balance != null) {
    if (discountMode === "juros_futuros") valorFinal = Math.max(0, balance - dv);
    else if (discountMode === "percentual_saldo") valorFinal = Math.max(0, balance * (1 - Math.min(100, dv) / 100));
    else valorFinal = Math.max(0, dv);
  }
  const desconto = balance != null && valorFinal != null ? Math.max(0, balance - valorFinal) : null;

  const mutation = useMutation({
    mutationFn: () => base44.functions.invoke("settleContractEarly", {
      contractId: contract.id,
      payoffDate,
      discountMode,
      discountValue: dv,
    }),
    onSuccess: async () => {
      toast.success("Quitação antecipada registrada — aguardando aprovação (nível 1/2, mesma alçada de um contrato novo).");
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
    },
    onError: (err) => toast.error("Erro ao registrar quitação: " + err.message),
  });

  const modeInfo = DISCOUNT_MODE_OPTIONS.find((m) => m.value === discountMode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quitar Antecipadamente</DialogTitle>
          <DialogDescription>
            Registra a baixa extraordinária e envia pra aprovação — o contrato só vira
            "Quitado" depois de aprovado (nível 1/2), igual um contrato novo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Data da Quitação</Label>
            <Input className="h-9" type="date" value={payoffDate} onChange={(e) => setPayoffDate(e.target.value)} />
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Saldo devedor projetado: </span>
            <span className="font-semibold">{loadingBalance ? "calculando..." : balance != null ? formatCurrency(balance) : "—"}</span>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Modo de Desconto</Label>
            <Select value={discountMode} onValueChange={setDiscountMode}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISCOUNT_MODE_OPTIONS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{modeInfo.hint}</Label>
            <CurrencyInput className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="0,00" />
          </div>
          {valorFinal != null && (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-slate-600">Desconto: <span className="font-medium">{formatCurrency(desconto)}</span></span>
              <span className="text-slate-600">Valor final: <span className="font-semibold text-cyan-700">{formatCurrency(valorFinal)}</span></span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!payoffDate || balance == null || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Registrando..." : "Confirmar Quitação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
