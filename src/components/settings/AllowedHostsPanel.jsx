import React, { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SORT_HEAD_CLASS } from "@/components/ui/sortable-table";
import { integrationsApi } from "@/api/integrations";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

export default function AllowedHostsPanel({ canManage = false, viewingAll = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await integrationsApi.listAllowedHosts();
      setItems(result.data || []);
    } catch (error) {
      // Não zeramos para "vazio": sem saber a lista, afirmar que não há bloqueio
      // seria enganoso. Mostramos o erro e um botão para tentar de novo.
      setLoadError(error.message || "Não foi possível carregar os endereços liberados");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Com "todos os clientes" selecionado não há cliente para consultar; o backend
    // recusaria a listagem. Mostramos só o aviso âmbar, sem chamar a API.
    if (viewingAll) {
      setItems([]);
      setLoadError("");
      setLoading(false);
      return;
    }
    load();
  }, [load, viewingAll]);

  const openAdd = () => setAdding({ host: "", descricao: "", error: "" });

  const saveHost = async () => {
    if (!adding) return;
    if (!adding.host.trim()) {
      setAdding((prev) => ({ ...prev, error: "Informe o endereço do servidor." }));
      return;
    }
    setSaving(true);
    try {
      await integrationsApi.createAllowedHost({
        host: adding.host.trim(),
        descricao: adding.descricao.trim() || undefined,
      });
      toast.success("Endereço liberado");
      setAdding(null);
      await load();
    } catch (error) {
      // Repassa a mensagem do backend (ex.: faixa larga demais, duplicado).
      const message =
        error.data?.details?.host || error.message || "Não foi possível liberar o endereço";
      setAdding((prev) => (prev ? { ...prev, error: message } : prev));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const runRemove = async () => {
    if (!confirm) return;
    setConfirm((prev) => ({ ...prev, loading: true }));
    try {
      await integrationsApi.removeAllowedHost(confirm.id);
      toast.success("Endereço removido");
      setConfirm(null);
      await load();
    } catch (error) {
      toast.error(error.message || "Não foi possível remover o endereço");
      setConfirm((prev) => ({ ...prev, loading: false }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
        <p>
          Por segurança, o sistema só conecta a servidores de ERP em endereços públicos. Se o seu
          Protheus fica numa rede interna ou VPN, cadastre aqui o endereço dele para liberar a
          conexão.
        </p>
      </div>

      {viewingAll ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Você está vendo todos os clientes. Selecione um cliente no topo para gerenciar os endereços
          liberados.
        </p>
      ) : null}

      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={openAdd} className="gap-2" disabled={viewingAll}>
            <Plus className="w-4 h-4" />
            Liberar endereço
          </Button>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={SORT_HEAD_CLASS}>Endereço</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Descrição</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Liberado em</TableHead>
              {canManage ? (
                <TableHead className={`${SORT_HEAD_CLASS} text-right`}>Ações</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={canManage ? 4 : 3} className="text-center text-slate-600 py-8">
                  Carregando endereços...
                </TableCell>
              </TableRow>
            ) : viewingAll ? (
              <TableRow>
                <TableCell colSpan={canManage ? 4 : 3} className="text-center text-slate-600 py-8">
                  Selecione um cliente no topo para ver os endereços liberados.
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={canManage ? 4 : 3} className="py-8">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <p className="text-sm text-red-600">{loadError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={load}>
                      Tentar novamente
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 4 : 3} className="text-center text-slate-600 py-8">
                  Nenhum endereço liberado. Endereços públicos já funcionam sem cadastro; libere aqui
                  apenas servidores em rede interna ou VPN.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id} className="hover:bg-slate-50">
                  <TableCell className="font-medium text-slate-900 break-all">{item.host}</TableCell>
                  <TableCell className="text-slate-700">{item.descricao || "—"}</TableCell>
                  <TableCell className="text-slate-700">{formatDate(item.createdAt)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remover"
                        disabled={viewingAll}
                        onClick={() => setConfirm({ id: item.id, host: item.host })}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={Boolean(adding)}
        onOpenChange={(open) => {
          if (!open && !saving) setAdding(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Liberar endereço</DialogTitle>
            <DialogDescription>
              Informe o endereço do servidor de ERP que está em rede interna ou VPN. Pode ser um nome
              (ex.: erp.cliente.com.br) ou uma faixa de rede (ex.: 10.0.0.0/24).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-slate-700">Endereço ou faixa de rede</Label>
              <Input
                autoFocus
                value={adding?.host || ""}
                onChange={(e) => setAdding((prev) => ({ ...prev, host: e.target.value, error: "" }))}
                placeholder="erp.cliente.com.br ou 10.0.0.0/24"
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-700">Descrição (opcional)</Label>
              <Input
                value={adding?.descricao || ""}
                onChange={(e) => setAdding((prev) => ({ ...prev, descricao: e.target.value }))}
                placeholder="Ex.: Protheus da matriz"
                disabled={saving}
              />
            </div>
            {adding?.error ? <p className="text-xs text-red-600">{adding.error}</p> : null}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAdding(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveHost} disabled={saving}>
              {saving ? "Salvando..." : "Liberar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover endereço</AlertDialogTitle>
            <AlertDialogDescription>
              Remover "{confirm?.host}"? O sistema deixará de conectar a servidores de ERP neste
              endereço.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirm?.loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={runRemove} disabled={confirm?.loading}>
              {confirm?.loading ? "Aguarde..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
