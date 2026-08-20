import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Trash2, Copy, ChevronRight } from "lucide-react";
import { statusLabel, statusBadgeClass, EDITABLE_STATUSES } from "@/lib/contractStatus";
import { combineGuaranteeLabel, operationCategoryLabel } from "@/lib/contractOptions";
import { computeContractCET } from "@/lib/cetFromSchedule";
import { getContractCirculanteSplit } from "../accounting/debtAnalytics";

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(n);
}

function formatPercent(value, maxDigits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: maxDigits })}%`;
}

// "Juros a.a.": taxa fixa quando prefixado (indexer N/A ou vazio), ou
// indexador + spread quando a operação é pós-fixada — mesma regra usada no
// cabeçalho da tela de revisão do contrato (Contracts.jsx).
function jurosLabel(contract) {
  if (!contract.indexer || contract.indexer === "NA") {
    return `${formatPercent(contract.fixed_rate)} a.a.`;
  }
  return `${contract.indexer} + ${formatPercent(contract.indexer_spread)} a.a.`;
}

// Parseia o cronograma salvo e deriva, a partir dele, o CET Anual e o split
// Circulante/Não Circulante (saldo de principal a vencer em até/acima de 12
// meses a partir de hoje) — os três únicos valores da tabela que não vêm
// direto dos campos do contrato.
function deriveRow(contract, today) {
  let schedule = [];
  if (contract.schedule_data) {
    try {
      const parsed = JSON.parse(contract.schedule_data);
      schedule = parsed.schedule || [];
    } catch {
      schedule = [];
    }
  }
  const { cet } = computeContractCET(contract, schedule);
  const { shortTerm, longTerm } = getContractCirculanteSplit(contract, today);
  return { cet, shortTerm, longTerm };
}

export default function ContractsList({ contracts, banks, groups, entities, onView, onEdit, onDelete, onDuplicate, isLoading }) {
  const today = React.useMemo(() => new Date().toISOString().split("T")[0], []);

  // Deriva CET e Circulante/Não Circulante uma vez por lista (não a cada
  // re-render) — envolve reprocessar o cronograma inteiro de cada contrato.
  const rows = React.useMemo(() => {
    return (contracts || []).map((c) => ({ contract: c, ...deriveRow(c, today) }));
  }, [contracts, today]);

  if (isLoading) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
          ))}
        </CardContent>
      </Card>
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

  // Cabeçalho e células em uma linha só (sem quebra de texto) — a tabela é
  // larga de propósito; ela rola horizontalmente só em telas realmente
  // estreitas, em vez de forçar rótulos e valores a quebrar em 2 linhas.
  const headClass = "text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap px-4 py-3";
  // Uma única classe de célula para TODOS os campos — mesma fonte (sans, sem
  //), mesmo tamanho e mesma cor, em vez de misturar nos
  // números com a fonte padrão no texto (o que dava a sensação de fontes
  // diferentes lado a lado). Alinhamento à direita continua só um detalhe de
  // layout (cellClassRight), não muda fonte/cor.
  const cellClass = "whitespace-nowrap px-4 py-3.5 text-sm text-slate-700";
  const cellClassRight = `${cellClass} text-right`;

  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={headClass}>Grupo Econômico</TableHead>
              <TableHead className={headClass}>Entidade Componente</TableHead>
              <TableHead className={headClass}>Banco</TableHead>
              <TableHead className={headClass}>Nº Contrato</TableHead>
              <TableHead className={headClass}>Categoria da Operação</TableHead>
              <TableHead className={headClass}>Garantia</TableHead>
              <TableHead className={`${headClass} text-right`}>Valor da Operação</TableHead>
              <TableHead className={`${headClass} text-right`}>Juros a.a.</TableHead>
              <TableHead className={`${headClass} text-right`}>CET a.a.</TableHead>
              <TableHead className={`${headClass} text-right`}>Circulante</TableHead>
              <TableHead className={`${headClass} text-right`}>Não Circulante</TableHead>
              <TableHead className={headClass}>Status</TableHead>
              <TableHead className={`${headClass} w-20`} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ contract: c, cet, shortTerm, longTerm }) => {
              const groupName = groups?.find((g) => g.id === c.group_id)?.group_name || "—";
              const entityName = entities?.find((e) => e.id === c.entity_id)?.entity_name || "—";
              const bankName = banks?.find((b) => b.id === c.bank_id)?.bank_name || "—";
              const categoryLabel = operationCategoryLabel(c.operation_category);
              const guaranteeLabel = combineGuaranteeLabel(c.guarantee_real_type, c.guarantee_personal_type);
              const isEditable = EDITABLE_STATUSES.includes(c.status || "rascunho");
              // Clicar na linha sempre "dá andamento" no contrato: rascunho/devolvido
              // abrem na Calculadora para continuar editando; pendente/aprovado abrem
              // a tela de revisão (com os botões de Aprovar/Devolver, se aplicável).
              const openContract = () => (isEditable ? onEdit(c) : onView(c));

              return (
                <TableRow
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={openContract}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openContract();
                    }
                  }}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <TableCell className={cellClass}>{groupName}</TableCell>
                  <TableCell className={cellClass}>{entityName}</TableCell>
                  <TableCell className={cellClass}>{bankName}</TableCell>
                  <TableCell className={cellClass}>{c.contract_number}</TableCell>
                  <TableCell className={cellClass}>{categoryLabel}</TableCell>
                  <TableCell className={cellClass}>{guaranteeLabel}</TableCell>
                  <TableCell className={cellClassRight}>{formatCurrency(c.operation_value)}</TableCell>
                  <TableCell className={cellClassRight}>{jurosLabel(c)}</TableCell>
                  <TableCell className={cellClassRight}>{formatPercent(cet, 2)}</TableCell>
                  <TableCell className={cellClassRight}>{formatCurrency(shortTerm)}</TableCell>
                  <TableCell className={cellClassRight}>{formatCurrency(longTerm)}</TableCell>
                  <TableCell className={cellClass}>
                    <Badge className={`text-[10px] border ${statusBadgeClass(c.status)}`}>
                      {statusLabel(c.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className={cellClass}>
                    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDuplicate(c)}
                        className="h-8 w-8 text-slate-400 hover:text-purple-600"
                        title="Duplicar"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      {isEditable && onDelete && (
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
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
