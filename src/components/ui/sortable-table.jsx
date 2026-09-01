import React from "react";
import { TableHead } from "@/components/ui/table";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

// Configuração visual e de comportamento ÚNICA pra reordenação de tabelas em
// toda a ferramenta — extraída da tabela de Contratos (ContractsList.jsx),
// que foi a primeira a ganhar esse recurso. Toda tabela (nova ou já
// existente) deve importar daqui em vez de reimplementar, pra garantir que
// "clicar no título ordena" sempre se comporta e parece exatamente igual em
// todo lugar.
export const SORT_HEAD_CLASS =
  "text-[11px] font-bold text-slate-700 uppercase tracking-wide whitespace-nowrap px-2 py-2 bg-slate-50 border-b-2 border-slate-200";
export const SORT_CELL_CLASS = "whitespace-nowrap px-2 py-1.5 text-[11px] text-slate-700";
export const SORT_CELL_CLASS_RIGHT = `${SORT_CELL_CLASS} text-right`;

export function SortIcon({ active, dir }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 ml-1 inline-block text-slate-500" />;
  return dir === "asc" ? (
    <ArrowUp className="w-3 h-3 ml-1 inline-block text-slate-700" />
  ) : (
    <ArrowDown className="w-3 h-3 ml-1 inline-block text-slate-700" />
  );
}

// Ordenação por clique no título — clique alterna asc → desc → sem
// ordenação (volta à ordem original de `rows`). `columns` mapeia cada chave
// ordenável pra { numeric?: boolean, getValue?: (row) => any }; sem
// `getValue`, lê `row[key]` direto.
export function useSortableRows(rows, columns) {
  const [sortKey, setSortKey] = React.useState(null);
  const [sortDir, setSortDir] = React.useState("asc");

  const toggleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  };

  const sortedRows = React.useMemo(() => {
    const list = rows || [];
    if (!sortKey) return list;
    const config = columns?.[sortKey] || {};
    const getValue = config.getValue || ((row) => row[sortKey]);
    const sorted = [...list].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (config.numeric) {
        return (Number(va) || 0) - (Number(vb) || 0);
      }
      return String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR");
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [rows, sortKey, sortDir, columns]);

  return { sortKey, sortDir, toggleSort, sortedRows };
}

// Título de coluna clicável pra tabelas que usam os componentes <Table> do
// shadcn — usar no lugar de <TableHead>. Sem `sortField`, a coluna não é
// ordenável (ex.: última coluna, de ações).
export function SortableHead({ sortField, sortKey, sortDir, onSort, right, className = "", children }) {
  return (
    <TableHead
      className={`${SORT_HEAD_CLASS}${right ? " text-right" : ""}${
        sortField ? " cursor-pointer select-none hover:bg-slate-100" : ""
      } ${className}`}
      onClick={sortField ? () => onSort(sortField) : undefined}
    >
      {children}
      {sortField && <SortIcon active={sortKey === sortField} dir={sortDir} />}
    </TableHead>
  );
}

// Mesmo título de coluna clicável, mas pra tabelas com <table>/<th> nativo
// (telas de Contas a Pagar/Receber, Fechamento Contábil etc., que não usam
// os componentes <Table> do shadcn). Visual e comportamento idênticos ao
// SortableHead acima.
export function SortableTh({ sortField, sortKey, sortDir, onSort, right, className = "", children }) {
  return (
    <th
      className={`${SORT_HEAD_CLASS}${right ? " text-right" : ""}${
        sortField ? " cursor-pointer select-none hover:bg-slate-100" : ""
      } ${className}`}
      onClick={sortField ? () => onSort(sortField) : undefined}
    >
      {children}
      {sortField && <SortIcon active={sortKey === sortField} dir={sortDir} />}
    </th>
  );
}
