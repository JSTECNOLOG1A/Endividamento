import React, { useCallback, useEffect, useState } from "react";
import { MailPlus, Pencil, Plus } from "lucide-react";
import { toast } from "@/lib/notify";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { ROLE_OPTIONS, YES_NO_OPTIONS, blockedLabel, roleLabel, usersApi } from "@/api/users";

function emptyForm() {
  return {
    full_name: "",
    email: "",
    cargo: "",
    setor: "",
    role: "user",
    password: "",
    password_confirm: "",
    blocked: false,
    blocked_at: null,
    last_login_at: null,
    is_owner: false,
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

function patchForm(editor, patch) {
  return {
    ...editor,
    form: { ...editor.form, ...patch },
  };
}

export default function UsersPanel() {
  const { user: currentUser } = useAuth();
  const { isMaster, viewingAll, tenantId } = usePlatform();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await usersApi.list());
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível carregar os usuários");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const resendInvite = async (item) => {
    try {
      const invited = await usersApi.resendInvite(item.id);
      if (invited.invite_url) {
        toast.success("Novo link de convite gerado");
        window.prompt("Link do convite (e-mail não enviado)", invited.invite_url);
      } else {
        toast.success("Convite reenviado");
      }
      await load();
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível reenviar o convite");
    }
  };

  const openCreate = () => setEditor({ mode: "create", form: emptyForm() });

  const openEdit = (item) => setEditor({
    mode: "edit",
    id: item.id,
    form: {
      full_name: item.full_name || "",
      email: item.email || "",
      cargo: item.cargo || "",
      setor: item.setor || "",
      role: item.role || "user",
      tenant_role: item.tenant_role || null,
      is_owner: Boolean(item.is_owner),
      password: "",
      password_confirm: "",
      blocked: Boolean(item.blocked),
      blocked_at: item.blocked_at || null,
      last_login_at: item.last_login_at || null,
    },
  });

  const save = async () => {
    if (!editor) return;
    const { form, mode, id } = editor;
    if (!form.full_name.trim() || !form.email.trim()) {
      toast.warning("Informe nome completo e e-mail");
      return;
    }
    if (form.password && form.password !== form.password_confirm) {
      toast.warning("A senha e a confirmação não coincidem");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        cargo: form.cargo.trim(),
        setor: form.setor.trim(),
        role: form.role,
        blocked: Boolean(form.blocked),
      };
      if (form.password) {
        payload.password = form.password;
        payload.password_confirm = form.password_confirm;
      }
      if (mode === "create") {
        const created = await usersApi.create(payload);
        if (created.invite_url) {
          toast.success("Convite criado. Sem SMTP: copie o link exibido.");
          window.prompt("Link do convite (e-mail não enviado)", created.invite_url);
        } else {
          toast.success(created.email_sent ? "Convite enviado por e-mail" : "Usuário criado");
        }
      } else {
        await usersApi.update(id, payload);
        toast.success("Usuário atualizado");
      }
      setEditor(null);
      await load();
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível salvar o usuário");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Convide por e-mail, cargo, setor e perfil. O convidado define a senha no link. O primeiro usuário da empresa tem acesso total.
          {isMaster && viewingAll ? " Selecione um cliente no topo para incluir ou editar usuários." : ""}
        </p>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5"
          onClick={openCreate}
          disabled={isMaster && viewingAll}
        >
          <Plus className="w-3.5 h-3.5" />
          Novo usuário
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando usuários...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center">
          Nenhum usuário cadastrado.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome completo</TableHead>
              {isMaster && viewingAll ? <TableHead>Cliente</TableHead> : null}
              <TableHead>E-mail</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Bloqueado</TableHead>
              <TableHead>Último login</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-slate-900">{item.full_name}</TableCell>
                {isMaster && viewingAll ? (
                  <TableCell className="text-sm text-slate-700">{item.tenant_name || "—"}</TableCell>
                ) : null}
                <TableCell className="text-sm text-slate-700">{item.email}</TableCell>
                <TableCell className="text-sm text-slate-700">{item.cargo || "—"}</TableCell>
                <TableCell className="text-sm text-slate-700">{item.setor || "—"}</TableCell>
                <TableCell className="text-sm text-slate-700">
                  {item.is_owner ? "Proprietário" : roleLabel(item.role)}
                </TableCell>
                <TableCell>
                  {item.invite_pending ? (
                    <Badge variant="outline">Convite pendente</Badge>
                  ) : (
                    <Badge variant={item.blocked ? "destructive" : "secondary"}>
                      {blockedLabel(item.blocked)}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-slate-600">{formatDateTime(item.last_login_at)}</TableCell>
                <TableCell className="text-right">
                  {item.invite_pending ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Reenviar convite"
                      onClick={() => resendInvite(item)}
                      disabled={isMaster && viewingAll}
                    >
                      <MailPlus className="w-3.5 h-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Editar"
                    onClick={() => openEdit(item)}
                    disabled={isMaster && viewingAll}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={Boolean(editor)} onOpenChange={(open) => { if (!open && !saving) setEditor(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.mode === "edit" ? "Editar usuário" : "Convidar usuário"}</DialogTitle>
            <DialogDescription>
              {editor?.mode === "edit"
                ? "Altere os dados de acesso. A senha é opcional; o convite define a senha pelo link."
                : "A pessoa recebe um link para criar a própria senha. Sem SMTP o link aparece na tela."}
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <Label>Nome completo</Label>
                <Input
                  value={editor.form.full_name}
                  onChange={(event) => setEditor((current) => patchForm(current, { full_name: event.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={editor.form.email}
                  onChange={(event) => setEditor((current) => patchForm(current, { email: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Cargo</Label>
                <Input
                  value={editor.form.cargo}
                  onChange={(event) => setEditor((current) => patchForm(current, { cargo: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Setor</Label>
                <Input
                  value={editor.form.setor}
                  onChange={(event) => setEditor((current) => patchForm(current, { setor: event.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Perfil de acesso</Label>
                {editor.form.is_owner ? (
                  <Input readOnly className="bg-slate-50" value="Proprietário — acesso total neste cliente" />
                ) : (
                  <Select
                    value={editor.form.role}
                    onValueChange={(value) => setEditor((current) => patchForm(current, { role: value }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {editor.mode === "edit" ? (
                <>
                  <div className="space-y-1">
                    <Label>Nova senha (opcional)</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={editor.form.password}
                      onChange={(event) => setEditor((current) => patchForm(current, { password: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Confirma senha</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={editor.form.password_confirm}
                      onChange={(event) => setEditor((current) => patchForm(current, { password_confirm: event.target.value }))}
                    />
                  </div>
                </>
              ) : null}
              <div className="space-y-1">
                <Label>Bloqueado</Label>
                <Select
                  value={editor.form.blocked ? "sim" : "nao"}
                  disabled={editor.id === currentUser?.id || Boolean(editor.form.is_owner)}
                  onValueChange={(value) => setEditor((current) => patchForm(current, { blocked: value === "sim" }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YES_NO_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Data do bloqueio</Label>
                <Input
                  readOnly
                  className="bg-slate-50"
                  value={editor.form.blocked ? formatDateTime(editor.form.blocked_at || (editor.mode === "create" ? new Date().toISOString() : null)) : "—"}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Data do último login</Label>
                <Input
                  readOnly
                  className="bg-slate-50"
                  value={formatDateTime(editor.form.last_login_at)}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditor(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={saving} onClick={save}>
              {saving ? "Salvando..." : editor?.mode === "create" ? "Enviar convite" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
