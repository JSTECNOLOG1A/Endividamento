import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/notify";
import { formatCivilDate, todayInBrazil } from "@/lib/taxDates";
import {
  AGREEMENT_STATUS_OPTIONS,
  BRAZILIAN_STATES,
  FEDERAL_AGENCY_SUGGESTIONS,
  parseCurrencyField,
  toCurrencyField,
} from "@/lib/taxLabels";
import { useInvalidateTax } from "@/hooks/useTaxData";
import { FieldError, serverErrorField } from "./TaxBadges";

const EMPTY_FORM = {
  entity_id: "",
  orgao: "",
  uf: "",
  modalidade: "",
  tributo: "",
  codigo_parcelamento: "",
  data_adesao: "",
  qtd_parcelas: "",
  saldo_oficial: "",
  saldo_data_base: "",
  situacao: "ativo",
  ultima_conferencia: "",
  observacoes: "",
};

function agreementToForm(agreement) {
  return {
    entity_id: agreement.entity_id || "",
    orgao: agreement.orgao || "",
    uf: agreement.uf || "",
    modalidade: agreement.modalidade || "",
    tributo: agreement.tributo || "",
    codigo_parcelamento: agreement.codigo_parcelamento || "",
    data_adesao: agreement.data_adesao || "",
    qtd_parcelas: agreement.qtd_parcelas ? String(agreement.qtd_parcelas) : "",
    saldo_oficial: toCurrencyField(agreement.saldo_oficial),
    saldo_data_base: agreement.saldo_data_base || "",
    situacao: agreement.situacao || "ativo",
    ultima_conferencia: agreement.ultima_conferencia || "",
    observacoes: agreement.observacoes || "",
  };
}

function formToPayload(form, esfera, isEdit) {
  const payload = {
    entity_id: form.entity_id,
    orgao: form.orgao,
    modalidade: form.modalidade,
    tributo: form.tributo,
    codigo_parcelamento: form.codigo_parcelamento,
    data_adesao: form.data_adesao || null,
    qtd_parcelas: form.qtd_parcelas === "" ? null : Number(form.qtd_parcelas),
    saldo_oficial: parseCurrencyField(form.saldo_oficial),
    saldo_data_base: form.saldo_data_base || null,
    situacao: form.situacao,
    ultima_conferencia: form.ultima_conferencia || null,
    observacoes: form.observacoes,
  };
  if (!isEdit) payload.esfera = esfera;
  if (esfera === "estadual") payload.uf = form.uf;
  return payload;
}

export default function TaxAgreementFormDialog({ open, onOpenChange, esfera, agreement, entities, onSaved }) {
  const isEdit = Boolean(agreement);
  const isState = esfera === "estadual";
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [balanceCheckedToday, setBalanceCheckedToday] = useState(false);
  const invalidateTax = useInvalidateTax();
  const today = todayInBrazil();

  useEffect(() => {
    if (!open) return;
    setForm(agreement ? agreementToForm(agreement) : EMPTY_FORM);
    setFieldErrors({});
    setBalanceCheckedToday(false);
  }, [open]); // preenchido só na abertura, para um refetch não apagar o que foi digitado

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => (current[field] ? { ...current, [field]: null } : current));
  };

  const balanceChanged =
    isEdit &&
    (parseCurrencyField(form.saldo_oficial) !== (agreement.saldo_oficial ?? null) ||
      (form.saldo_data_base || null) !== (agreement.saldo_data_base || null));

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = formToPayload(form, esfera, isEdit);
      // Saldo novo sem conferência: o servidor zera a última conferência quando ela não vem junto.
      if (balanceChanged) {
        if (balanceCheckedToday) payload.ultima_conferencia = today;
        else delete payload.ultima_conferencia;
      }
      return isEdit
        ? base44.entities.TaxAgreement.update(agreement.id, payload)
        : base44.entities.TaxAgreement.create(payload);
    },
    onSuccess: async (saved) => {
      toast.success(isEdit ? "Parcelamento atualizado" : "Parcelamento cadastrado");
      await invalidateTax();
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (error) => {
      const field = serverErrorField(error);
      if (field) setFieldErrors({ [field]: error.message });
      toast.error(error.message);
    },
  });

  const selectableEntities = entities.filter(
    (item) => !item.status || item.status === "ativa" || item.id === form.entity_id
  );
  const busy = saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar parcelamento" : `Novo parcelamento ${isState ? "estadual" : "federal"}`}</DialogTitle>
          <DialogDescription>
            Os dados são informados manualmente e ficam marcados assim na tela. Confira no {isState ? "portal da Fazenda" : "e-CAC"} e
            registre a data da conferência.
          </DialogDescription>
        </DialogHeader>

        <form
          id="tax-agreement-form"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs" htmlFor="tax-entity">Empresa</Label>
              {entities.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-2 text-xs text-slate-600">
                  Nenhuma empresa cadastrada. Acesse: Governança → Entidades Componentes.
                </p>
              ) : (
                <Select value={form.entity_id} onValueChange={(value) => update("entity_id", value)}>
                  <SelectTrigger id="tax-entity" className="h-9" aria-invalid={Boolean(fieldErrors.entity_id)}>
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableEntities.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.entity_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <FieldError message={fieldErrors.entity_id} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-orgao">Órgão</Label>
              <Input
                id="tax-orgao"
                className="h-9"
                list={isState ? undefined : "tax-federal-agencies"}
                value={form.orgao}
                onChange={(event) => update("orgao", event.target.value)}
                placeholder={isState ? "Ex.: Secretaria da Fazenda" : "Receita Federal ou PGFN"}
              />
              {isState ? null : (
                <datalist id="tax-federal-agencies">
                  {FEDERAL_AGENCY_SUGGESTIONS.map((item) => <option key={item} value={item} />)}
                </datalist>
              )}
              <FieldError message={fieldErrors.orgao} />
            </div>

            {isState ? (
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="tax-uf">UF</Label>
                <Select value={form.uf} onValueChange={(value) => update("uf", value)}>
                  <SelectTrigger id="tax-uf" className="h-9"><SelectValue placeholder="Selecione o estado" /></SelectTrigger>
                  <SelectContent>
                    {BRAZILIAN_STATES.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FieldError message={fieldErrors.uf} />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-modalidade">Modalidade</Label>
              <Input
                id="tax-modalidade"
                className="h-9"
                value={form.modalidade}
                onChange={(event) => update("modalidade", event.target.value)}
                placeholder="Ex.: Parcelamento simplificado"
              />
              <FieldError message={fieldErrors.modalidade} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-tributo">Tributo (opcional)</Label>
              <Input
                id="tax-tributo"
                className="h-9"
                value={form.tributo}
                onChange={(event) => update("tributo", event.target.value)}
                placeholder={isState ? "Ex.: ICMS" : "Ex.: IRPJ, CSLL, PIS/Cofins"}
              />
              <FieldError message={fieldErrors.tributo} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-codigo">Número do parcelamento</Label>
              <Input
                id="tax-codigo"
                className="h-9"
                value={form.codigo_parcelamento}
                onChange={(event) => update("codigo_parcelamento", event.target.value)}
                placeholder="Como aparece no e-CAC/portal"
              />
              <FieldError message={fieldErrors.codigo_parcelamento} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-adesao">Data de adesão (opcional)</Label>
              <Input id="tax-adesao" type="date" className="h-9" value={form.data_adesao} onChange={(event) => update("data_adesao", event.target.value)} />
              <FieldError message={fieldErrors.data_adesao} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-qtd">Quantidade de parcelas (opcional)</Label>
              <Input
                id="tax-qtd"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                className="h-9"
                value={form.qtd_parcelas}
                onChange={(event) => update("qtd_parcelas", event.target.value)}
              />
              <FieldError message={fieldErrors.qtd_parcelas} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-situacao">Situação</Label>
              <Select value={form.situacao} onValueChange={(value) => update("situacao", value)}>
                <SelectTrigger id="tax-situacao" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AGREEMENT_STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldError message={fieldErrors.situacao} />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-saldo">Saldo devedor (opcional)</Label>
              <CurrencyInput
                id="tax-saldo"
                className="h-9 bg-white"
                value={form.saldo_oficial}
                onChange={(event) => update("saldo_oficial", event.target.value)}
                placeholder="0,00"
              />
              <FieldError message={fieldErrors.saldo_oficial} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-saldo-data">Data-base do saldo</Label>
              <Input
                id="tax-saldo-data"
                type="date"
                className="h-9 bg-white"
                value={form.saldo_data_base}
                onChange={(event) => update("saldo_data_base", event.target.value)}
              />
              <FieldError message={fieldErrors.saldo_data_base} />
            </div>
            <p className="text-[11px] text-slate-500 sm:col-span-2">
              Informe o saldo como aparece no {isState ? "portal" : "e-CAC"} e a data a que ele se refere.
            </p>
            {balanceChanged ? (
              <div className="space-y-1 sm:col-span-2">
                <label className="flex items-start gap-2 text-xs text-slate-700" htmlFor="tax-saldo-conferido">
                  <Checkbox
                    id="tax-saldo-conferido"
                    className="mt-0.5"
                    checked={balanceCheckedToday}
                    onCheckedChange={(value) => setBalanceCheckedToday(value === true)}
                  />
                  Conferi este saldo hoje no {isState ? "portal" : "e-CAC"} (a última conferência passa a ser {formatCivilDate(today)})
                </label>
                {balanceCheckedToday ? null : (
                  <p className="pl-6 text-[11px] text-amber-700">
                    Sem marcar, o parcelamento passa a aparecer como não conferido (desatualizado) até alguém conferir no{" "}
                    {isState ? "portal" : "e-CAC"} e registrar a conferência.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="tax-conferencia">Última conferência no {isState ? "portal" : "e-CAC"}</Label>
              <Input
                id="tax-conferencia"
                type="date"
                max={today}
                className="h-9"
                value={balanceChanged ? (balanceCheckedToday ? today : "") : form.ultima_conferencia}
                disabled={balanceChanged}
                onChange={(event) => update("ultima_conferencia", event.target.value)}
              />
              <FieldError message={fieldErrors.ultima_conferencia} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs" htmlFor="tax-obs">Observações (opcional)</Label>
              <Textarea id="tax-obs" rows={3} value={form.observacoes} onChange={(event) => update("observacoes", event.target.value)} />
              <FieldError message={fieldErrors.observacoes} />
            </div>
          </div>
        </form>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="tax-agreement-form" disabled={busy || entities.length === 0}>
            {busy ? "Salvando…" : isEdit ? "Salvar alterações" : "Cadastrar parcelamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
