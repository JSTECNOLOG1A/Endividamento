import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, Pencil, Plus, Power, Trash2, Upload } from "lucide-react";
import { toast } from "@/lib/notify";
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
import { SORT_HEAD_CLASS } from "@/components/ui/sortable-table";
import IntegrationForm from "./IntegrationForm";
import {
  AUTH_TYPE_LABELS,
  CADASTRO_KEY_LABELS,
  emptyIntegrationForm,
  formFromIntegration,
  integrationsApi,
  prepareIntegrationPayload,
} from "@/api/integrations";
import { parametersApi } from "@/api/parameters";
import { sameOrigin } from "@/lib/erpBaseUrl";

// Normaliza mensagens de erro do import para linguagem leiga, sem jargão técnico.
function friendlyImportError(message) {
  if (!message) return "Falha ao importar conexões";
  if (/Senha do arquivo incorreta/i.test(message)) {
    return "A senha do arquivo está incorreta. Informe a senha usada na exportação.";
  }
  return message;
}

export default function IntegrationsPanel({ canManage = false, viewingAll = false }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errors, setErrors] = useState({});
  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [externalErpEnabled, setExternalErpEnabled] = useState(true);
  const [exportDialog, setExportDialog] = useState(null);
  const [importDialog, setImportDialog] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async (page = pagination.page) => {
    setLoading(true);
    try {
      const [result, erpParam] = await Promise.all([
        integrationsApi.list({
          search,
          status,
          page,
          limit: pagination.limit,
        }),
        parametersApi.get("integrations.external_erp_enabled").catch(() => null),
      ]);
      setItems(result.data || []);
      setPagination(result.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
      const resolved = erpParam?.data?.value;
      setExternalErpEnabled(resolved !== false && resolved !== "false");
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
        originalBaseUrl: full.baseUrl || "",
        credentialWarning: false,
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

  const openExportDialog = () => {
    setExportDialog({ passphrase: "", confirm: "", error: "" });
  };

  const confirmExport = async () => {
    if (!exportDialog) return;
    const passphrase = exportDialog.passphrase;
    if (passphrase.trim().length < 8) {
      setExportDialog((prev) => ({ ...prev, error: "A senha deve ter ao menos 8 caracteres." }));
      return;
    }
    if (passphrase !== exportDialog.confirm) {
      setExportDialog((prev) => ({ ...prev, error: "As senhas não são iguais. Digite a mesma senha nos dois campos." }));
      return;
    }
    setExporting(true);
    try {
      const bundle = await integrationsApi.exportAll(passphrase);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `conexoes-erp-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      // Não mantemos a senha na tela depois do download.
      setExportDialog(null);
      toast.success(
        bundle.count
          ? `${bundle.count} conexão(ões) exportada(s). Guarde a senha: você vai precisar dela para importar.`
          : "Arquivo exportado (sem conexões)."
      );
    } catch (error) {
      const message =
        error.data?.details?.passphrase || error.message || "Falha ao exportar conexões";
      setExportDialog((prev) => (prev ? { ...prev, error: message } : prev));
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("O arquivo não é um JSON válido de conexões.");
      }
      // O arquivo é protegido por senha quando foi exportado com credenciais cifradas.
      const protectedFile = Boolean(parsed?.credentialEncryption);
      setImportDialog({
        bundle: parsed,
        fileName: file.name,
        protectedFile,
        passphrase: "",
        error: "",
      });
    } catch (error) {
      toast.error(error.message || "Falha ao ler o arquivo");
    }
  };

  const confirmImport = async () => {
    if (!importDialog) return;
    const { bundle, protectedFile, passphrase } = importDialog;
    if (protectedFile && !passphrase.trim()) {
      setImportDialog((prev) => ({
        ...prev,
        error: "Este arquivo está protegido por senha. Informe a senha usada na exportação.",
      }));
      return;
    }
    setImporting(true);
    try {
      const result = await integrationsApi.importBundle(
        bundle,
        passphrase.trim() ? passphrase : undefined
      );
      await load(1);
      setImportDialog(null);
      if (result.failed) {
        const first = result.errors?.[0]?.message;
        toast.warning(
          `${result.imported} importada(s), ${result.failed} com erro` +
            (first ? `: ${friendlyImportError(first)}` : "")
        );
      } else {
        toast.success(`${result.imported} conexão(ões) importada(s)`);
      }
    } catch (error) {
      // Só tratamos como "senha errada" quando o backend sinaliza isso de fato
      // (mensagem "Senha do arquivo incorreta...") — não por qualquer texto com "senha".
      const raw = error.data?.details?.passphrase || error.message || "";
      const message = friendlyImportError(raw);
      setImportDialog((prev) => (prev ? { ...prev, error: message } : prev));
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const save = async () => {
    if (!editor) return;
    const isCreate = editor.mode === "create";
    setSaving(true);
    setErrors({});

    // Etapa 1 — gravação. Só aqui uma falha é "falha ao salvar".
    try {
      const payload = prepareIntegrationPayload(editor.form);
      if (isCreate) {
        await integrationsApi.create(payload);
      } else {
        await integrationsApi.update(editor.code, payload);
      }
    } catch (error) {
      const detailsMap = error.data?.details;
      if (detailsMap && typeof detailsMap === "object") {
        setErrors(detailsMap);
        toast.error(Object.values(detailsMap)[0] || error.message);
      } else {
        toast.error(error.message || "Falha ao salvar a conexão");
      }
      setSaving(false);
      return;
    }

    // Etapa 2 — pós-gravação. A conexão JÁ foi salva; falha ao recarregar/rebuscar
    // não deve dizer "falha ao salvar".
    // Por segurança, ao mudar o endereço do servidor para uma origem diferente, o
    // backend apaga a senha de acesso salva. Se a conexão ainda precisa de senha e
    // o usuário não digitou uma nova, reabrimos pedindo a credencial.
    const needsCredential = editor.form.authType !== "none";
    const credentialWiped =
      !isCreate &&
      needsCredential &&
      editor.hasCredential &&
      !editor.form.credential.trim() &&
      !sameOrigin(editor.originalBaseUrl, editor.form.baseUrl);

    if (credentialWiped) {
      toast.warning(
        "Como você mudou o endereço do servidor, por segurança a senha de acesso foi apagada. Informe a senha novamente para este novo endereço."
      );
      try {
        const full = await integrationsApi.get(editor.code);
        setEditor({
          mode: "edit",
          code: full.code,
          hasCredential: full.hasCredential,
          originalBaseUrl: full.baseUrl || "",
          credentialWarning: true,
          form: formFromIntegration(full),
        });
      } catch {
        // Se não der para rebuscar, mantém a edição aberta com o aviso.
        setEditor((prev) =>
          prev
            ? { ...prev, credentialWarning: true, hasCredential: false, originalBaseUrl: prev.form.baseUrl }
            : prev
        );
      }
    } else {
      toast.success(isCreate ? "Conexão criada" : "Conexão atualizada");
      setEditor(null);
    }

    setSaving(false);
    // load() já trata o próprio erro (toast de carregamento) — não afeta o "salvo".
    await load(isCreate ? 1 : pagination.page);
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

  const manageDisabled = viewingAll || !externalErpEnabled;

  return (
    <div className="space-y-4">
      {viewingAll ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Você está vendo todos os clientes. Selecione um cliente no topo para criar conexão ou integrar títulos.
        </p>
      ) : null}
      {!viewingAll && !externalErpEnabled ? (
        <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          Integração com ERP externo desativada neste cliente. Ative em{" "}
          <span className="font-medium">Configurações → Parâmetros → Integrações</span>{" "}
          (“Integra com outro ERP”) para cadastrar conexões.
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
        <div className="sm:ml-auto flex flex-wrap gap-2">
          {canManage ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={manageDisabled || exporting || importing}
                title={
                  viewingAll
                    ? "Selecione um cliente no topo"
                    : !externalErpEnabled
                      ? "Ative a integração com ERP em Parâmetros"
                      : "Exportar conexões em um arquivo protegido por senha"
                }
                onClick={openExportDialog}
              >
                <Download className="w-4 h-4" />
                {exporting ? "Exportando..." : "Exportar"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={manageDisabled || exporting || importing}
                title={
                  viewingAll
                    ? "Selecione um cliente no topo"
                    : !externalErpEnabled
                      ? "Ative a integração com ERP em Parâmetros"
                      : "Importar conexões de um JSON exportado"
                }
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" />
                {importing ? "Importando..." : "Importar"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                onClick={openCreate}
                className="gap-2"
                disabled={manageDisabled}
                title={
                  viewingAll
                    ? "Selecione um cliente no topo para criar conexão"
                    : !externalErpEnabled
                      ? "Ative a integração com ERP em Parâmetros"
                      : undefined
                }
              >
                <Plus className="w-4 h-4" />
                Nova conexão
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={SORT_HEAD_CLASS}>Nome</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>ERP</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>URL base</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Endpoints</TableHead>
              <TableHead className={SORT_HEAD_CLASS}>Status</TableHead>
              <TableHead className={`${SORT_HEAD_CLASS} text-right`}>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-600 py-8">
                  Carregando conexões...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-600 py-8">
                  Nenhuma conexão de API cadastrada.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id} className="hover:bg-slate-50">
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
        <div className="flex items-center justify-between text-sm text-slate-600">
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
              credentialWarning={editor.credentialWarning}
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
                <p className="text-slate-600 mb-1">Endpoints</p>
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

      <Dialog
        open={Boolean(exportDialog)}
        onOpenChange={(open) => {
          if (!open && !exporting) setExportDialog(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar conexões</DialogTitle>
            <DialogDescription>
              Defina uma senha para proteger este arquivo. Você vai precisar dela para importar de
              volta. Sem essa senha, não é possível abrir as credenciais do arquivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-slate-700">Senha de proteção do arquivo</Label>
              <Input
                type="password"
                autoFocus
                autoComplete="new-password"
                value={exportDialog?.passphrase || ""}
                onChange={(e) =>
                  setExportDialog((prev) => ({ ...prev, passphrase: e.target.value, error: "" }))
                }
                placeholder="Mínimo de 8 caracteres"
                disabled={exporting}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-700">Repita a senha</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={exportDialog?.confirm || ""}
                onChange={(e) =>
                  setExportDialog((prev) => ({ ...prev, confirm: e.target.value, error: "" }))
                }
                placeholder="Digite a senha de novo"
                disabled={exporting}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirmExport();
                  }
                }}
              />
            </div>
            {exportDialog?.error ? (
              <p className="text-xs text-red-600">{exportDialog.error}</p>
            ) : (
              <p className="text-xs text-slate-500">
                Anote a senha em local seguro. Ela não fica salva no sistema — se esquecer, o arquivo
                não poderá mais ser importado.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportDialog(null)}
              disabled={exporting}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={confirmExport} disabled={exporting}>
              {exporting ? "Exportando..." : "Exportar arquivo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(importDialog)}
        onOpenChange={(open) => {
          if (!open && !importing) setImportDialog(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importar conexões</DialogTitle>
            <DialogDescription>
              {importDialog?.protectedFile
                ? "Este arquivo está protegido por senha. Informe a senha definida na exportação para abrir as credenciais."
                : "Confirme a importação das conexões deste arquivo."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-slate-600 break-all">
              Arquivo: <span className="font-medium text-slate-900">{importDialog?.fileName}</span>
            </p>
            {importDialog?.protectedFile ? (
              <>
                <Label className="text-slate-700">Senha do arquivo</Label>
                <Input
                  type="password"
                  autoFocus
                  autoComplete="new-password"
                  value={importDialog?.passphrase || ""}
                  onChange={(e) =>
                    setImportDialog((prev) => ({ ...prev, passphrase: e.target.value, error: "" }))
                  }
                  placeholder="Senha usada na exportação"
                  disabled={importing}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmImport();
                    }
                  }}
                />
              </>
            ) : null}
            {importDialog?.error ? (
              <p className="text-xs text-red-600">{importDialog.error}</p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportDialog(null)}
              disabled={importing}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={confirmImport} disabled={importing}>
              {importing ? "Importando..." : "Importar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-900 text-right break-all">{value || "—"}</span>
    </div>
  );
}
