import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Play, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { useProcessing } from "@/lib/ProcessingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSortableRows, SortableHead } from "@/components/ui/sortable-table";
import {
  DAY_OPTIONS,
  INTERVAL_OPTIONS,
  formFromCatalogTask,
  payloadFromCatalogTask,
  scheduleLabel,
  schedulesApi,
} from "@/api/schedules";

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
  });
}

function selectedTask(tasks, key) {
  return tasks.find((item) => item.key === key) || null;
}

// Colunas ordenáveis por clique no título (mesma configuração da tabela de
// Contratos) — cada linha é { task, job }, por isso usam getValue em vez de
// ler `row[key]` direto.
const SCHEDULE_SORT_COLUMNS = {
  taskLabel: { getValue: (row) => row.task.label },
  jobNome: { getValue: (row) => row.job?.nome || "" },
  repeticao: { getValue: (row) => (row.job ? scheduleLabel(row.job) : "") },
  status: {
    getValue: (row) => (row.job ? (row.job.executando ? "Executando" : row.job.ativo ? "Ativo" : "Pausado") : "Pendente"),
  },
  ultimaExecucaoEm: {
    numeric: true,
    getValue: (row) => (row.job?.ultimaExecucaoEm ? new Date(row.job.ultimaExecucaoEm).getTime() : 0),
  },
  proximaExecucaoEm: {
    numeric: true,
    getValue: (row) => (row.job?.ativo && row.job?.proximaExecucaoEm ? new Date(row.job.proximaExecucaoEm).getTime() : 0),
  },
};

export default function SchedulesPanel() {
  const { withProcessing } = useProcessing();
  const [items, setItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingMissing, setCreatingMissing] = useState(false);
  const [runningId, setRunningId] = useState("");
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobs, catalog] = await Promise.all([schedulesApi.list(), schedulesApi.tasks()]);
      setItems(Array.isArray(jobs) ? jobs : []);
      setTasks(Array.isArray(catalog) ? catalog : []);
    } catch (error) {
      toast.error(error.message || "Não foi possível carregar os agendamentos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const jobByTask = useMemo(() => {
    const map = new Map();
    for (const job of items) map.set(job.tarefa, job);
    return map;
  }, [items]);

  const rows = useMemo(
    () => tasks.map((task) => ({ task, job: jobByTask.get(task.key) || null })),
    [tasks, jobByTask]
  );
  const missingTasks = rows.filter((row) => !row.job).map((row) => row.task);
  // Ordenação por coluna (clique no título) — mesma configuração da tabela
  // de Contratos, ver src/components/ui/sortable-table.jsx.
  const { sortKey, sortDir, toggleSort, sortedRows } = useSortableRows(rows, SCHEDULE_SORT_COLUMNS);

  const openCreate = (task) => {
    const chosen = task || missingTasks[0] || tasks[0];
    if (!chosen) {
      toast.warning("Todas as tarefas já possuem agendamento");
      return;
    }
    const existing = jobByTask.get(chosen.key);
    if (existing) {
      openEdit(existing);
      return;
    }
    setEditor({ mode: "create", form: formFromCatalogTask(chosen) });
  };

  const openEdit = (item) => {
    setEditor({
      mode: "edit",
      id: item.id,
      form: {
        nome: item.nome,
        tarefa: item.tarefa,
        modo: item.modo || (item.diaMes ? "mensal" : "intervalo"),
        intervaloMinutos: item.intervaloMinutos,
        diaMes: item.diaMes || 1,
        horaExecucao: String(item.horaExecucao || "00:10").slice(0, 5),
        ativo: item.ativo,
      },
    });
  };

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const payload = {
        nome: editor.form.nome.trim(),
        tarefa: editor.form.tarefa,
        modo: editor.form.modo,
        intervaloMinutos: Number(editor.form.intervaloMinutos),
        diaMes: editor.form.modo === "mensal" ? Number(editor.form.diaMes) : null,
        horaExecucao: editor.form.modo === "mensal" ? editor.form.horaExecucao : null,
        ativo: editor.form.ativo,
      };
      if (editor.mode === "create") await schedulesApi.create(payload);
      else await schedulesApi.update(editor.id, payload);
      toast.success(editor.mode === "create" ? "Agendamento criado" : "Agendamento atualizado");
      setEditor(null);
      await load();
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  };

  const createMissing = async () => {
    if (!missingTasks.length) {
      toast.success("Todas as tarefas já estão agendadas");
      return;
    }
    setCreatingMissing(true);
    try {
      let created = 0;
      for (const task of missingTasks) {
        await schedulesApi.create(payloadFromCatalogTask(task));
        created += 1;
      }
      toast.success(
        created === 1 ? "Tarefa criada" : `${created} tarefas criadas`
      );
      await load();
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível criar as tarefas");
      await load();
    } finally {
      setCreatingMissing(false);
    }
  };

  const toggleStatus = async (item) => {
    try {
      await schedulesApi.updateStatus(item.id, !item.ativo);
      toast.success(item.ativo ? "Agendamento pausado" : "Agendamento ativado");
      await load();
    } catch (error) {
      toast.error(error.message || "Não foi possível alterar o status");
    }
  };

  const runNow = async (item) => {
    setRunningId(item.id);
    await withProcessing("Executando agendamento…", async () => {
      try {
        const result = await schedulesApi.run(item.id);
        if (result.ok) toast.success(result.message || "Tarefa executada");
        else toast.warning(result.message || "A tarefa terminou com alerta");
        await load();
      } catch (error) {
        toast.error(error.data?.error || error.message || "Não foi possível executar");
      } finally {
        setRunningId("");
      }
    });
  };

  const remove = async () => {
    if (!confirm) return;
    try {
      await schedulesApi.remove(confirm.id);
      toast.success("Agendamento excluído");
      setConfirm(null);
      await load();
    } catch (error) {
      toast.error(error.message || "Não foi possível excluir");
    }
  };

  const editorTask = editor ? selectedTask(tasks, editor.form.tarefa) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Escolha a tarefa, crie o agendamento e defina o dia ou o intervalo. A conversão PR→TX consulta o Protheus, estorna o PR e integra de novo como TX.
        </p>
        <div className="flex flex-wrap gap-2">
          {missingTasks.length > 0 && (
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={creatingMissing} onClick={createMissing}>
              <Plus className="w-3.5 h-3.5" />
              {creatingMissing ? "Criando..." : `Criar tarefas (${missingTasks.length})`}
            </Button>
          )}
          <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => openCreate()}>
            <Plus className="w-3.5 h-3.5" />
            Novo agendamento
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">Carregando agendamentos...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-600 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center">
          Nenhuma tarefa disponível.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead sortField="taskLabel" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Tarefa</SortableHead>
              <SortableHead sortField="jobNome" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Agendamento</SortableHead>
              <SortableHead sortField="repeticao" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Repetição</SortableHead>
              <SortableHead sortField="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Status</SortableHead>
              <SortableHead sortField="ultimaExecucaoEm" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Última execução</SortableHead>
              <SortableHead sortField="proximaExecucaoEm" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>Próxima</SortableHead>
              <SortableHead right>Ações</SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map(({ task, job }) => (
              <TableRow key={task.key} className="hover:bg-slate-50">
                <TableCell>
                  <div className="font-medium text-slate-900">{task.label}</div>
                  <div className="text-[11px] text-slate-500">{task.rotina}</div>
                  {task.descricao ? (
                    <div className="text-[11px] text-slate-600 mt-0.5 max-w-[280px]">{task.descricao}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm text-slate-700">
                  {job ? job.nome : <span className="text-slate-500">Não criada</span>}
                </TableCell>
                <TableCell className="text-sm text-slate-600">
                  {job ? scheduleLabel(job) : "—"}
                </TableCell>
                <TableCell>
                  {job ? (
                    <Badge variant={job.ativo ? "default" : "secondary"}>
                      {job.executando ? "Executando" : job.ativo ? "Ativo" : "Pausado"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Pendente</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {job ? (
                    <>
                      <div className="text-sm text-slate-700">{formatDateTime(job.ultimaExecucaoEm)}</div>
                      {job.ultimaMensagem ? (
                        <div
                          className={`text-[11px] max-w-[240px] truncate ${job.ultimaExecucaoOk ? "text-emerald-700" : "text-rose-700"}`}
                          title={job.ultimaMensagem}
                        >
                          {job.ultimaMensagem}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-sm text-slate-500">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-slate-600">
                  {job?.ativo ? formatDateTime(job.proximaExecucaoEm) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {job ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Executar agora"
                        disabled={Boolean(runningId)}
                        onClick={() => runNow(job)}
                      >
                        <Play className={`w-3.5 h-3.5 ${runningId === job.id ? "animate-pulse" : ""}`} />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Ativar ou pausar" onClick={() => toggleStatus(job)}>
                        <Power className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => openEdit(job)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600" title="Excluir" onClick={() => setConfirm(job)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => openCreate(task)}>
                      Criar agendamento
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={Boolean(editor)} onOpenChange={(open) => { if (!open && !saving) setEditor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor?.mode === "edit" ? "Editar agendamento" : "Novo agendamento"}</DialogTitle>
            <DialogDescription>
              Selecione a tarefa e o dia ou intervalo. Ela roda sozinha no servidor, mesmo com a tela fechada.
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Tarefa</Label>
                <Select
                  value={editor.form.tarefa}
                  onValueChange={(value) => {
                    const next = selectedTask(tasks, value);
                    const previous = selectedTask(tasks, editor.form.tarefa);
                    if (!next || next.key === editor.form.tarefa) return;
                    const existing = jobByTask.get(next.key);
                    if (existing) {
                      openEdit(existing);
                      return;
                    }
                    setEditor((current) => ({
                      ...current,
                      mode: current.mode,
                      id: current.id,
                      form: formFromCatalogTask(next, current.form, previous),
                    }));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tasks.map((task) => (
                      <SelectItem key={task.key} value={task.key}>
                        {task.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editorTask?.descricao ? (
                  <p className="text-xs text-slate-600">{editorTask.descricao}</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input
                  value={editor.form.nome}
                  onChange={(event) => setEditor((current) => ({
                    ...current,
                    form: { ...current.form, nome: event.target.value },
                  }))}
                  placeholder="Nome do agendamento"
                />
              </div>
              <div className="space-y-1">
                <Label>Quando executar</Label>
                <Select
                  value={editor.form.modo}
                  onValueChange={(value) => setEditor((current) => ({
                    ...current,
                    form: { ...current.form, modo: value },
                  }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="intervalo">Em intervalo fixo</SelectItem>
                    <SelectItem value="mensal">Todo mês, em um dia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editor.form.modo === "mensal" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Dia do mês</Label>
                    <Select
                      value={String(editor.form.diaMes || 1)}
                      onValueChange={(value) => setEditor((current) => ({
                        ...current,
                        form: { ...current.form, diaMes: Number(value) },
                      }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DAY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Horário</Label>
                    <Input
                      type="time"
                      value={editor.form.horaExecucao || "00:10"}
                      onChange={(event) => setEditor((current) => ({
                        ...current,
                        form: { ...current.form, horaExecucao: event.target.value || "00:10" },
                      }))}
                    />
                  </div>
                  <p className="col-span-2 text-xs text-slate-600">
                    Horário de Brasília. Se o mês não tiver esse dia, a rotina roda no último dia.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Repetição</Label>
                  <Select
                    value={String(editor.form.intervaloMinutos)}
                    onValueChange={(value) => setEditor((current) => ({
                      ...current,
                      form: { ...current.form, intervaloMinutos: Number(value) },
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INTERVAL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={String(option.value)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">Ativo</p>
                  <p className="text-xs text-slate-600">Pausado deixa de repetir até ser ligado de novo.</p>
                </div>
                <Switch
                  checked={editor.form.ativo}
                  onCheckedChange={(checked) => setEditor((current) => ({
                    ...current,
                    form: { ...current.form, ativo: checked },
                  }))}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditor(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={saving || !editor?.form?.nome?.trim() || !editor?.form?.tarefa} onClick={save}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? `“${confirm.nome}” deixa de repetir. A execução manual nas rotinas continua disponível.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={remove}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
