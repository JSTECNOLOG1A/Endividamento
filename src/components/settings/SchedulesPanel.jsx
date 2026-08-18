import React, { useCallback, useEffect, useState } from "react";
import { Pencil, Play, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "@/lib/notify";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { INTERVAL_OPTIONS, intervalLabel, schedulesApi } from "@/api/schedules";

function emptyForm(tasks) {
  return {
    nome: "",
    tarefa: tasks[0]?.key || "consultar_titulos_pagar",
    intervaloMinutos: 5,
    ativo: true,
  };
}

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

export default function SchedulesPanel() {
  const [items, setItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const openCreate = () => {
    setEditor({ mode: "create", form: emptyForm(tasks) });
  };

  const openEdit = (item) => {
    setEditor({
      mode: "edit",
      id: item.id,
      form: {
        nome: item.nome,
        tarefa: item.tarefa,
        intervaloMinutos: item.intervaloMinutos,
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
        intervaloMinutos: Number(editor.form.intervaloMinutos),
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Defina a repetição das tarefas automáticas. A execução também pode ser disparada à mão nas rotinas.
        </p>
        <Button type="button" size="sm" className="h-8 gap-1.5" onClick={openCreate}>
          <Plus className="w-3.5 h-3.5" />
          Novo agendamento
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando agendamentos...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center">
          Nenhum agendamento. Crie um para consultar títulos no ERP em intervalo fixo.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tarefa</TableHead>
              <TableHead>Repetição</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Última execução</TableHead>
              <TableHead>Próxima</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-slate-900">{item.nome}</TableCell>
                <TableCell>
                  <div className="text-sm text-slate-800">{item.tarefaLabel}</div>
                  <div className="text-[11px] text-slate-400">{item.rotina}</div>
                </TableCell>
                <TableCell className="text-sm text-slate-600">{intervalLabel(item.intervaloMinutos)}</TableCell>
                <TableCell>
                  <Badge variant={item.ativo ? "default" : "secondary"}>
                    {item.executando ? "Executando" : item.ativo ? "Ativo" : "Pausado"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="text-sm text-slate-700">{formatDateTime(item.ultimaExecucaoEm)}</div>
                  {item.ultimaMensagem ? (
                    <div
                      className={`text-[11px] max-w-[240px] truncate ${item.ultimaExecucaoOk ? "text-emerald-700" : "text-rose-700"}`}
                      title={item.ultimaMensagem}
                    >
                      {item.ultimaMensagem}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm text-slate-600">
                  {item.ativo ? formatDateTime(item.proximaExecucaoEm) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Executar agora"
                      disabled={Boolean(runningId)}
                      onClick={() => runNow(item)}
                    >
                      <Play className={`w-3.5 h-3.5 ${runningId === item.id ? "animate-pulse" : ""}`} />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Ativar ou pausar" onClick={() => toggleStatus(item)}>
                      <Power className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => openEdit(item)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600" title="Excluir" onClick={() => setConfirm(item)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
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
              A tarefa roda sozinha no servidor, no intervalo escolhido, mesmo com a tela fechada.
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input
                  value={editor.form.nome}
                  onChange={(event) => setEditor((current) => ({
                    ...current,
                    form: { ...current.form, nome: event.target.value },
                  }))}
                  placeholder="Consulta de títulos a pagar"
                />
              </div>
              <div className="space-y-1">
                <Label>Tarefa</Label>
                <Select
                  value={editor.form.tarefa}
                  onValueChange={(value) => setEditor((current) => ({
                    ...current,
                    form: { ...current.form, tarefa: value },
                  }))}
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
              </div>
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
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">Ativo</p>
                  <p className="text-xs text-slate-500">Pausado deixa de repetir até ser ligado de novo.</p>
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
            <Button type="button" disabled={saving || !editor?.form?.nome?.trim()} onClick={save}>
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
