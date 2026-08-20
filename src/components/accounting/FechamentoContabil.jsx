import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { useAuth } from "@/lib/AuthContext";
import { createPageUrl } from "../../utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircle2, AlertTriangle, Lock, RotateCcw, Calculator, ClipboardCheck, Settings2, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AccountingMatrixConfig from "./AccountingMatrixConfig";
import {
  EVENT_TYPE_LABELS,
  sumSettlementCashBuckets,
  validateSettlement,
  settlementTriggersRecalculation,
  evaluateSettlementMateriality,
  calculateClosingReconciliation,
  buildJournalEntries,
  canApproveClosing,
} from "@/lib/accountingClosing";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const STATUS_LABELS = {
  rascunho: "Rascunho",
  pagamentos_informados: "Pagamentos informados",
  calculado: "Calculado",
  divergencia: "Divergência",
  pronto_aprovacao: "Pronto para aprovação",
  aprovado: "Aprovado",
  reaberto: "Reaberto",
  recalculado: "Recalculado",
  aprovado_novamente: "Aprovado novamente",
};

const STATUS_COLORS = {
  rascunho: "secondary",
  pagamentos_informados: "secondary",
  calculado: "default",
  divergencia: "destructive",
  pronto_aprovacao: "default",
  aprovado: "default",
  reaberto: "destructive",
};

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Ícone de "i" com tooltip explicativo — mesmo padrão usado no formulário de
// contrato (ContractForm.jsx), só para colar ao lado de labels não óbvias.
function InfoTip({ text, side = "right" }) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Info className="w-3 h-3 inline-block ml-1 text-slate-400 cursor-help" />
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs">
          <p className="text-xs">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).toISOString().split("T")[0];
}

function competenciaDate(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function extractScheduleRows(contract) {
  if (!contract.schedule_data) return [];
  try {
    const parsed = JSON.parse(contract.schedule_data);
    return parsed.schedule || [];
  } catch {
    return [];
  }
}

const EMPTY_SETTLEMENT_FORM = {
  actual_payment_date: "",
  valor_pago: "",
  principal_paid: "",
  interest_paid: "",
  penalty_paid: "0",
  fee_paid: "0",
  discount_amount: "0",
  rounding_adjustment: "0",
  other_amount: "0",
  bank_account_id: "",
  observacao: "",
};

function SettlementDialog({ open, onOpenChange, contract, scheduleRow, existing, bankAccounts, dataBase, onSave, saving }) {
  // Principal e juros previstos pelo cronograma — a referência que a régua
  // de materialidade usa pra dizer se o valor pago bate "dentro do
  // esperado" ou não (ver SETTLEMENT_MATERIALITY_CONFIG).
  const scheduledPrincipal = round2(scheduleRow?.amortizacao || 0);
  const scheduledInterest = round2(
    scheduleRow?.jurosPagos ?? ((scheduleRow?.jurosFixosMes || 0) + (scheduleRow?.jurosVariaveisMes || 0))
  );

  const [form, setForm] = useState(() => ({
    ...EMPTY_SETTLEMENT_FORM,
    actual_payment_date: existing?.actual_payment_date || scheduleRow?.dataVencimento || "",
    valor_pago: existing ? String(existing.total_paid ?? "") : "",
    principal_paid: String(existing?.principal_paid ?? scheduledPrincipal ?? 0),
    interest_paid: String(existing?.interest_paid ?? scheduledInterest ?? 0),
    penalty_paid: String(existing?.penalty_paid ?? 0),
    fee_paid: String(existing?.fee_paid ?? 0),
    discount_amount: String(existing?.discount_amount ?? 0),
    rounding_adjustment: String(existing?.rounding_adjustment ?? 0),
    other_amount: String(existing?.other_amount ?? 0),
    bank_account_id: existing?.bank_account_id || "",
    observacao: existing?.observacao || "",
  }));

  // O usuário só precisa informar o valor total pago (extrato do banco) —
  // o sistema assume que principal e juros previstos estão certos e joga a
  // diferença automaticamente em "ajuste de arredondamento". Se a
  // diferença for grande demais (fora da margem de materialidade), o botão
  // de salvar fica bloqueado até o usuário reclassificar manualmente nos
  // campos abaixo (multa/tarifa/outros, ou principal/juros se o pagamento
  // realmente foi diferente do programado).
  const handleValorPagoChange = (value) => {
    const valorPagoNum = Number(String(value).replace(",", ".")) || 0;
    const diferenca = round2(valorPagoNum - scheduledPrincipal - scheduledInterest);
    setForm((prev) => ({
      ...prev,
      valor_pago: value,
      principal_paid: String(scheduledPrincipal),
      interest_paid: String(scheduledInterest),
      penalty_paid: "0",
      fee_paid: "0",
      other_amount: "0",
      rounding_adjustment: String(diferenca),
    }));
  };

  const num = (key) => Number(String(form[key]).replace(",", ".")) || 0;
  const draftSettlement = {
    principal_paid: num("principal_paid"),
    interest_paid: num("interest_paid"),
    penalty_paid: num("penalty_paid"),
    fee_paid: num("fee_paid"),
    discount_amount: num("discount_amount"),
    rounding_adjustment: num("rounding_adjustment"),
    other_amount: num("other_amount"),
    total_paid: 0,
    actual_payment_date: form.actual_payment_date,
    bank_account_id: form.bank_account_id,
  };
  const totalPaid = sumSettlementCashBuckets(draftSettlement);
  draftSettlement.total_paid = totalPaid;

  const valorPagoNum = num("valor_pago");
  const materiality = evaluateSettlementMateriality(valorPagoNum, scheduledPrincipal, scheduledInterest);
  const validation = validateSettlement(draftSettlement, scheduleRow, dataBase);
  const willTriggerRecalc = settlementTriggersRecalculation(draftSettlement, scheduleRow);

  const handleSave = () => {
    if (!form.valor_pago) {
      toast.warning("Informe o valor total pago (conforme o extrato bancário).");
      return;
    }
    if (!validation.valid) {
      toast.warning(validation.blockers[0]);
      return;
    }
    onSave({
      contract_id: contract.id,
      parcela: String(scheduleRow?.parcela ?? ""),
      scheduled_date: scheduleRow?.dataVencimento || null,
      scheduled_amount: scheduleRow ? (scheduleRow.amortizacao || 0) + (scheduleRow.jurosPagos || 0) : null,
      ...draftSettlement,
      extraordinary_amortization: scheduleRow ? draftSettlement.principal_paid > (scheduleRow.amortizacao || 0) : false,
      triggers_recalculation: willTriggerRecalc,
      status: "baixado",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Baixa de parcela — {contract?.contract_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data efetiva do pagamento *</Label>
              <Input type="date" className="h-9" value={form.actual_payment_date}
                onChange={(e) => setForm({ ...form, actual_payment_date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Conta bancária</Label>
              <Select value={form.bank_account_id || undefined} onValueChange={(v) => setForm({ ...form, bank_account_id: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((b) => (<SelectItem key={b.id} value={b.id}>{b.nome || b.conta}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Valor total pago (conforme extrato bancário) *</Label>
            <Input className="h-9" value={form.valor_pago} onChange={(e) => handleValorPagoChange(e.target.value)} />
            <p className="text-[11px] text-slate-500">
              Previsto: {formatCurrency(scheduledPrincipal)} de principal + {formatCurrency(scheduledInterest)} de juros = {formatCurrency(scheduledPrincipal + scheduledInterest)}.
              {" "}Diferença:{" "}
              <span className={materiality.withinMargin ? "text-emerald-600 font-medium" : "text-red-600 font-semibold"}>
                {formatCurrency(materiality.diferenca)} ({(materiality.percentual * 100).toFixed(2)}%)
              </span>
              {materiality.withinMargin
                ? " — dentro da margem aceitável, tratada automaticamente como ajuste de arredondamento."
                : " — acima da margem aceitável. Reclassifique abaixo antes de salvar (multa, tarifa, outros, ou principal/juros se o pagamento realmente foi diferente do previsto)."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Principal pago</Label>
              <Input className="h-9" value={form.principal_paid} onChange={(e) => setForm({ ...form, principal_paid: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Juros pago</Label>
              <Input className="h-9" value={form.interest_paid} onChange={(e) => setForm({ ...form, interest_paid: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Multa / mora</Label>
              <Input className="h-9" value={form.penalty_paid} onChange={(e) => setForm({ ...form, penalty_paid: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tarifa bancária</Label>
              <Input className="h-9" value={form.fee_paid} onChange={(e) => setForm({ ...form, fee_paid: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Ajuste de arredondamento
                <InfoTip text="Pequena diferença de centavos entre o previsto e o pago (arredondamento de taxa, por exemplo). Dentro da margem aceitável, o sistema já preenche isso sozinho." />
              </Label>
              <Input className="h-9" value={form.rounding_adjustment} onChange={(e) => setForm({ ...form, rounding_adjustment: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Outros</Label>
              <Input className="h-9" value={form.other_amount} onChange={(e) => setForm({ ...form, other_amount: e.target.value })} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">
                Desconto financeiro obtido (remissão — não é rotina)
                <InfoTip text="Uso excepcional: quando o banco perdoa/reduz parte do valor devido (renegociação, acordo). Não é o campo para diferenças normais de arredondamento — para isso use 'Ajuste de arredondamento'." />
              </Label>
              <Input className="h-9" value={form.discount_amount} onChange={(e) => setForm({ ...form, discount_amount: e.target.value })} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">Total pago (calculado a partir dos campos acima)</span>
            <span className="font-semibold text-slate-900">{formatCurrency(totalPaid)}</span>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observação</Label>
            <Textarea className="min-h-16" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
          </div>

          {willTriggerRecalc && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Principal ou juros pago diverge do previsto — esta baixa vai exigir recálculo do contrato
              (reabra o contrato na Calculadora) antes do fechamento poder ser aprovado.
            </div>
          )}
          {validation.warnings.map((w, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{w}</div>
          ))}
          {!validation.valid && validation.blockers.map((b, i) => (
            <div key={i} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{b}</div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving || !validation.valid || !form.valor_pago}>
            {saving ? "Salvando..." : "Salvar baixa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FechamentoContabil({ entityId, entityName }) {
  const { user } = useAuth();
  const today = new Date();
  // Se a tela foi aberta com ?month=&year= na URL (ex.: ao voltar de um
  // recálculo reaberto pelo botão "Requer recálculo", ver
  // handleReopenForRecalc), inicia na mesma competência de onde saiu — caso
  // contrário mantém o padrão de sempre (mês/ano atuais).
  const initialParams = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const [year, setYear] = useState(() => {
    const y = Number(initialParams.get("year"));
    return Number.isFinite(y) && y > 0 ? y : today.getFullYear();
  });
  const [month, setMonth] = useState(() => {
    const m = Number(initialParams.get("month"));
    return Number.isFinite(m) && m >= 1 && m <= 12 ? m : today.getMonth() + 1;
  });
  const [dataBase, setDataBase] = useState(() => lastDayOfMonth(year, month));
  const [dialogTarget, setDialogTarget] = useState(null); // { contract, scheduleRow, existing }
  const [reopenReason, setReopenReason] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [calcResult, setCalcResult] = useState(null);
  const [journalResult, setJournalResult] = useState(null);
  const [recalcTarget, setRecalcTarget] = useState(null); // { contract, row, settlement }
  const [recalcJustification, setRecalcJustification] = useState("");
  const [recalcSubmitting, setRecalcSubmitting] = useState(false);

  const competencia = competenciaDate(year, month);

  const { data: contracts = [] } = useQuery({
    queryKey: ["fechamento-contracts", entityId],
    queryFn: () => base44.entities.LoanContract.filter({ entity_id: entityId, status: "aprovado" }, "", 5000),
    enabled: !!entityId,
    initialData: [],
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["fechamento-bank-accounts", entityId],
    queryFn: () => base44.entities.BankAccount.filter({ entity_id: entityId }, "", 500),
    enabled: !!entityId,
    initialData: [],
  });

  const { data: chartOfAccounts = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => base44.entities.ChartOfAccount.list("account_code", 2000),
    initialData: [],
  });

  const { data: eventMappings = [] } = useQuery({
    queryKey: ["accounting-event-mappings", entityId],
    queryFn: () => base44.entities.AccountingEventMapping.filter({ entity_id: entityId }, "", 200),
    enabled: !!entityId,
    initialData: [],
  });

  const { data: closings = [], refetch: refetchClosings } = useQuery({
    queryKey: ["accounting-closings", entityId],
    queryFn: () => base44.entities.AccountingClosing.filter({ entity_id: entityId }, "-competencia", 500),
    enabled: !!entityId,
    initialData: [],
  });

  const closing = useMemo(
    () => closings.find((c) => (c.competencia || "").slice(0, 10) === competencia),
    [closings, competencia]
  );
  const previousClosing = useMemo(() => {
    const sorted = [...closings].sort((a, b) => (a.competencia < b.competencia ? -1 : 1));
    const idx = sorted.findIndex((c) => (c.competencia || "").slice(0, 10) === competencia);
    return idx > 0 ? sorted[idx - 1] : null;
  }, [closings, competencia]);

  const { data: settlements = [], refetch: refetchSettlements } = useQuery({
    queryKey: ["contract-settlements", closing?.id],
    queryFn: () => base44.entities.ContractSettlement.filter({ closing_id: closing.id }, "", 5000),
    enabled: !!closing?.id,
    initialData: [],
  });

  const [creatingClosing, setCreatingClosing] = useState(false);
  const ensureClosing = async () => {
    if (closing || creatingClosing) return closing;
    setCreatingClosing(true);
    try {
      const created = await base44.entities.AccountingClosing.create({
        entity_id: entityId,
        competencia,
        data_base: dataBase,
        previous_closing_id: previousClosing?.id || null,
        status: "rascunho",
      });
      await refetchClosings();
      return created;
    } finally {
      setCreatingClosing(false);
    }
  };

  const accountName = (id) => {
    const acc = chartOfAccounts.find((a) => a.id === id);
    return acc ? `${acc.account_code} — ${acc.account_name}` : "(conta não configurada)";
  };

  // ---- STEP 1: baixas ----
  const scheduleRowsInMonth = useMemo(() => {
    const rows = [];
    contracts.forEach((contract) => {
      extractScheduleRows(contract).forEach((row) => {
        const rowDate = row.dataVencimento;
        if (!rowDate) return;
        if (rowDate.slice(0, 7) === competencia.slice(0, 7)) {
          rows.push({ contract, row });
        }
      });
    });
    return rows;
  }, [contracts, competencia]);

  const settlementByKey = useMemo(() => {
    const map = new Map();
    settlements.forEach((s) => map.set(`${s.contract_id}|${s.parcela}`, s));
    return map;
  }, [settlements]);

  const handleOpenSettlement = async (contract, row) => {
    const activeClosing = closing || (await ensureClosing());
    if (!activeClosing) return;
    setDialogTarget({ contract, scheduleRow: row, existing: settlementByKey.get(`${contract.id}|${row.parcela}`) });
  };

  const [savingSettlement, setSavingSettlement] = useState(false);
  const handleSaveSettlement = async (payload) => {
    setSavingSettlement(true);
    try {
      const activeClosing = closing || (await ensureClosing());
      const existing = settlementByKey.get(`${payload.contract_id}|${payload.parcela}`);
      if (existing) {
        await base44.entities.ContractSettlement.update(existing.id, { ...payload, closing_id: activeClosing.id });
      } else {
        await base44.entities.ContractSettlement.create({ ...payload, closing_id: activeClosing.id });
      }
      if (activeClosing.status === "rascunho") {
        await base44.entities.AccountingClosing.update(activeClosing.id, { status: "pagamentos_informados" });
        await refetchClosings();
      }
      await refetchSettlements();
      setDialogTarget(null);
      toast.success("Baixa registrada.");
    } catch (err) {
      toast.error("Erro ao salvar baixa: " + (err.message || "tente novamente"));
    } finally {
      setSavingSettlement(false);
    }
  };

  const handleEstornarSettlement = async (settlement) => {
    if (!window.confirm("Estornar esta baixa? Ela deixará de contar no fechamento.")) return;
    try {
      await base44.entities.ContractSettlement.update(settlement.id, { status: "estornado" });
      await refetchSettlements();
      toast.success("Baixa estornada.");
    } catch (err) {
      toast.error("Erro ao estornar: " + (err.message || "tente novamente"));
    }
  };

  // ---- STEP 2: calcular fechamento ----
  const [calculating, setCalculating] = useState(false);
  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const activeClosing = closing || (await ensureClosing());
      const settlementsByContract = new Map();
      settlements.forEach((s) => {
        if (!settlementsByContract.has(s.contract_id)) settlementsByContract.set(s.contract_id, []);
        settlementsByContract.get(s.contract_id).push(s);
      });
      const reconciliation = calculateClosingReconciliation(contracts, settlementsByContract, year, month, dataBase);
      setCalcResult(reconciliation);
      const nextStatus = reconciliation.hasBlockingDivergence ? "divergencia" : "calculado";
      await base44.entities.AccountingClosing.update(activeClosing.id, {
        status: nextStatus,
        data_base: dataBase,
        opening_snapshot: JSON.stringify(reconciliation.opening),
        events_snapshot: JSON.stringify(reconciliation.eventTotals),
        calculated_by: user?.email,
        calculated_at: new Date().toISOString(),
      });
      await refetchClosings();
      toast.success(reconciliation.hasBlockingDivergence ? "Fechamento calculado com divergências pendentes." : "Fechamento calculado.");
    } catch (err) {
      toast.error("Erro ao calcular fechamento: " + (err.message || "tente novamente"));
    } finally {
      setCalculating(false);
    }
  };

  // ---- STEP 3: lançamentos e aprovação ----
  const handleBuildJournal = () => {
    if (!calcResult) return;
    const result = buildJournalEntries(calcResult, eventMappings, dataBase);
    setJournalResult(result);
  };

  const [approving, setApproving] = useState(false);
  const approveGate = journalResult && calcResult
    ? canApproveClosing({
        journalResult,
        reconciliation: calcResult,
        previousClosingApproved: previousClosing ? previousClosing.status === "aprovado" : true,
        hasUnresolvedSettlementBlockers: false,
      })
    : { canApprove: false, reasons: ["Calcule o fechamento e gere os lançamentos primeiro."] };

  const handleApprove = async () => {
    if (!approveGate.canApprove || !closing) return;
    setApproving(true);
    try {
      await base44.entities.AccountingJournalEntry.bulkCreate(
        journalResult.entries.map((e) => ({ ...e, closing_id: closing.id }))
      );
      await base44.entities.AccountingClosing.update(closing.id, {
        status: "aprovado",
        total_debito: journalResult.totalDebito,
        total_credito: journalResult.totalCredito,
        journal_snapshot: JSON.stringify(journalResult.entries),
        approved_by: user?.email,
        approved_at: new Date().toISOString(),
      });
      await refetchClosings();
      toast.success("Fechamento aprovado e travado.");
    } catch (err) {
      toast.error("Erro ao aprovar fechamento: " + (err.message || "tente novamente"));
    } finally {
      setApproving(false);
    }
  };

  const handleReopen = async () => {
    if (!reopenReason.trim()) {
      toast.warning("Informe a justificativa da reabertura.");
      return;
    }
    try {
      await base44.entities.AccountingClosing.update(closing.id, {
        status: "reaberto",
        reopened_by: user?.email,
        reopened_at: new Date().toISOString(),
        reopened_reason: reopenReason.trim(),
      });
      await refetchClosings();
      setReopenOpen(false);
      setReopenReason("");
      toast.success("Fechamento reaberto.");
    } catch (err) {
      toast.error("Erro ao reabrir: " + (err.message || "tente novamente"));
    }
  };

  // Atalho do badge "Requer recálculo" (Step 1): abre o diálogo de
  // confirmação para reabrir DIRETO o contrato em modo recálculo na
  // Calculadora — sem precisar o usuário navegar manualmente até o
  // contrato e achar o botão "Reabrir para Edição" lá.
  const handleOpenRecalcDialog = (contract, row, settlement) => {
    if (!isAdmin) {
      toast.error("Apenas administradores podem reabrir um contrato aprovado para recálculo.");
      return;
    }
    setRecalcTarget({ contract, row, settlement });
    setRecalcJustification(
      `Divergência na baixa da parcela ${row.parcela} (venc. ${row.dataVencimento?.split("-").reverse().join("/")}) identificada no Fechamento Contábil de ${MONTHS[month - 1]}/${year}.`
    );
  };

  const handleConfirmReopenForRecalc = async () => {
    if (!recalcTarget) return;
    if (!recalcJustification.trim()) {
      toast.warning("Informe a justificativa da reabertura.");
      return;
    }
    const { contract, row, settlement } = recalcTarget;
    setRecalcSubmitting(true);
    try {
      let history = [];
      try {
        const parsed = contract.status_history ? JSON.parse(contract.status_history) : [];
        history = Array.isArray(parsed) ? parsed : [];
      } catch {
        history = [];
      }
      history.push({
        from: contract.status,
        to: "rascunho",
        by: user?.email,
        at: new Date().toISOString(),
        comments: recalcJustification.trim(),
      });

      // Volta para esta mesma tela (mesma empresa/competência) depois do
      // recálculo ser salvo — ver Simulator.jsx (recalcFlag.returnTo).
      const returnTo = `${createPageUrl("Accounting")}?tab=fechamento&entity=${encodeURIComponent(entityId || "")}&month=${month}&year=${year}`;

      await base44.entities.LoanContract.update(contract.id, {
        status: "rascunho",
        status_history: JSON.stringify(history),
        // Campo dinâmico (extra_json) — não exige migração. Lido de volta
        // em Simulator.jsx → loadContractForEdit para o "modo recálculo".
        recalculation_flag: {
          parcela: row.parcela,
          dataVencimento: row.dataVencimento,
          contractNumber: contract.contract_number,
          settlementId: settlement?.id || null,
          note: recalcJustification.trim(),
          flaggedBy: user?.email,
          flaggedAt: new Date().toISOString(),
          returnTo,
        },
      });

      setRecalcTarget(null);
      setRecalcJustification("");
      window.location.href = `${createPageUrl("Simulator")}?edit=${contract.id}`;
    } catch (err) {
      toast.error("Erro ao reabrir contrato: " + (err.message || "tente novamente"));
    } finally {
      setRecalcSubmitting(false);
    }
  };

  if (!entityId) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-slate-500">
          Selecione uma empresa específica no filtro acima — o fechamento contábil é sempre individual, por empresa.
        </CardContent>
      </Card>
    );
  }

  const isApproved = closing?.status === "aprovado";
  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-6">
      {/* Cabeçalho do fechamento */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4 justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 uppercase tracking-wider">Empresa</Label>
                <p className="text-sm font-semibold text-slate-800 h-9 flex items-center">{entityName}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 uppercase tracking-wider">Competência</Label>
                <div className="flex gap-1.5">
                  <Select value={String(month)} onValueChange={(v) => { setMonth(Number(v)); setDataBase(lastDayOfMonth(year, Number(v))); }} disabled={isApproved}>
                    <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (<SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <Input type="number" className="h-9 w-24" value={year}
                    onChange={(e) => { setYear(Number(e.target.value)); setDataBase(lastDayOfMonth(Number(e.target.value), month)); }} disabled={isApproved} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 uppercase tracking-wider">
                  Data-base
                  <InfoTip text="Data usada para calcular o saldo e reclassificar principal/juros entre circulante e não circulante. Normalmente é o último dia da competência selecionada." />
                </Label>
                <Input type="date" className="h-9" value={dataBase} onChange={(e) => setDataBase(e.target.value)} disabled={isApproved} />
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Badge variant={STATUS_COLORS[closing?.status] || "secondary"}>
                {STATUS_LABELS[closing?.status] || "Não iniciado"}
              </Badge>
              {closing?.approved_by && (
                <p className="text-xs text-slate-400">
                  Aprovado por {closing.approved_by} em {closing.approved_at?.slice(0, 10).split("-").reverse().join("/")}
                </p>
              )}
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => setMatrixOpen(true)}>
                  <Settings2 className="w-3 h-3" /> Matriz contábil
                </Button>
                {isApproved && isAdmin && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => setReopenOpen(true)}>
                    <Lock className="w-3 h-3" /> Reabrir período
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 1 */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">1</span>
            Baixas de parcelas pagas
          </CardTitle>
          <p className="text-xs text-slate-500">
            Registre os pagamentos efetivamente realizados até a data-base — usados para ajustar o saldo e gerar os lançamentos.
          </p>
        </CardHeader>
        <CardContent>
          {scheduleRowsInMonth.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Nenhuma parcela prevista para esta competência.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Contrato</th>
                    <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Vencimento</th>
                    <th className="text-right font-medium text-slate-500 uppercase text-xs px-2 py-2">Principal previsto</th>
                    <th className="text-right font-medium text-slate-500 uppercase text-xs px-2 py-2">Juros previsto</th>
                    <th className="text-right font-medium text-slate-500 uppercase text-xs px-2 py-2">Total pago</th>
                    <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Situação</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {scheduleRowsInMonth.map(({ contract, row }) => {
                    const settlement = settlementByKey.get(`${contract.id}|${row.parcela}`);
                    const isEstornado = settlement?.status === "estornado";
                    return (
                      <tr key={`${contract.id}-${row.parcela}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-2 text-slate-700">{contract.contract_number}</td>
                        <td className="px-2 py-2 text-slate-700">{row.dataVencimento?.split("-").reverse().join("/")}</td>
                        <td className="px-2 py-2 text-right text-slate-700">{formatCurrency(row.amortizacao)}</td>
                        <td className="px-2 py-2 text-right text-slate-700">{formatCurrency(row.jurosPagos)}</td>
                        <td className="px-2 py-2 text-right text-slate-700">
                          {settlement && !isEstornado ? formatCurrency(settlement.total_paid) : "—"}
                        </td>
                        <td className="px-2 py-2">
                          {!settlement || isEstornado ? (
                            <Badge variant="secondary">Pendente</Badge>
                          ) : settlement.triggers_recalculation ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-6 text-xs gap-1 px-2"
                              onClick={() => handleOpenRecalcDialog(contract, row, settlement)}
                              disabled={isApproved}
                            >
                              <RotateCcw className="w-3 h-3" /> Requer recálculo
                            </Button>
                          ) : (
                            <Badge variant="default">Liquidada</Badge>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={isApproved}
                              onClick={() => handleOpenSettlement(contract, row)}>
                              {settlement && !isEstornado ? "Editar" : "Baixar"}
                            </Button>
                            {settlement && !isEstornado && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" disabled={isApproved}
                                onClick={() => handleEstornarSettlement(settlement)}>
                                Estornar
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2 */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">2</span>
                Calcular o novo saldo
              </CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                Concilia abertura, apropriações e pagamentos reais do período — por evento, não por diferença de saldo.
              </p>
            </div>
            <Button size="sm" className="gap-1.5" disabled={isApproved || calculating} onClick={handleCalculate}>
              <Calculator className="w-3.5 h-3.5" /> {calculating ? "Calculando..." : "Calcular fechamento"}
            </Button>
          </div>
        </CardHeader>
        {calcResult && (
          <CardContent className="space-y-4">
            {calcResult.hasBlockingDivergence && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {calcResult.pendingRecalculation.length} baixa(s) exigem recálculo do contrato antes de seguir
                para aprovação — reabra {calcResult.pendingRecalculation.map((p) => p.contractNumber).join(", ")} na Calculadora.
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-xs text-slate-500">Saldo anterior</p>
                <p className="font-semibold">{formatCurrency(calcResult.opening.principal + calcResult.opening.interest + calcResult.opening.fx)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-xs text-slate-500">Saldo final</p>
                <p className="font-semibold">{formatCurrency(calcResult.closing.principal + calcResult.closing.interest + calcResult.closing.fx)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-xs text-slate-500">Contratos no lote</p>
                <p className="font-semibold">{calcResult.perContract.length}</p>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-xs text-slate-500">Pendências</p>
                <p className={`font-semibold ${calcResult.hasBlockingDivergence ? "text-red-600" : "text-emerald-600"}`}>
                  {calcResult.pendingRecalculation.length}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Evento</th>
                    <th className="text-right font-medium text-slate-500 uppercase text-xs px-2 py-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(calcResult.eventTotals).map(([type, amount]) => (
                    <tr key={type} className="border-b border-slate-100">
                      <td className="px-2 py-2 text-slate-700">{EVENT_TYPE_LABELS[type] || type}</td>
                      <td className="px-2 py-2 text-right text-slate-700">{formatCurrency(amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Step 3 */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">3</span>
                Checar e validar contabilidade
              </CardTitle>
              <p className="text-xs text-slate-500 mt-1">Confira os lançamentos gerados e aprove o lote para finalizar o fechamento.</p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!calcResult || isApproved} onClick={handleBuildJournal}>
              <ClipboardCheck className="w-3.5 h-3.5" /> Gerar lançamentos
            </Button>
          </div>
        </CardHeader>
        {journalResult && (
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Data</th>
                    <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Evento</th>
                    <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Conta</th>
                    <th className="text-right font-medium text-slate-500 uppercase text-xs px-2 py-2">Débito</th>
                    <th className="text-right font-medium text-slate-500 uppercase text-xs px-2 py-2">Crédito</th>
                  </tr>
                </thead>
                <tbody>
                  {journalResult.entries.map((e, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-2 py-2 text-slate-700">{e.entry_date?.split("-").reverse().join("/")}</td>
                      <td className="px-2 py-2 text-slate-700">{EVENT_TYPE_LABELS[e.event_type] || e.event_type}</td>
                      <td className="px-2 py-2 text-slate-700">{accountName(e.account_id)}</td>
                      <td className="px-2 py-2 text-right text-slate-700">{e.side === "debito" ? formatCurrency(e.amount) : ""}</td>
                      <td className="px-2 py-2 text-right text-slate-700">{e.side === "credito" ? formatCurrency(e.amount) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="px-2 py-2" colSpan={3}>Totais</td>
                    <td className="px-2 py-2 text-right">{formatCurrency(journalResult.totalDebito)}</td>
                    <td className="px-2 py-2 text-right">{formatCurrency(journalResult.totalCredito)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {!approveGate.canApprove && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
                {approveGate.reasons.map((r, i) => (<p key={i} className="flex gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{r}</p>))}
              </div>
            )}

            <div className="flex justify-end">
              <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={!approveGate.canApprove || isApproved || approving} onClick={handleApprove}>
                <CheckCircle2 className="w-3.5 h-3.5" /> {approving ? "Aprovando..." : "Aprovar fechamento"}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <SettlementDialog
        open={!!dialogTarget}
        onOpenChange={(open) => !open && setDialogTarget(null)}
        contract={dialogTarget?.contract}
        scheduleRow={dialogTarget?.scheduleRow}
        existing={dialogTarget?.existing}
        bankAccounts={bankAccounts}
        dataBase={dataBase}
        onSave={handleSaveSettlement}
        saving={savingSettlement}
      />

      <AccountingMatrixConfig entityId={entityId} open={matrixOpen} onOpenChange={setMatrixOpen} />

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Reabrir fechamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">
              Reabrir um período aprovado exige justificativa e fica registrado no histórico. A competência
              seguinte, se já aprovada, deve ser marcada como potencialmente desatualizada.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Justificativa *</Label>
              <Textarea className="min-h-20" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setReopenOpen(false)}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={handleReopen}>Confirmar reabertura</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!recalcTarget} onOpenChange={(open) => { if (!open) { setRecalcTarget(null); setRecalcJustification(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Reabrir contrato para recálculo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">
              O contrato {recalcTarget?.contract?.contract_number} volta para rascunho e abre direto na Calculadora,
              em modo recálculo, com a parcela {recalcTarget?.row?.parcela} destacada. Ao salvar o novo cálculo lá,
              você volta automaticamente para esta mesma tela.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Justificativa *</Label>
              <Textarea className="min-h-20" value={recalcJustification} onChange={(e) => setRecalcJustification(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { setRecalcTarget(null); setRecalcJustification(""); }}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={handleConfirmReopenForRecalc} disabled={recalcSubmitting}>
              {recalcSubmitting ? "Reabrindo..." : "Reabrir e ir para a Calculadora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
