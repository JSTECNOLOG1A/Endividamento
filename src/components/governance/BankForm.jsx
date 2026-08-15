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
import { Building, Save, X } from "lucide-react";

export default function BankForm({ onSubmit, onCancel, initialData }) {
  const [form, setForm] = useState(initialData || {
    bank_code: "",
    bank_name: "",
    bank_type: "privado",
    status: "ativo",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <Building className="w-4 h-4 text-purple-600" />
          {initialData ? "Editar Banco" : "Novo Banco"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Código (COMPE/SPB) *</Label>
              <Input
                value={form.bank_code}
                onChange={(e) => setForm({ ...form, bank_code: e.target.value })}
                placeholder="001"
                className="h-9 font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Nome do Banco *</Label>
              <Input
                value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                placeholder="Banco do Brasil"
                className="h-9"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</Label>
              <Select value={form.bank_type} onValueChange={(v) => setForm({ ...form, bank_type: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="privado">Privado</SelectItem>
                  <SelectItem value="publico">Público</SelectItem>
                  <SelectItem value="estrangeiro">Estrangeiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5">
              <X className="w-3.5 h-3.5" /> Cancelar
            </Button>
            <Button type="submit" className="bg-purple-600 hover:bg-purple-700 gap-1.5">
              <Save className="w-3.5 h-3.5" /> {initialData ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}