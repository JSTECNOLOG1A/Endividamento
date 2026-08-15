import React, { useState } from "react";
import { Plug, KeyRound, Link2, Plus, Trash2, Unplug, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUTH_TYPE_OPTIONS,
  CADASTRO_LINK_OPTIONS,
  HTTP_METHOD_OPTIONS,
  emptyEndpoint,
  integrationsApi,
  isProtheusErp,
} from "@/api/integrations";

function Field({ label, error, hint, className = "", children }) {
  return (
    <div className={className}>
      <Label className="text-slate-700">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && !error ? <p className="text-xs text-slate-400 mt-1">{hint}</p> : null}
      {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
    </div>
  );
}

function NativeSelect({ value, onValueChange, options, disabled }) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value || "none"} value={option.value || "__none"}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function IntegrationForm({
  formData,
  errors = {},
  loading,
  isEditing,
  hasCredential,
  integrationCode,
  onChange,
  onSubmit,
  onCancel,
}) {
  const [testingKey, setTestingKey] = useState(null);
  const needsCredential = formData.authType !== "none";
  const isBasic = formData.authType === "basic";
  const isApiKey = formData.authType === "api_key";
  const showProtheusContext = isProtheusErp(formData.erpNome);
  const canReuseSavedCredential = isEditing && hasCredential && !formData.credential.trim();
  const busy = loading || testingKey !== null;

  const credentialLabel =
    formData.authType === "bearer" ? "Bearer Token" :
    formData.authType === "basic" ? "Senha" :
    "API Key";

  const updateField = (field, value) => onChange({ ...formData, [field]: value });

  const updateEndpoint = (key, field, value) => {
    onChange({
      ...formData,
      endpoints: formData.endpoints.map((endpoint) => (
        endpoint.key === key ? { ...endpoint, [field]: value } : endpoint
      )),
    });
  };

  const addEndpoint = () => {
    onChange({ ...formData, endpoints: [...formData.endpoints, emptyEndpoint()] });
  };

  const removeEndpoint = (key) => {
    onChange({
      ...formData,
      endpoints: formData.endpoints.filter((endpoint) => endpoint.key !== key),
    });
  };

  async function handleTest(path, key = "base", metodo) {
    if (!formData.baseUrl.trim()) {
      toast.error("Informe a URL base");
      return;
    }
    if (needsCredential && !formData.credential.trim() && !canReuseSavedCredential) {
      toast.error("Informe a credencial para testar");
      return;
    }
    if (isBasic && !formData.username.trim() && !canReuseSavedCredential) {
      toast.error("Informe o usuário");
      return;
    }
    if (path !== undefined && !path.trim().startsWith("/")) {
      toast.error("O caminho deve começar com /");
      return;
    }

    setTestingKey(key);
    try {
      const result = await integrationsApi.testConnection({
        code: integrationCode,
        baseUrl: formData.baseUrl.trim(),
        authType: formData.authType,
        authHeader: formData.authHeader.trim() || undefined,
        username: formData.username.trim() || undefined,
        credential: formData.credential.trim() || undefined,
        timeoutSeconds: Number(formData.timeoutSeconds) || 30,
        path,
        metodo,
        erpNome: formData.erpNome.trim() || undefined,
        grupoEmpresas: formData.grupoEmpresas.trim() || undefined,
        empresa: formData.empresa.trim() || undefined,
        filial: formData.filial.trim() || undefined,
      });
      if (result?.ok) toast.success(result.message);
      else if (result?.reached) toast.warning(result.message);
      else toast.error(result?.message || "Não foi possível testar a conexão");
    } catch (error) {
      toast.error(
        error.data?.details?.baseUrl ||
        error.data?.error ||
        error.message ||
        "Falha ao testar a conexão"
      );
    } finally {
      setTestingKey(null);
    }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Plug className="w-4 h-4" />
          Dados da conexão
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Nome" error={errors.nome}>
            <Input
              value={formData.nome}
              onChange={(e) => updateField("nome", e.target.value)}
              placeholder="Protheus produção"
              disabled={loading}
              required
            />
          </Field>
          <Field label="ERP" hint="Ex.: Protheus, TOTVS, SAP" error={errors.erpNome}>
            <Input
              value={formData.erpNome}
              onChange={(e) => updateField("erpNome", e.target.value)}
              placeholder="Protheus"
              disabled={loading}
            />
          </Field>
          <Field label="Descrição" className="md:col-span-2" error={errors.descricao}>
            <Textarea
              value={formData.descricao}
              onChange={(e) => updateField("descricao", e.target.value)}
              placeholder="Conexão REST do ERP"
              disabled={loading}
              rows={3}
            />
          </Field>
        </div>
      </section>

      {showProtheusContext && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Building2 className="w-4 h-4" />
            Contexto Protheus
          </div>
          <p className="text-xs text-slate-500">
            O grupo define a tabela física (ex.: SED010, SA6010, CT1010). Empresa e filial da conexão são o ambiente de autenticação.
            Cadastros com controle por filial são lidos de todas as empresas e filiais do grupo.
            O plano de contas (CT1) no grupo 01 é compartilhado: a leitura ignora filial.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Grupo de empresas" hint="Ex.: 01 — define a tabela física" error={errors.grupoEmpresas}>
              <Input
                value={formData.grupoEmpresas}
                onChange={(e) => updateField("grupoEmpresas", e.target.value)}
                placeholder="01"
                maxLength={4}
                disabled={loading}
              />
            </Field>
            <Field label="Empresa" hint="Ambiente de login (não limita a leitura)" error={errors.empresa}>
              <Input
                value={formData.empresa}
                onChange={(e) => updateField("empresa", e.target.value)}
                placeholder="01"
                maxLength={10}
                disabled={loading}
              />
            </Field>
            <Field label="Filial" hint="Ambiente de login (não limita a leitura)" error={errors.filial}>
              <Input
                value={formData.filial}
                onChange={(e) => updateField("filial", e.target.value)}
                placeholder="01"
                maxLength={10}
                disabled={loading}
              />
            </Field>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <KeyRound className="w-4 h-4" />
          Acesso à API
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Field label="URL base" className="md:col-span-4" error={errors.baseUrl}>
            <Input
              value={formData.baseUrl}
              onChange={(e) => updateField("baseUrl", e.target.value)}
              placeholder="https://api.erp.com.br/rest"
              disabled={loading}
              required
            />
          </Field>
          <Field label="Timeout (s)" className="md:col-span-2" error={errors.timeoutSeconds}>
            <Input
              type="number"
              min={5}
              max={120}
              value={formData.timeoutSeconds}
              onChange={(e) => updateField("timeoutSeconds", e.target.value)}
              disabled={loading}
              required
            />
          </Field>
          <Field label="Autenticação" className="md:col-span-2" error={errors.authType}>
            <NativeSelect
              value={formData.authType}
              onValueChange={(value) => updateField("authType", value)}
              options={AUTH_TYPE_OPTIONS}
              disabled={loading}
            />
          </Field>
          {isApiKey && (
            <Field label="Header da API Key" className="md:col-span-2" hint="Padrão: X-API-Key" error={errors.authHeader}>
              <Input
                value={formData.authHeader}
                onChange={(e) => updateField("authHeader", e.target.value)}
                placeholder="X-API-Key"
                disabled={loading}
              />
            </Field>
          )}
          {isBasic && (
            <Field label="Usuário" className="md:col-span-2" error={errors.username}>
              <Input
                value={formData.username}
                onChange={(e) => updateField("username", e.target.value)}
                placeholder="usuario.erp"
                disabled={loading}
                required
              />
            </Field>
          )}
          {needsCredential && (
            <Field
              label={credentialLabel}
              className="md:col-span-2"
              hint={isEditing && hasCredential && !formData.credential ? "Deixe em branco para manter a credencial salva" : "A credencial é criptografada no servidor"}
              error={errors.credential}
            >
              <Input
                type="password"
                value={formData.credential}
                onChange={(e) => updateField("credential", e.target.value)}
                placeholder={isEditing && hasCredential ? "••••••••" : `Informe ${credentialLabel.toLowerCase()}`}
                disabled={loading}
                required={!isEditing}
              />
            </Field>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 pt-1">
          <p className="text-xs text-slate-500">
            O teste não grava títulos. POST de títulos usa corpo vazio só para ver se o caminho existe.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => handleTest(undefined, "base")}
            className="gap-2"
          >
            <Unplug className="w-4 h-4" />
            {testingKey === "base" ? "Testando..." : "Testar conexão"}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Link2 className="w-4 h-4" />
          Endpoints
        </div>
        {formData.endpoints.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum endpoint. Adicione os caminhos REST do cadastro.</p>
        )}
        {formData.endpoints.map((endpoint, index) => (
          <div key={endpoint.key} className="rounded-lg border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
            <Field label="Nome" className="md:col-span-4" error={errors[`endpoints.${index}.nome`]}>
              <Input
                value={endpoint.nome}
                onChange={(e) => updateEndpoint(endpoint.key, "nome", e.target.value)}
                placeholder="Listar naturezas"
                disabled={loading}
              />
            </Field>
            <Field label="Método" className="md:col-span-2" error={errors[`endpoints.${index}.metodo`]}>
              <NativeSelect
                value={endpoint.metodo}
                onValueChange={(value) => updateEndpoint(endpoint.key, "metodo", value)}
                options={HTTP_METHOD_OPTIONS}
                disabled={loading}
              />
            </Field>
            <Field label="Caminho" className="md:col-span-4" hint="Relativo à URL base" error={errors[`endpoints.${index}.path`]}>
              <Input
                value={endpoint.path}
                onChange={(e) => updateEndpoint(endpoint.key, "path", e.target.value)}
                placeholder="/api/fin/naturezas"
                disabled={loading}
              />
            </Field>
            <div className="md:col-span-2 flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => handleTest(endpoint.path.trim(), endpoint.key, endpoint.metodo)}
              >
                {testingKey === endpoint.key ? "..." : "Testar"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                onClick={() => removeEndpoint(endpoint.key)}
                aria-label="Remover endpoint"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            <Field label="Vincular cadastro" className="md:col-span-6" hint="GET lista, POST grava. Cada cadastro + método só pode existir em uma conexão." error={errors[`endpoints.${index}.cadastroKey`]}>
              <NativeSelect
                value={endpoint.cadastroKey || "__none"}
                onValueChange={(value) => updateEndpoint(endpoint.key, "cadastroKey", value === "__none" ? "" : value)}
                options={CADASTRO_LINK_OPTIONS}
                disabled={loading}
              />
            </Field>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={addEndpoint} disabled={loading} className="gap-2">
          <Plus className="w-4 h-4" />
          Adicionar endpoint
        </Button>
      </section>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {loading ? "Salvando..." : isEditing ? "Salvar alterações" : "Criar conexão"}
        </Button>
      </div>
    </form>
  );
}
