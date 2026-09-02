import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, Edit2, Users, Building, Tags, BookOpen, Wallet } from "lucide-react";

const CLASS_LABELS = {
  ativo: "Ativo",
  passivo: "Passivo",
  receita: "Receita",
  despesa: "Despesa",
  patrimonio_liquido: "Patrimônio líquido",
};

const BANK_TYPE_LABELS = {
  privado: "Privado",
  publico: "Público",
  estrangeiro: "Estrangeiro",
};

function StatusBadge({ status }) {
  const active = status === "ativo" || status === "ativa";
  return (
    <Badge className={`text-xs border ${
      active
        ? "bg-green-100 text-green-800 border-green-200"
        : "bg-slate-100 text-slate-600 border-slate-200"
    }`}>
      {status || "—"}
    </Badge>
  );
}

function dash(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function columnsFor(type) {
  if (type === "group") {
    return ["Nome", "CNPJ", "Descrição", "Status", "Ações"];
  }
  if (type === "entity") {
    return ["Nome", "Empresa/Filial", "Documento", "Tipo", "Status", "Ações"];
  }
  if (type === "bank") {
    return ["Código", "Nome", "Tipo", "Status", "Ações"];
  }
  if (type === "bankAccount") {
    return ["Entidade", "Banco", "Agência", "Conta", "Nome", "Origem", "Status", "Ações"];
  }
  if (type === "nature") {
    return ["Entidade", "Código", "Descrição", "Tipo", "Receita/Despesa", "LCDPR", "Origem", "Status", "Ações"];
  }
  if (type === "chart") {
    return ["Código", "Nome", "Classe", "Tipo", "Natureza", "Origem", "Status", "Ações"];
  }
  return ["Registro", "Ações"];
}

function Actions({ item, onEdit, onDelete, onRelated, relatedTitle }) {
  return (
    <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      {onRelated ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRelated(item)}
          title={relatedTitle || "Contas"}
          className="h-8 w-8 text-slate-400 hover:text-violet-600"
        >
          <Wallet className="w-3.5 h-3.5" />
        </Button>
      ) : null}
      <Button variant="ghost" size="icon" onClick={() => onEdit(item)} className="h-8 w-8 text-slate-400 hover:text-blue-600">
        <Edit2 className="w-3.5 h-3.5" />
      </Button>
      {onDelete ? (
        <Button variant="ghost" size="icon" onClick={() => onDelete(item.id)} className="h-8 w-8 text-slate-400 hover:text-red-500">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function Cells({ item, type, onEdit, onDelete, onRelated, relatedTitle }) {
  if (type === "group") {
    return (
      <>
        <TableCell className="font-medium text-slate-800">{dash(item.group_name)}</TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap">{dash(item.cnpj_group)}</TableCell>
        <TableCell className="text-slate-500 max-w-xs truncate">{dash(item.description)}</TableCell>
        <TableCell><StatusBadge status={item.status} /></TableCell>
        <TableCell className="text-right"><Actions item={item} onEdit={onEdit} onDelete={onDelete} onRelated={onRelated} relatedTitle={relatedTitle} /></TableCell>
      </>
    );
  }
  if (type === "entity") {
    return (
      <>
        <TableCell className="font-medium text-slate-800">{dash(item.entity_name)}</TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap">
          {item.codigo_empresa || item.codigo_filial
            ? `${dash(item.codigo_empresa)} / ${dash(item.codigo_filial)}`
            : "—"}
        </TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap">
          {item.document_type ? `${item.document_type} ${item.document_number || ""}`.trim() : dash(item.document_number)}
        </TableCell>
        <TableCell>{item.entity_type === "pf" ? "PF" : "PJ"}</TableCell>
        <TableCell><StatusBadge status={item.status} /></TableCell>
        <TableCell className="text-right"><Actions item={item} onEdit={onEdit} onDelete={onDelete} /></TableCell>
      </>
    );
  }
  if (type === "bank") {
    return (
      <>
        <TableCell className="font-mono text-xs whitespace-nowrap">{dash(item.bank_code)}</TableCell>
        <TableCell className="font-medium text-slate-800">{dash(item.bank_name)}</TableCell>
        <TableCell>{BANK_TYPE_LABELS[item.bank_type] || dash(item.bank_type)}</TableCell>
        <TableCell><StatusBadge status={item.status} /></TableCell>
        <TableCell className="text-right"><Actions item={item} onEdit={onEdit} onDelete={onDelete} onRelated={onRelated} relatedTitle={relatedTitle} /></TableCell>
      </>
    );
  }
  if (type === "bankAccount") {
    const conta = item.digito ? `${dash(item.conta)}-${item.digito}` : dash(item.conta);
    return (
      <>
        <TableCell className="min-w-[180px]">
          <div className="font-medium text-slate-800">{dash(item.entity_name)}</div>
          <div className="font-mono text-[11px] text-slate-400">{dash(item.empresa)}</div>
        </TableCell>
        <TableCell className="min-w-[160px]">
          <div className="font-medium text-slate-800">{dash(item.bank_name)}</div>
          <div className="font-mono text-[11px] text-slate-400">{dash(item.bank_code)}</div>
        </TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap">{dash(item.agencia)}</TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap">{conta}</TableCell>
        <TableCell className="font-medium text-slate-800 min-w-[180px]">{dash(item.nome)}</TableCell>
        <TableCell className="whitespace-nowrap">{item.origem === "integrado" ? "Integrada" : "Manual"}</TableCell>
        <TableCell><StatusBadge status={item.status} /></TableCell>
        <TableCell className="text-right"><Actions item={item} onEdit={onEdit} onDelete={onDelete} /></TableCell>
      </>
    );
  }
  if (type === "nature") {
    return (
      <>
        <TableCell className="min-w-[180px]">
          <div className="font-medium text-slate-800">{dash(item.entity_name)}</div>
          <div className="font-mono text-[11px] text-slate-400">{dash(item.empresa)}</div>
        </TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap">{dash(item.codigo)}</TableCell>
        <TableCell className="font-medium text-slate-800 min-w-[220px]">{dash(item.descricao)}</TableCell>
        <TableCell className="whitespace-nowrap">
          {item.tipo_natureza === "sintetica" ? "Sintética" : "Analítica"}
        </TableCell>
        <TableCell className="whitespace-nowrap">{dash(item.tipo_conta)}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-xs ${item.gera_lcdpr ? "border-sky-200 bg-sky-50 text-sky-800" : ""}`}>
            {item.gera_lcdpr ? "Sim" : "Não"}
          </Badge>
        </TableCell>
        <TableCell className="whitespace-nowrap">{item.origem === "integrado" ? "Integrada" : "Manual"}</TableCell>
        <TableCell><StatusBadge status={item.status} /></TableCell>
        <TableCell className="text-right"><Actions item={item} onEdit={onEdit} onDelete={onDelete} /></TableCell>
      </>
    );
  }
  if (type === "chart") {
    return (
      <>
        <TableCell className="font-mono text-xs whitespace-nowrap">{dash(item.account_code)}</TableCell>
        <TableCell className="font-medium text-slate-800">{dash(item.account_name)}</TableCell>
        <TableCell className="whitespace-nowrap">{CLASS_LABELS[item.account_class] || dash(item.account_class)}</TableCell>
        <TableCell className="whitespace-nowrap">{item.account_type === "sintetica" ? "Sintética" : "Analítica"}</TableCell>
        <TableCell className="whitespace-nowrap">{item.account_nature === "credora" ? "Credora" : "Devedora"}</TableCell>
        <TableCell className="whitespace-nowrap">{item.origem === "integrado" ? "Integrada" : "Manual"}</TableCell>
        <TableCell><StatusBadge status={item.status} /></TableCell>
        <TableCell className="text-right"><Actions item={item} onEdit={onEdit} onDelete={onDelete} /></TableCell>
      </>
    );
  }
  return (
    <>
      <TableCell>{item.id}</TableCell>
      <TableCell className="text-right"><Actions item={item} onEdit={onEdit} onDelete={onDelete} /></TableCell>
    </>
  );
}

export default function GovernanceList({ items, type, onEdit, onDelete, onSelect, selectedId, onRelated, relatedTitle }) {
  const EmptyIcon = type === "group" ? Building : type === "nature" ? Tags : type === "chart" ? BookOpen : type === "bankAccount" ? Wallet : Users;
  const columns = columnsFor(type);

  if (!items || items.length === 0) {
    return (
      <Card className="border-slate-200 border-dashed">
        <CardContent className="p-12 text-center">
          <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <EmptyIcon className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-500">Nenhum registro</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            {columns.map((column) => (
              <TableHead
                key={column}
                className={`text-xs uppercase tracking-wider text-slate-500 ${column === "Ações" ? "text-right" : ""}`}
              >
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              className={`${onSelect ? "cursor-pointer" : ""} ${selectedId && selectedId === item.id ? "bg-violet-50 hover:bg-violet-50" : ""}`}
              onClick={() => onSelect?.(item)}
            >
              <Cells item={item} type={type} onEdit={onEdit} onDelete={onDelete} onRelated={onRelated} relatedTitle={relatedTitle} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
