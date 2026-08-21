import React, { useState } from "react";
import { toast } from "@/lib/notify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Wallet, Save, X } from "lucide-react";
import { entityLabel, normalizeEmpresaCode } from "@/lib/empresaCode";

export default function BankAccountForm({
  banks = [],
  entities = [],
  bankId,
  onSubmit,
  onCancel,
  initialData,
}) {
  const [form, setForm] = useState(initialData || {
    entity_id: "",
    bank_id: bankId || "",
    empresa: "",
    filial: "",
    agencia: "",
    conta: "",
    digito: "",
    nome: "",
    tipo: "",
    status: "ativo",
  });

  const selectedEntity = entities.find((entity) => entity.id === form.entity_id) || null;
  const empresaCode = normalizeEmpresaCode(selectedEntity?.codigo_empresa || form.empresa);
  const selectedBank = banks.find((bank) => bank.id === form.bank_id) || null;

  const applyEntity = (entityId) => {
    const entity = entities.find((item) => item.id === entityId);
    setForm({
      ...form,
      entity_id: entityId,
      empresa: normalizeEmpresaCode(entity?.codigo_empresa) || "",
      filial: "",
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.bank_id) {
      toast.warning("Selecione o banco");
      return;
    }
    if (!form.entity_id) {
      toast.warning("Selecione a entidade componente");
      return;
    }
    if (!empresaCode) {
      toast.warning("Informe o código da empresa Protheus na entidade antes de cadastrar a conta");
      return;
    }
    onSubmit({
      entity_id: form.entity_id,
      bank_id: form.bank_id,
      empresa: empresaCode,
      filial: "",
      agencia: form.agencia,
      conta: form.conta,
      digito: form.digito || "",
      nome: form.nome,
      tipo: form.tipo || "",
      status: form.status || "ativo",
      origem: initialData?.origem || "manual",
    });
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <Wallet className="w-4 h-4 text-violet-600" />
          {initialData ? "Editar Conta Bancária" : "Nova Conta Bancária"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Banco *</Label>
              {banks.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Cadastre o banco antes de criar a conta.
                </p>
              ) : (
                <Select value={form.bank_id || undefined} onValueChange={(v) => setForm({ ...form, bank_id: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o banco" /></SelectTrigger>
                  <SelectContent>
                    {banks.map((bank) => (
                      <SelectItem key={bank.id} value={bank.id}>
                        {bank.bank_code} — {bank.bank_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedBank ? (
                <p className="text-xs text-slate-500">Código COMPE: {selectedBank.bank_code}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Entidade *</Label>
              {entities.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Cadastre uma entidade componente e o código Protheus antes de criar a conta.
                </p>
              ) : (
                <Select value={form.entity_id || undefined} onValueChange={applyEntity}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a entidade" /></SelectTrigger>
                  <SelectContent>
                    {entities.map((entity) => (
                      <SelectItem key={entity.id} value={entity.id}>{entityLabel(entity)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedEntity ? (
                <p className="text-xs text-slate-500">
                  Empresa Protheus: {empresaCode || "informe o código da empresa na entidade"}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Agência *</Label>
              <Input
                value={form.agencia || ""}
                onChange={(e) => setForm({ ...form, agencia: e.target.value })}
                placeholder="0001"
                className="h-9"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Conta *</Label>
              <Input
                value={form.conta || ""}
                onChange={(e) => setForm({ ...form, conta: e.target.value })}
                placeholder="12345-6"
                className="h-9"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Dígito</Label>
              <Input
                value={form.digito || ""}
                onChange={(e) => setForm({ ...form, digito: e.target.value })}
                placeholder="Opcional"
                className="h-9"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Nome *</Label>
              <Input
                value={form.nome || ""}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Conta movimento"
                className="h-9"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Tipo</Label>
              <Input
                value={form.tipo || ""}
                onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                placeholder="Corrente, aplicação..."
                className="h-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="-mt-2 text-xs text-slate-500">
            O A6_FILIAL do ERP é a empresa da entidade; a filial fica em branco. A conta só entra se o A6_COD for o COMPE deste banco.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5">
              <X className="w-3.5 h-3.5" /> Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-violet-600 hover:bg-violet-700 gap-1.5"
              disabled={banks.length === 0 || entities.length === 0 || !empresaCode}
            >
              <Save className="w-3.5 h-3.5" /> {initialData ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
