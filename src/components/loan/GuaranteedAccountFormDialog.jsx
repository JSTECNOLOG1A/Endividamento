import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { INDEXERS } from "@/lib/contractOptions";
import { toast } from "@/lib/notify";

// Extraído de GuaranteedAccounts.jsx pra ser reaproveitado também pelo botão
// "+ Nova Conta Garantida" em Contratos — mesmo formulário, mesma lógica de
// criação, chamado a partir de dois lugares diferentes, sem duplicar nada.
// A gestão do dia a dia (saques, pagamentos, extrato, renovação) continua só
// em GuaranteedAccounts.jsx — isso aqui é só a abertura/edição do cadastro.

const parseBRNumber = (str) => {
  if (!str) return 0;
  const cleaned = String(str).replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
};

const emptyForm = {
  group_id: "", entity_id: "", bank_id: "",
  contract_number: "", operation_value: "",
  fixed_rate: "", indexer: "NA", indexer_spread: "",
  operation_date: new Date().toISOString().split("T")[0],
  final_maturity_date: "",
};

function contractToForm(contract) {
  return {
    group_id: contract.group_id || "",
    entity_id: contract.entity_id || "",
    bank_id: contract.bank_id || "",
    contract_number: contract.contract_number || "",
    operation_value: String(contract.operation_value ?? ""),
    fixed_rate: String(contract.fixed_rate ?? ""),
    indexer: contract.indexer || "NA",
    indexer_spread: String(contract.indexer_spread ?? ""),
    operation_date: contract.operation_date ? String(contract.operation_date).split("T")[0] : "",
    final_maturity_date: contract.final_maturity_date ? String(contract.final_maturity_date).split("T")[0] : "",
  };
}

// Título a pagar da conta garantida é derivado do saldo projetado (ver
// backend/src/modules/payables/generate.js) — precisa ser recalculado
// sempre que algo que afeta esse saldo muda (lançamento, taxa, vencimento).
// Erro aqui não deve travar a ação principal (o lançamento/edição já foi
// salvo) — só loga, o próximo refresh corrige.
export async function refreshGuaranteedAccountTitle(contractId, queryClient) {
  try {
    await base44.functions.invoke("refreshGuaranteedAccountPayableTitle", { contractId });
    queryClient.invalidateQueries({ queryKey: ["payable-titles"] });
  } catch (err) {
    console.error("Erro ao atualizar título de contas a pagar da conta garantida:", err);
  }
}

export default function GuaranteedAccountFormDialog({ open, onOpenChange, groups, entities, banks, onSaved, editContract }) {
  const isEdit = !!editContract;
  const [form, setForm] = useState(emptyForm);
  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const filteredEntities = form.group_id ? entities.filter((e) => e.group_id === form.group_id) : [];
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (open) setForm(editContract ? contractToForm(editContract) : emptyForm);
  }, [open, editContract]);

  const payload = {
    group_id: form.group_id,
    entity_id: form.entity_id,
    bank_id: form.bank_id,
    contract_number: form.contract_number,
    operation_value: parseBRNumber(form.operation_value),
    fixed_rate: parseBRNumber(form.fixed_rate),
    indexer: form.indexer,
    indexer_spread: parseBRNumber(form.indexer_spread),
    operation_date: form.operation_date,
    final_maturity_date: form.final_maturity_date,
  };

  const saveMutation = useMutation({
    mutationFn: () => isEdit
      ? base44.entities.LoanContract.update(editContract.id, payload)
      : base44.entities.LoanContract.create({
        ...payload,
        operation_category: "emprestimos",
        operation_type: "conta_garantida",
        calculation_system: "CONTA_GARANTIDA",
        status: "aprovado",
      }),
    onSuccess: async (saved) => {
      toast.success(isEdit ? "Conta garantida atualizada" : "Conta garantida criada");
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["guaranteed-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      if (isEdit) await queryClient.invalidateQueries({ queryKey: ["guaranteed-account-statement", editContract.id] });
      await refreshGuaranteedAccountTitle(saved.id, queryClient);
      onSaved?.(saved);
    },
    onError: (err) => toast.error((isEdit ? "Erro ao salvar: " : "Erro ao criar: ") + err.message),
  });

  const canSubmit = form.group_id && form.entity_id && form.bank_id && form.contract_number
    && parseBRNumber(form.operation_value) > 0 && form.operation_date && form.final_maturity_date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Conta Garantida" : "Nova Conta Garantida"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Ajuste os dados cadastrais desta vigência. Os lançamentos (saques/pagamentos) são editados individualmente no extrato."
              : "Limite rotativo com vencimento — os saques e pagamentos são lançados depois, na tela da conta (Contratos → clique na linha depois de criada)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Grupo Econômico</Label>
              <Select value={form.group_id} onValueChange={(v) => { update("group_id", v); update("entity_id", ""); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.group_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Entidade</Label>
              <Select value={form.entity_id} onValueChange={(v) => update("entity_id", v)} disabled={!form.group_id}>
                <SelectTrigger className="h-9"><SelectValue placeholder={form.group_id ? "Selecione" : "Selecione um grupo primeiro"} /></SelectTrigger>
                <SelectContent>
                  {filteredEntities.map((e) => <SelectItem key={e.id} value={e.id}>{e.entity_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Banco</Label>
              <Select value={form.bank_id} onValueChange={(v) => update("bank_id", v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.bank_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Número do Contrato</Label>
              <Input className="h-9" value={form.contract_number} onChange={(e) => update("contract_number", e.target.value)} placeholder="000.000.000" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Limite Contratado (R$)</Label>
            <CurrencyInput className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={form.operation_value} onChange={(e) => update("operation_value", e.target.value)} placeholder="0,00" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Indexador</Label>
              <Select value={form.indexer} onValueChange={(v) => update("indexer", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INDEXERS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{form.indexer === "NA" ? "Taxa (% a.a.)" : "Taxa Fixa Adicional (% a.a.)"}</Label>
              <CurrencyInput type="percent" className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={form.fixed_rate} onChange={(e) => update("fixed_rate", e.target.value)} placeholder="0,00" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Spread sobre {form.indexer !== "NA" ? form.indexer : "indexador"} (% a.a.)</Label>
              <CurrencyInput type="percent" className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={form.indexer_spread} onChange={(e) => update("indexer_spread", e.target.value)} placeholder="0,00" disabled={form.indexer === "NA"} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Data de Abertura</Label>
              <Input className="h-9" type="date" value={form.operation_date} onChange={(e) => update("operation_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vencimento</Label>
              <Input className="h-9" type="date" value={form.final_maturity_date} onChange={(e) => update("final_maturity_date", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!canSubmit || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Salvando..." : isEdit ? "Salvar Alterações" : "Criar Conta Garantida"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
