import React, { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Users, Save, X } from "lucide-react";

function resolveGroupId(initialData, groupId, groups) {
  return initialData?.group_id || groupId || (groups.length === 1 ? groups[0].id : "") || "";
}

export default function EntityForm({ groups = [], groupId, onSubmit, onCancel, initialData, submitting = false }) {
  const [form, setForm] = useState(() => ({
    group_id: resolveGroupId(initialData, groupId, groups),
    entity_name: initialData?.entity_name || "",
    document_number: initialData?.document_number || "",
    document_type: initialData?.document_type || "CNPJ",
    entity_type: initialData?.entity_type || "empresa",
    codigo_empresa: initialData?.codigo_empresa || "",
    codigo_filial: initialData?.codigo_filial || "",
    status: initialData?.status || "ativa",
  }));

  useEffect(() => {
    setForm((prev) => {
      if (prev.group_id) return prev;
      const next = resolveGroupId(initialData, groupId, groups);
      if (!next) return prev;
      return { ...prev, group_id: next };
    });
  }, [groupId, groups, initialData]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.group_id) {
      toast.error("Selecione o grupo econômico");
      return;
    }
    if (!String(form.entity_name || "").trim() || !String(form.document_number || "").trim()) {
      toast.error("Preencha nome e documento");
      return;
    }
    const codigoEmpresa = String(form.codigo_empresa || "").trim();
    const codigoFilial = String(form.codigo_filial || "").trim();
    onSubmit({
      ...form,
      entity_name: String(form.entity_name).trim(),
      document_number: String(form.document_number).trim(),
      codigo_empresa: codigoEmpresa,
      codigo_filial: codigoFilial,
    });
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <Users className="w-4 h-4 text-green-600" />
          {initialData ? "Editar Entidade" : "Nova Entidade Componente"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Grupo econômico *</Label>
            {groups.length === 0 ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Cadastre um grupo econômico na aba Grupos antes de criar a entidade.
              </p>
            ) : (
              <Select value={form.group_id || undefined} onValueChange={(v) => setForm({ ...form, group_id: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o grupo" /></SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>{group.group_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo de Entidade *</Label>
            <Select
              value={form.entity_type}
              onValueChange={(v) => setForm({
                ...form,
                entity_type: v,
                document_type: v === "pf" ? "CPF" : "CNPJ",
              })}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="empresa">Pessoa Jurídica (PJ)</SelectItem>
                <SelectItem value="pf">Pessoa Física (PF)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              {form.document_type === "CPF" ? "CPF" : "CNPJ"} *
            </Label>
            <Input
              value={form.document_number}
              onChange={(e) => setForm({ ...form, document_number: e.target.value })}
              placeholder={form.document_type === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"}
              className="h-9 font-mono"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Nome *</Label>
            <Input
              value={form.entity_name}
              onChange={(e) => setForm({ ...form, entity_name: e.target.value })}
              placeholder="Nome da empresa ou pessoa"
              className="h-9"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Empresa Protheus</Label>
              <Input
                value={form.codigo_empresa}
                onChange={(e) => setForm({ ...form, codigo_empresa: e.target.value })}
                placeholder="02"
                className="h-9 font-mono"
                maxLength={10}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Filial Protheus</Label>
              <Input
                value={form.codigo_filial}
                onChange={(e) => setForm({ ...form, codigo_filial: e.target.value })}
                placeholder="01"
                className="h-9 font-mono"
                maxLength={10}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-slate-400">
            Código da empresa no Protheus (M0_CODIGO). Em naturezas (ED_FILIAL) e contas bancárias (A6_FILIAL) esse código é a empresa; a filial fica em branco.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativa">Ativa</SelectItem>
                <SelectItem value="inativa">Inativa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5" disabled={submitting}>
              <X className="w-3.5 h-3.5" /> Cancelar
            </Button>
            <Button type="submit" className="bg-green-600 hover:bg-green-700 gap-1.5" disabled={submitting || groups.length === 0}>
              <Save className="w-3.5 h-3.5" /> {submitting ? "Salvando..." : initialData ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
