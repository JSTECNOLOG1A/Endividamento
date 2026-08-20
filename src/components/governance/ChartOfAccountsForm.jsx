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
import { BookOpen, Save, X } from "lucide-react";

export default function ChartOfAccountsForm({ onSubmit, onCancel, initialData }) {
  const [form, setForm] = useState(initialData || {
    account_code: "",
    account_name: "",
    account_class: "despesa",
    account_type: "analitica",
    account_nature: "devedora",
    origem: "manual",
    status: "ativo",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...form,
      origem: initialData?.origem || "manual",
    });
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <BookOpen className="w-4 h-4 text-indigo-600" />
          {initialData ? "Editar Conta" : "Nova Conta"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Código *</Label>
              <Input
                value={form.account_code || ""}
                onChange={(e) => setForm({ ...form, account_code: e.target.value })}
                placeholder="3.1.01.001"
                className="h-9"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Nome *</Label>
              <Input
                value={form.account_name || ""}
                onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                placeholder="Juros sobre empréstimos"
                className="h-9"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Classe</Label>
              <Select value={form.account_class} onValueChange={(v) => setForm({ ...form, account_class: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="passivo">Passivo</SelectItem>
                  <SelectItem value="patrimonio_liquido">Patrimônio líquido</SelectItem>
                  <SelectItem value="receita">Receita</SelectItem>
                  <SelectItem value="despesa">Despesa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</Label>
              <Select value={form.account_type} onValueChange={(v) => setForm({ ...form, account_type: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="analitica">Analítica</SelectItem>
                  <SelectItem value="sintetica">Sintética</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Natureza</Label>
              <Select value={form.account_nature} onValueChange={(v) => setForm({ ...form, account_nature: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="devedora">Devedora</SelectItem>
                  <SelectItem value="credora">Credora</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onCancel} className="gap-1.5">
              <X className="w-3.5 h-3.5" /> Cancelar
            </Button>
            <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5">
              <Save className="w-3.5 h-3.5" /> {initialData ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
