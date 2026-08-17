import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { normalizeEmpresaCode } from "@/lib/empresaCode";
import { erpStatusOf } from "@/lib/erpStatus";
import ErpLookupPanel, { LookupField } from "@/components/payables/ErpLookupDialog";

export function naturesForEntity(natures = [], entity) {
  if (!entity) return [];
  const empresa = normalizeEmpresaCode(entity.codigo_empresa);
  return natures.filter((item) => {
    if (item.status && item.status !== "ativo") return false;
    if (String(item.tipo_natureza || "").toLowerCase() === "sintetica") return false;
    if (item.entity_id && item.entity_id === entity.id) return true;
    const natureEmpresa = normalizeEmpresaCode(item.empresa) || normalizeEmpresaCode(item.filial);
    return Boolean(empresa && natureEmpresa && empresa === natureEmpresa);
  });
}

export default function ClassifyTitleDialog({
  open,
  onOpenChange,
  titles = [],
  allTitles = [],
  natures = [],
  entities = [],
  submitting = false,
  onSubmit,
}) {
  const entityId = titles[0]?.entity_id || "";
  const entity = entities.find((item) => item.id === entityId) || null;

  const [tipo, setTipo] = useState(titles[0]?.tipo || "NP");
  const [natureza, setNatureza] = useState(titles[0]?.natureza || "");
  const [fornecedor, setFornecedor] = useState(titles[0]?.fornecedor || "");
  const [fornecedorLoja, setFornecedorLoja] = useState(titles[0]?.fornecedor_loja || "01");
  const [fornecedorNome, setFornecedorNome] = useState(titles[0]?.fornecedor_nome || "");
  const [applyByType, setApplyByType] = useState(true);
  const [lookup, setLookup] = useState(null);

  useEffect(() => {
    if (!open) return;
    setTipo(titles[0]?.tipo || "NP");
    setNatureza(titles[0]?.natureza || "");
    setFornecedor(titles[0]?.fornecedor || "");
    setFornecedorLoja(titles[0]?.fornecedor_loja || "01");
    setFornecedorNome(titles[0]?.fornecedor_nome || "");
    setApplyByType(true);
    setLookup(null);
  }, [open, titles]);

  const availableNatures = naturesForEntity(natures, entity);
  const typeCount = allTitles.filter((item) => (
    item.entity_id === entityId
    && String(item.tipo || "").toUpperCase() === String(tipo || "").toUpperCase()
    && item.status === "aberto"
    && erpStatusOf(item) !== "integrado"
  )).length;

  const handleSubmit = () => {
    onSubmit({
      ids: titles.map((item) => item.id),
      entity_id: entityId,
      tipo,
      natureza,
      fornecedor,
      fornecedor_loja: fornecedorLoja,
      fornecedor_nome: fornecedorNome,
      applyByType,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{lookup ? (lookup === "tipos" ? "Consultar tipos de título" : "Consultar fornecedores") : "Classificar títulos"}</DialogTitle>
          </DialogHeader>
          {lookup ? (
            <ErpLookupPanel
              kind={lookup}
              empresa={entity?.codigo_empresa || ""}
              initialSearch={lookup === "fornecedores" ? (fornecedorNome || fornecedor) : tipo}
              onBack={() => setLookup(null)}
              onSelect={(item) => {
                if (lookup === "tipos") setTipo(item.codigo);
                else {
                  setFornecedor(item.codigo);
                  setFornecedorLoja(item.loja || "01");
                  setFornecedorNome(item.nome || item.razao || "");
                }
                setLookup(null);
              }}
            />
          ) : (
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              Informe o código da natureza (ED_CODIGO). Tipo e fornecedor podem ser buscados direto no Protheus pela lupa.
            </p>
            <LookupField
              label="Tipo de título"
              value={tipo}
              onChange={(value) => setTipo(String(value || "").toUpperCase())}
              onLookup={() => setLookup("tipos")}
              placeholder="NP, NF, TX..."
              mono
            />
            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Natureza (ED_CODIGO)</Label>
              <Select value={natureza || undefined} onValueChange={setNatureza}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o código da natureza" /></SelectTrigger>
                <SelectContent>
                  {availableNatures.length === 0 ? (
                    <SelectItem value="__none__" disabled>Nenhuma natureza analítica para esta entidade</SelectItem>
                  ) : availableNatures.map((item) => (
                    <SelectItem key={item.id} value={item.codigo}>
                      {item.codigo} — {item.descricao}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <LookupField
                className="col-span-2"
                label="Fornecedor"
                value={fornecedor}
                onChange={setFornecedor}
                onLookup={() => setLookup("fornecedores")}
                placeholder="Código SA2"
                mono
              />
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Loja</Label>
                <Input value={fornecedorLoja} onChange={(event) => setFornecedorLoja(event.target.value)} className="h-9 font-mono" placeholder="01" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Nome do fornecedor</Label>
              <Input value={fornecedorNome} onChange={(event) => setFornecedorNome(event.target.value)} className="h-9" />
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <Checkbox checked={applyByType} onCheckedChange={(value) => setApplyByType(value === true)} className="mt-0.5" />
              <span>
                Aplicar a todos os títulos <strong>{tipo || "deste tipo"}</strong> desta entidade ainda não integrados
                {typeCount ? ` (${typeCount})` : ""}.
              </span>
            </label>
          </div>
          )}
          {!lookup && (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting || !natureza || natureza === "__none__"}>
              {submitting ? "Salvando..." : "Classificar"}
            </Button>
          </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
  );
}
