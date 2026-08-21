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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileText, Trash2, Copy, ChevronRight, MoreHorizontal, Download, Mail } from "lucide-react";
import { useSortableRows, SortableHead, SORT_HEAD_CLASS, SORT_CELL_CLASS, SORT_CELL_CLASS_RIGHT } from "@/components/ui/sortable-table";
import { statusLabel, statusBadgeClass, EDITABLE_STATUSES } from "@/lib/contractStatus";
import { combineGuaranteeLabel, operationCategoryLabel } from "@/lib/contractOptions";
import { computeContractCET } from "@/lib/cetFromSchedule";
import { sanitizeFilename, downloadRenamed } from "@/lib/documentActions";
import { getContractCirculanteSplit } from "../accounting/debtAnalytics";
import EmailDialog from "../shared/EmailDialog";

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

// Parseia o cronograma salvo e deriva, a partir dele, o CET Anual, o split
// Circulante/Não Circulante e os rótulos já resolvidos (Grupo/Entidade/Banco/
// Categoria/Garantia) — tudo o que a tabela precisa tanto pra exibir quanto
// pra ordenar por coluna, calculado uma única vez por linha.
function deriveRow(contract, today, groups, entities, banks) {
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
  return {
    cet,
    shortTerm,
    longTerm,
    groupName: groups?.find((g) => g.id === contract.group_id)?.group_name || "—",
    entityName: entities?.find((e) => e.id === contract.entity_id)?.entity_name || "—",
    bankName: banks?.find((b) => b.id === contract.bank_id)?.bank_name || "—",
    categoryLabel: operationCategoryLabel(contract.operation_category),
    guaranteeLabel: combineGuaranteeLabel(contract.guarantee_real_type, contract.guarantee_personal_type),
  };
}

// Colunas ordenáveis por clique no título — cada uma aponta pra um campo já
// resolvido em `rows` (ver deriveRow acima). `numeric: true` ordena como
// número em vez de string.
const SORTABLE_COLUMNS = {
  groupName: {},
  entityName: {},
  bankName: {},
  contract_number: { getValue: (row) => row.contract.contract_number },
  categoryLabel: {},
  guaranteeLabel: {},
  operation_value: { numeric: true, getValue: (row) => row.contract.operation_value },
  fixed_rate: { numeric: true, getValue: (row) => row.contract.fixed_rate },
  cet: { numeric: true },
  shortTerm: { numeric: true },
  longTerm: { numeric: true },
  status: { getValue: (row) => row.contract.status },
};

export default function ContractsList({ contracts, banks, groups, entities, onView, onEdit, onDelete, onDuplicate, isLoading }) {
  const today = React.useMemo(() => new Date().toISOString().split("T")[0], []);
  const [emailTarget, setEmailTarget] = React.useState(null);

  // Deriva CET, Circulante/Não Circulante e os rótulos uma vez por lista (não
  // a cada re-render) — envolve reprocessar o cronograma inteiro de cada
  // contrato.
  const rows = React.useMemo(() => {
    return (contracts || []).map((c) => ({ contract: c, ...deriveRow(c, today, groups, entities, banks) }));
  }, [contracts, today, groups, entities, banks]);

  // Ordenação por coluna (clique no título alterna asc → desc → sem
  // ordenação) — mesma configuração usada em toda a ferramenta, ver
  // src/components/ui/sortable-table.jsx.
  const { sortKey, sortDir, toggleSort, sortedRows } = useSortableRows(rows, SORTABLE_COLUMNS);

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
  // Classes e componente de título ordenável vêm de sortable-table.jsx —
  // mesma configuração visual em toda a ferramenta.
  const cellClass = SORT_CELL_CLASS;
  const cellClassRight = SORT_CELL_CLASS_RIGHT;

  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead sortField="groupName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Grupo Econômico</SortableHead>
              <SortableHead sortField="entityName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Entidade Componente</SortableHead>
              <SortableHead sortField="bankName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Banco</SortableHead>
              <SortableHead sortField="contract_number" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Nº Contrato</SortableHead>
              <SortableHead sortField="categoryLabel" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Categoria da Operação</SortableHead>
              <SortableHead sortField="guaranteeLabel" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Garantia</SortableHead>
              <SortableHead sortField="operation_value" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right>Valor da Operação</SortableHead>
              <SortableHead sortField="fixed_rate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right>Juros a.a.</SortableHead>
              <SortableHead sortField="cet" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right>CET a.a.</SortableHead>
              <SortableHead sortField="shortTerm" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right>Circulante</SortableHead>
              <SortableHead sortField="longTerm" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right>Não Circulante</SortableHead>
              <SortableHead sortField="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Status</SortableHead>
              <TableHead className={SORT_HEAD_CLASS} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map(({ contract: c, cet, shortTerm, longTerm, groupName, entityName, bankName, categoryLabel, guaranteeLabel }) => {
              const isEditable = EDITABLE_STATUSES.includes(c.status || "rascunho");
              const hasPdf = !!c.contract_pdf_url;
              // Clicar na linha sempre "dá andamento" no contrato: rascunho/devolvido
              // abrem na Calculadora para continuar editando; pendente/aprovado abrem
              // a tela de revisão (com os botões de Aprovar/Devolver, se aplicável).
              const openContract = () => (isEditable ? onEdit(c) : onView(c));
              const handleDownload = () => {
                const filename = `${sanitizeFilename(bankName)}_${sanitizeFilename(c.contract_number)}.pdf`;
                downloadRenamed(c.contract_pdf_url, filename);
              };
              const openEmailDialog = () => {
                setEmailTarget({
                  documentType: "contract_pdf",
                  id: c.id,
                  label: `Contrato — ${bankName} nº ${c.contract_number}`,
                });
              };

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
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                            Ações <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {hasPdf && (
                            <DropdownMenuItem onClick={handleDownload}>
                              <Download className="w-3.5 h-3.5 mr-2" />
                              Baixar
                            </DropdownMenuItem>
                          )}
                          {hasPdf && (
                            <DropdownMenuItem onClick={openEmailDialog}>
                              <Mail className="w-3.5 h-3.5 mr-2" />
                              Enviar por e-mail
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => onDuplicate(c)}>
                            <Copy className="w-3.5 h-3.5 mr-2" />
                            Duplicar
                          </DropdownMenuItem>
                          {isEditable && onDelete && (
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => {
                                if (window.confirm("⚠️ Tem certeza que deseja excluir este contrato?\n\nEsta ação não poderá ser desfeita.")) {
                                  onDelete(c.id);
                                }
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <EmailDialog open={!!emailTarget} onOpenChange={(open) => !open && setEmailTarget(null)} document={emailTarget} />
    </Card>
  );
}
