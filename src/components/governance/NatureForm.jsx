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
import { Checkbox } from "@/components/ui/checkbox";
import { Tags, Save, X } from "lucide-react";
import { entityLabel, normalizeEmpresaCode } from "@/lib/empresaCode";

export default function NatureForm({ entities = [], onSubmit, onCancel, initialData }) {
  const [form, setForm] = useState(initialData || {
    entity_id: "",
    empresa: "",
    filial: "",
    codigo: "",
    descricao: "",
    tipo_conta: "",
    c_custo: "",
    c_des_fat: "",
    tipo_natureza: "analitica",
    gera_lcdpr: false,
    status: "ativo",
  });

  const selectedEntity = entities.find((entity) => entity.id === form.entity_id) || null;
  const empresaCode = normalizeEmpresaCode(selectedEntity?.codigo_empresa || form.empresa);

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
    if (!form.entity_id) {
      toast.warning("Selecione a entidade componente");
      return;
    }
    if (!empresaCode) {
      toast.warning("Informe o código da empresa Protheus na entidade antes de cadastrar a natureza");
      return;
    }
    onSubmit({
      entity_id: form.entity_id,
      empresa: empresaCode,
      filial: "",
      codigo: form.codigo,
      descricao: form.descricao,
      tipo_conta: form.tipo_conta || "",
      c_custo: form.c_custo || "",
      c_des_fat: form.c_des_fat || "",
      tipo_natureza: form.tipo_natureza || "analitica",
      gera_lcdpr: Boolean(form.gera_lcdpr),
      status: form.status || "ativo",
      origem: initialData?.origem || "manual",
    });
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <Tags className="w-4 h-4 text-amber-600" />
          {initialData ? "Editar Natureza" : "Nova Natureza"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Entidade *</Label>
              {entities.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Cadastre uma entidade componente e o código Protheus antes de criar a natureza.
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
                <p className="text-xs text-slate-400">
                  Empresa Protheus: {empresaCode || "informe o código da empresa na entidade"}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Código *</Label>
              <Input
                value={form.codigo || ""}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                placeholder="101010"
                className="h-9"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</Label>
            <Select value={form.tipo_natureza} onValueChange={(v) => setForm({ ...form, tipo_natureza: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="analitica">Analítica</SelectItem>
                <SelectItem value="sintetica">Sintética</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Descrição *</Label>
            <Input
              value={form.descricao || ""}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Empréstimos e financiamentos"
              className="h-9"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Receita/Despesa</Label>
              <Input
                value={form.tipo_conta || ""}
                onChange={(e) => setForm({ ...form, tipo_conta: e.target.value })}
                placeholder="Receita ou Despesa (ED_COND)"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Centro de custo</Label>
              <Input
                value={form.c_custo || ""}
                onChange={(e) => setForm({ ...form, c_custo: e.target.value })}
                placeholder="Opcional"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Cód. despesa/faturamento</Label>
              <Input
                value={form.c_des_fat || ""}
                onChange={(e) => setForm({ ...form, c_des_fat: e.target.value })}
                placeholder="Opcional"
                className="h-9"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <Checkbox
                  checked={Boolean(form.gera_lcdpr)}
                  onCheckedChange={(checked) => setForm({ ...form, gera_lcdpr: checked === true })}
                />
                Gera LCDPR
              </label>
            </div>
          </div>
          <p className="-mt-2 text-xs text-slate-400">Livro Caixa Digital do Produtor Rural (ED_LCDPR).</p>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5">
              <X className="w-3.5 h-3.5" /> Cancelar
            </Button>
            <Button type="submit" className="bg-amber-600 hover:bg-amber-700 gap-1.5" disabled={entities.length === 0 || !empresaCode}>
              <Save className="w-3.5 h-3.5" /> {initialData ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
