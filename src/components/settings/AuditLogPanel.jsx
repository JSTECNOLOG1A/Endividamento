import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "@/lib/notify";
import { auditApi } from "@/api/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SORT_HEAD_CLASS } from "@/components/ui/sortable-table";

const PAGE_SIZE = 50;

const PROCESSING_LABELS = {
  manual: "Manual",
  automatico: "Automático",
  autenticacao: "Autenticação",
  processamento: "Processamento",
};

const ACTION_BADGE = {
  CREATE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  BULK_CREATE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  UPDATE: "border-amber-200 bg-amber-50 text-amber-800",
  STATUS: "border-amber-200 bg-amber-50 text-amber-800",
  DELETE: "border-rose-200 bg-rose-50 text-rose-800",
  LOGIN: "border-sky-200 bg-sky-50 text-sky-800",
  LOGOUT: "border-slate-200 bg-slate-50 text-slate-700",
};

const FIELD_LABELS = {
  status: "Status",
  nome: "Nome",
  ativo: "Ativo",
  email: "E-mail",
  full_name: "Nome",
  role: "Perfil",
  tarefa: "Tarefa",
  tarefaLabel: "Tarefa",
  intervaloMinutos: "Intervalo (min)",
  diaMes: "Dia do mês",
  horaExecucao: "Hora",
  modo: "Modo",
  codigo: "Código",
  code: "Código",
  descricao: "Descrição",
  baseUrl: "URL REST",
  authType: "Autenticação",
  username: "Usuário",
  entity_name: "Entidade",
  group_name: "Grupo",
  contract_number: "Contrato",
  titulo_numero: "Título",
  prefixo: "Prefixo",
  parcela: "Parcela",
  tipo: "Tipo",
  valor: "Valor",
  due_date: "Vencimento",
  message: "Mensagem",
  ok: "Resultado",
};

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fieldLabel(campo) {
  return FIELD_LABELS[campo] || campo;
}

function pretty(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function affectedRecords(row) {
  const lists = [row?.after?.titulos, row?.after?.results, row?.payload?.titulos];
  for (const list of lists) {
    if (Array.isArray(list) && list.length && typeof list[0] === "object") return list;
  }
  return [];
}

function emptyFilters() {
  return {
    from: "",
    to: "",
    actor: "todos",
    action: "todas",
    rotina: "todas",
    processingType: "todos",
    q: "",
  };
}

export default function AuditLogPanel() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);
  const [draftQ, setDraftQ] = useState("");
  const [meta, setMeta] = useState({ actors: [], actions: [], rotinas: [], processingTypes: [] });
  const [selected, setSelected] = useState(null);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await auditApi.meta());
    } catch {
      setMeta({ actors: [], actions: [], rotinas: [], processingTypes: [] });
    }
  }, []);

  const load = useCallback(async (nextOffset = 0) => {
    setLoading(true);
    try {
      const result = await auditApi.list({
        ...filters,
        q: draftQ,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setItems(Array.isArray(result.items) ? result.items : []);
      setTotal(Number(result.total) || 0);
      setOffset(nextOffset);
    } catch (error) {
      toast.error(error.message || "Não foi possível carregar o log");
    } finally {
      setLoading(false);
    }
  }, [filters, draftQ]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const actionOptions = useMemo(() => {
    const known = [
      ["CREATE", "Inclusão"],
      ["UPDATE", "Alteração"],
      ["DELETE", "Exclusão"],
      ["BULK_CREATE", "Inclusão em lote"],
      ["STATUS", "Alteração de status"],
      ["RUN", "Execução"],
      ["INTEGRATE", "Integração"],
      ["REVERSE", "Estorno"],
      ["CLASSIFY", "Classificação"],
      ["CONSULT", "Consulta"],
      ["LOGIN", "Login"],
      ["LOGOUT", "Logout"],
      ["CALCULATE", "Cálculo"],
    ];
    const extra = (meta.actions || []).filter((action) => !known.some(([value]) => value === action));
    return [...known, ...extra.map((action) => [action, action])];
  }, [meta.actions]);

  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>De</Label>
          <Input type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Até</Label>
          <Input type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Usuário</Label>
          <Select value={filters.actor} onValueChange={(value) => setFilter("actor", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(meta.actors || []).map((actor) => (
                <SelectItem key={actor} value={actor}>{actor}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Tipo de processamento</Label>
          <Select value={filters.processingType} onValueChange={(value) => setFilter("processingType", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {["manual", "automatico", "processamento", "autenticacao"].map((type) => (
                <SelectItem key={type} value={type}>{PROCESSING_LABELS[type]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Ação</Label>
          <Select value={filters.action} onValueChange={(value) => setFilter("action", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {actionOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Rotina</Label>
          <Select value={filters.rotina} onValueChange={(value) => setFilter("rotina", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {(meta.rotinas || []).map((rotina) => (
                <SelectItem key={rotina} value={rotina}>{rotina}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Registro</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              className="pl-8"
              placeholder="Buscar por registro, usuário ou rotina"
              value={draftQ}
              onChange={(event) => setDraftQ(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-600">
          {total === 1 ? "1 evento" : `${total} eventos`} · clique na linha para ver o de/para completo
        </p>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => { loadMeta(); load(offset); }} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={SORT_HEAD_CLASS}>Data/hora</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Usuário</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Tipo</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Rotina</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Registro</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Ação</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>De</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Para</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !items.length ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-slate-600">Carregando log…</TableCell>
              </TableRow>
            ) : null}
            {!loading && !items.length ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-slate-600">
                  Nenhum evento encontrado para os filtros informados.
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => setSelected(row)}
              >
                <TableCell className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(row.occurredAt)}</TableCell>
                <TableCell>
                  <div className="text-sm text-slate-900">{row.userName || row.user}</div>
                  {row.userName ? <div className="text-[11px] text-slate-600">{row.user}</div> : null}
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  {PROCESSING_LABELS[row.processingType] || row.processingType}
                </TableCell>
                <TableCell className="text-sm">{row.rotina}</TableCell>
                <TableCell className="max-w-[180px] truncate text-sm" title={row.registro}>{row.registro}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={ACTION_BADGE[row.action] || "border-slate-200 bg-slate-50 text-slate-700"}>
                    {row.actionLabel}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-[11px] text-slate-600" title={row.de}>{row.de}</TableCell>
                <TableCell className="max-w-[160px] truncate text-[11px] text-slate-600" title={row.para}>{row.para}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>
          Anterior
        </Button>
        <span className="text-xs text-slate-600">Página {page} de {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => load(offset + PAGE_SIZE)}>
          Próxima
        </Button>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhe do log</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.actionLabel} em ${selected.rotina} · ${formatDateTime(selected.occurredAt)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <Detail label="Usuário" value={selected.userName ? `${selected.userName} (${selected.user})` : selected.user} />
                <Detail label="Tipo de processamento" value={PROCESSING_LABELS[selected.processingType] || selected.processingType} />
                <Detail label="Rotina" value={selected.rotina} />
                <Detail label="Registro" value={selected.registro} />
                <Detail label="Ação" value={selected.actionLabel} />
                <Detail label="IP" value={selected.ipAddress || "—"} />
              </div>

              {affectedRecords(selected).length ? (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">Registros afetados</p>
                  <div className="rounded-md border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className={SORT_HEAD_CLASS}>Título</TableHead>
                          <TableHead className={SORT_HEAD_CLASS}>Tipo</TableHead>
                          <TableHead className={SORT_HEAD_CLASS}>Resultado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {affectedRecords(selected).map((item, index) => (
                          <TableRow key={item.id || index}>
                            <TableCell className="font-medium">
                              {item.label || [item.prefixo, item.numero || item.titulo_numero, item.parcela].filter(Boolean).join(" ") || item.id || "—"}
                            </TableCell>
                            <TableCell>{item.tipo || "—"}</TableCell>
                            <TableCell className="text-xs text-slate-600">
                              {item.message || (item.ok == null ? "—" : item.ok ? "Ok" : "Erro")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}

              {selected.changes?.length ? (
                <div className="rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className={SORT_HEAD_CLASS}>Campo</TableHead>
                        <TableHead className={SORT_HEAD_CLASS}>De</TableHead>
                        <TableHead className={SORT_HEAD_CLASS}>Para</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selected.changes.map((change) => (
                        <TableRow key={change.campo}>
                          <TableCell className="font-medium">{fieldLabel(change.campo)}</TableCell>
                          <TableCell className="whitespace-pre-wrap text-[11px] text-slate-600">{change.de}</TableCell>
                          <TableCell className="whitespace-pre-wrap text-[11px] text-slate-600">{change.para}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : !affectedRecords(selected).length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-600">De</p>
                    <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-3 text-[11px] text-slate-700">
                      {pretty(selected.before)}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-600">Para</p>
                    <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-3 text-[11px] text-slate-700">
                      {pretty(selected.after)}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-600">{label}</p>
      <p className="font-medium text-slate-900">{value || "—"}</p>
    </div>
  );
}
