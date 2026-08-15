import React, { useState } from "react";
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

export default function EntityForm({ groupId, onSubmit, onCancel, initialData }) {
  const [form, setForm] = useState(initialData || {
    group_id: groupId,
    entity_name: "",
    document_number: "",
    document_type: "CNPJ",
    entity_type: "empresa",
    status: "ativa",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
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
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo de Entidade *</Label>
            <Select value={form.entity_type} onValueChange={(v) => setForm({ ...form, entity_type: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="empresa">Pessoa Jurídica (PJ)</SelectItem>
                <SelectItem value="pf">Pessoa Física (PF)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              {form.entity_type === "pf" ? "CPF" : "CNPJ"} *
            </Label>
            <Select value={form.document_type} onValueChange={(v) => setForm({ ...form, document_type: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CNPJ">CNPJ</SelectItem>
                <SelectItem value="CPF">CPF</SelectItem>
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
            <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5">
              <X className="w-3.5 h-3.5" /> Cancelar
            </Button>
            <Button type="submit" className="bg-green-600 hover:bg-green-700 gap-1.5">
              <Save className="w-3.5 h-3.5" /> {initialData ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}