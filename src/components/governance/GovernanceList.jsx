import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Edit2, Users, Building } from "lucide-react";

export default function GovernanceList({ items, type, onEdit, onDelete }) {
  const isGroup = type === "group";
  const isEntity = type === "entity";

  if (!items || items.length === 0) {
    return (
      <Card className="border-slate-200 border-dashed">
        <CardContent className="p-12 text-center">
          <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-3">
            {isGroup ? <Building className="w-6 h-6 text-slate-300" /> : <Users className="w-6 h-6 text-slate-300" />}
          </div>
          <p className="text-sm text-slate-500">Nenhum registro</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Card key={item.id} className="border-slate-200 hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {isGroup ? item.group_name : isEntity ? item.entity_name : item.bank_name}
                  </h3>
                  <Badge variant="outline" className="text-xs font-mono">
                    {isGroup && item.cnpj_group}
                    {isEntity && `${item.document_type}: ${item.document_number}`}
                    {!isGroup && !isEntity && item.bank_code}
                  </Badge>
                  <Badge className={`text-xs border ${
                    (item.status === "ativo" || item.status === "ativa")
                      ? "bg-green-100 text-green-800 border-green-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                  }`}>
                    {item.status}
                  </Badge>
                </div>
                {item.description && (
                  <p className="text-xs text-slate-500 mt-1">{item.description}</p>
                )}
                {isEntity && (
                  <p className="text-xs text-slate-500 mt-1">
                    Tipo: <span className="font-medium">{item.entity_type === "pf" ? "PF" : "PJ"}</span>
                  </p>
                )}
                {!isGroup && !isEntity && item.bank_type && (
                  <p className="text-xs text-slate-500 mt-1">
                    Tipo: <span className="font-medium capitalize">{item.bank_type}</span>
                  </p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0 ml-2">
                <Button variant="ghost" size="icon" onClick={() => onEdit(item)} className="h-8 w-8 text-slate-400 hover:text-blue-600">
                  <Edit2 className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => onDelete(item.id)} className="h-8 w-8 text-slate-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}