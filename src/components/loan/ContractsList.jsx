import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, FileText, Trash2, Eye, Edit, Copy } from "lucide-react";

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value || 0);
}

const statusColors = {
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rascunho: "bg-blue-100 text-blue-800 border-blue-200",
  pendente_aprovacao: "bg-amber-100 text-amber-800 border-amber-200",
  cancelado: "bg-red-100 text-red-800 border-red-200",
};

const systemLabels = {
  SAC: "SAC",
  PRICE: "Price",
  AMERICANO: "Americano",
  BULLET: "Bullet",
};

export default function ContractsList({ contracts, banks, onView, onEdit, onDelete, onDuplicate, isLoading }) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="border-slate-200 animate-pulse">
            <CardContent className="p-4">
              <div className="h-16 bg-slate-100 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!contracts || contracts.length === 0) {
    return (
      <Card className="border-slate-200 border-dashed">
        <CardContent className="p-12 text-center">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Nenhum contrato encontrado</p>
          <p className="text-xs text-slate-400 mt-1">Ajuste os filtros ou crie uma nova simulação</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {contracts.map((c) => {
        const bankName = banks?.find(b => b.id === c.bank_id)?.bank_name || "N/A";
        return (
          <Card key={c.id} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-100 flex-shrink-0">
                    <Building2 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-800 truncate">{bankName}</h3>
                      <Badge variant="outline" className="text-xs font-mono">{c.contract_number}</Badge>
                      <Badge className={`text-xs border ${statusColors[c.status || "rascunho"]}`}>
                        {c.status?.replace("_", " ") || "rascunho"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span className="font-mono font-medium text-slate-700">{formatCurrency(c.operation_value)}</span>
                      <span>•</span>
                      <span>{systemLabels[c.calculation_system] || c.calculation_system}</span>
                      <span>•</span>
                      <span>{c.fixed_rate}% a.a.</span>
                      {c.indexer !== "NA" && (
                        <>
                          <span>+</span>
                          <span>{c.indexer}</span>
                        </>
                      )}
                      <span>•</span>
                      <span>{c.principal_installments}x</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => onView(c)} className="h-8 w-8 text-slate-400 hover:text-blue-600" title="Visualizar">
                    <Eye className="w-4 h-4" />
                  </Button>
                  {c.status === "rascunho" && onEdit && (
                    <Button variant="ghost" size="icon" onClick={() => onEdit(c)} className="h-8 w-8 text-slate-400 hover:text-amber-600" title="Editar">
                      <Edit className="w-4 h-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => onDuplicate(c)} className="h-8 w-8 text-slate-400 hover:text-purple-600" title="Duplicar">
                    <Copy className="w-4 h-4" />
                  </Button>
                  {["rascunho", "cancelado"].includes(c.status) && onDelete && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => {
                        if (window.confirm("⚠️ Tem certeza que deseja excluir este contrato?\n\nEsta ação não poderá ser desfeita.")) {
                          onDelete(c.id);
                        }
                      }} 
                      className="h-8 w-8 text-slate-400 hover:text-red-500" 
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}