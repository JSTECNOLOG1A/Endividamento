import React, { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import IntegrationForm from "./IntegrationForm";
import {
  AUTH_TYPE_LABELS,
  CADASTRO_KEY_LABELS,
  emptyIntegrationForm,
  formFromIntegration,
  integrationsApi,
  prepareIntegrationPayload,
} from "@/api/integrations";

export default function IntegrationsPanel({ canManage = false, viewingAll = false }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async (page = pagination.page) => {
    setLoading(true);
    try {
      const result = await integrationsApi.list({
        search,
        status,
        page,
        limit: pagination.limit,
      });
      setItems(result.data || []);
      setPagination(result.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (error) {
      toast.error(error.message || "Não foi possível carregar as conexões");
    } finally {
      setLoading(false);
    }
  }, [search, status, pagination.limit, pagination.page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setErrors({});
    setEditor({
      mode: "create",
      form: emptyIntegrationForm(),
      hasCredential: false,
    });
  };

  const openEdit = async (item) => {
    try {
      const full = await integrationsApi.get(item.code);
      setErrors({});
      setEditor({
        mode: "edit",
        code: full.code,
        hasCredential: full.hasCredential,
        form: formFromIntegration(full),
      });
    } catch (error) {
      toast.error(error.message || "Não foi possível abrir a conexão");
    }
  };

  const openDetails = async (item) => {
    try {
      const full = await integrationsApi.get(item.code);
      setDetails(full);
    } catch (error) {
      toast.error(error.message || "Não foi possível carregar os detalhes");
    }
  };

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    setErrors({});
    try {
      const payload = prepareIntegrationPayload(editor.form);
      if (editor.mode === "create") {
        await integrationsApi.create(payload);
        toast.success("Conexão criada");
      } else {
        await integrationsApi.update(editor.code, payload);
        toast.success("Conexão atualizada");
      }
      setEditor(null);
      await load(editor.mode === "create" ? 1 : pagination.page);
    } catch (error) {
      const detailsMap = error.data?.details;
      if (detailsMap && typeof detailsMap === "object") {
        setErrors(detailsMap);
        toast.error(Object.values(detailsMap)[0] || error.message);
      } else {
        toast.error(error.message || "Falha ao salvar a conexão");
      }
    } finally {
      setSaving(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirm((prev) => ({ ...prev, loading: true }));
    try {
      if (confirm.type === "delete") {
        await integrationsApi.remove(confirm.code);
        toast.success("Conexão excluída");
      } else {
        const next = confirm.status === "ativo" ? "inativo" : "ativo";
        await integrationsApi.updateStatus(confirm.code, next);
        toast.success(next === "ativo" ? "Conexão ativada" : "Conexão desativada");
      }
      setConfirm(null);
      await load();
    } catch (error) {
      toast.error(error.message || "Não foi possível concluir a ação");
      setConfirm((prev) => ({ ...prev, loading: false }));
    }
  };

  return (
    <div className="space-y-4">
      {viewingAll ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Você está vendo todos os clientes. Selecione um cliente no topo para criar conexão ou integrar títulos.
        </p>
      ) : null}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, ERP ou URL"
          className="sm:max-w-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="ativo">Ativo</SelectItem>
            <SelectItem value="inativo">Inativo</SelectItem>
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          {canManage ? (
            <Button
              onClick={openCreate}
              className="gap-2"
              disabled={viewingAll}
              title={viewingAll ? "Selecione um cliente no topo para criar conexão" : undefined}
            >
              <Plus className="w-4 h-4" />
              Nova conexão
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>ERP</TableHead>
              <TableHead>URL base</TableHead>
              <TableHead>Endpoints</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                  Carregando conexões...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                  Nenhuma conexão de API cadastrada.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-slate-900">{item.nome}</TableCell>
                  <TableCell>{item.erpNome || "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={item.baseUrl}>
                    {item.baseUrl}
                  </TableCell>
                  <TableCell>{item.endpointsCount ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === "ativo" ? "default" : "secondary"}>
                      {item.status === "ativo" ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" title="Detalhes" onClick={() => openDetails(item)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {canManage ? (
                        <>
                          <Button variant="ghost" size="icon" title="Editar" onClick={() => openEdit(item)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={item.status === "ativo" ? "Desativar" : "Ativar"}
                            onClick={() => setConfirm({ type: "status", code: item.code, name: item.nome, status: item.status })}
                          >
                            <Power className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Excluir"
                            onClick={() => setConfirm({ type: "delete", code: item.code, name: item.nome })}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{pagination.total} conexões</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => load(pagination.page - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => load(pagination.page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <Dialog open={Boolean(editor)} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.mode === "edit" ? "Editar conexão" : "Nova conexão"}</DialogTitle>
            <DialogDescription>
              Cadastre URL, autenticação e endpoints REST do ERP. Credenciais são criptografadas no servidor.
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <IntegrationForm
              formData={editor.form}
              errors={errors}
              loading={saving}
              isEditing={editor.mode === "edit"}
              hasCredential={editor.hasCredential}
              integrationCode={editor.code}
              onChange={(form) => setEditor((prev) => ({ ...prev, form }))}
              onSubmit={save}
              onCancel={() => setEditor(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(details)} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{details?.nome}</DialogTitle>
            <DialogDescription>{details?.erpNome || details?.baseUrl}</DialogDescription>
          </DialogHeader>
          {details && (
            <div className="space-y-3 text-sm">
              <Detail label="URL base" value={details.baseUrl} />
              <Detail label="Autenticação" value={AUTH_TYPE_LABELS[details.authType] || details.authType} />
              <Detail label="Credencial salva" value={details.hasCredential ? "Sim" : "Não"} />
              <Detail label="Timeout" value={`${details.timeoutSeconds}s`} />
              <Detail label="Grupo / Empresa / Filial" value={[details.grupoEmpresas, details.empresa, details.filial].filter(Boolean).join(" · ") || "—"} />
              <div>
                <p className="text-slate-500 mb-1">Endpoints</p>
                {details.endpoints?.length ? (
                  <ul className="space-y-1">
                    {details.endpoints.map((endpoint) => (
                      <li key={endpoint.id} className="font-medium text-slate-900">
                        {endpoint.metodo} {endpoint.path}
                        {endpoint.cadastroKey ? ` · ${CADASTRO_KEY_LABELS[endpoint.cadastroKey] || endpoint.cadastroKey}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-700">Nenhum endpoint</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.type === "delete"
                ? "Excluir conexão"
                : confirm?.status === "ativo"
                  ? "Desativar conexão"
                  : "Ativar conexão"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === "delete"
                ? `Excluir "${confirm?.name}"? A credencial e os endpoints serão removidos.`
                : confirm?.status === "ativo"
                  ? `Desativar "${confirm?.name}"? Cadastros vinculados deixam de consultar o ERP.`
                  : `Ativar "${confirm?.name}"?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirm?.loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm} disabled={confirm?.loading}>
              {confirm?.loading ? "Aguarde..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 text-right break-all">{value || "—"}</span>
    </div>
  );
}
