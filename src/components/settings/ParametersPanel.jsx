import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PARAMETER_CATEGORIES,
  LAYOUT_OPTIONS,
  parametersApi,
} from "@/api/parameters";
import { useLayoutMode } from "@/lib/LayoutContext";
import { usePlatform } from "@/lib/PlatformContext";
import { useAuth } from "@/lib/AuthContext";
import { getPlatformTenantId } from "@/api/platformScope";
import { cn } from "@/lib/utils";

function masterNeedsTenant(user) {
  return Boolean(user?.platform_admin && !getPlatformTenantId());
}

function isTenantContextError(error) {
  return error?.data?.code === "TENANT_CONTEXT_REQUIRED"
    || error?.message?.includes("Selecione o cliente");
}

const DENSITY_LABELS = {
  comfortable: "Confortável",
  compact: "Compacto",
  ultra_compact: "Ultra compacto",
};

const THEME_LABELS = {
  light: "Claro",
  dark: "Escuro",
  system: "Sistema",
};

const RADIUS_LABELS = {
  square: "Quadrado",
  small: "Pequeno",
  medium: "Médio",
  large: "Grande",
};

const CATEGORY_STYLES = {
  appearance: "bg-cyan-50 text-cyan-800 ring-cyan-200/80",
  finance: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
  contracts: "bg-violet-50 text-violet-800 ring-violet-200/80",
  accounting: "bg-amber-50 text-amber-900 ring-amber-200/80",
  integrations: "bg-sky-50 text-sky-800 ring-sky-200/80",
  system: "bg-slate-100 text-slate-700 ring-slate-200/80",
};

function enumLabel(key, value) {
  if (key === "appearance.default_layout") {
    return LAYOUT_OPTIONS.find((o) => o.value === value)?.label || value;
  }
  if (key === "appearance.theme") return THEME_LABELS[value] || value;
  if (key === "appearance.interface_density") return DENSITY_LABELS[value] || value;
  if (key === "appearance.button_radius") return RADIUS_LABELS[value] || value;
  return value;
}

function enumOptions(param) {
  return (param.allowedValues || []).map((value) => ({
    value,
    label: enumLabel(param.key, value),
  }));
}

function controlClassName(modern) {
  return cn(
    "w-full sm:w-[200px]",
    modern && "border-[#E5E7EB] bg-[#F7F9FC]/80 focus:ring-[#06B6D4]/25 focus:border-[#06B6D4]"
  );
}

function ParameterControl({ param, value, onChange, disabled, modern }) {
  if (param.type === "BOOLEAN") {
    return (
      <Select value={value ? "true" : "false"} onValueChange={(v) => onChange(v === "true")} disabled={disabled}>
        <SelectTrigger className={controlClassName(modern)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Ativado</SelectItem>
          <SelectItem value="false">Desativado</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (param.type === "ENUM") {
    const options = enumOptions(param);
    return (
      <Select value={String(value)} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={controlClassName(modern)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (param.type === "INTEGER" || param.type === "DECIMAL") {
    return (
      <Input
        type="number"
        className={controlClassName(modern)}
        value={value ?? ""}
        onChange={(e) => onChange(param.type === "INTEGER" ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
        disabled={disabled}
      />
    );
  }

  return (
    <Input
      className={cn(
        controlClassName(modern),
        param.key.startsWith("finance.") && "font-mono uppercase tracking-wide"
      )}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={param.defaultValue === "" ? "Opcional" : String(param.defaultValue ?? "")}
    />
  );
}

function CategoryBadge({ category, modern }) {
  const label = PARAMETER_CATEGORIES[category] || category;
  if (modern) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
          CATEGORY_STYLES[category] || "bg-slate-100 text-slate-700 ring-slate-200/80"
        )}
      >
        {label}
      </span>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs font-normal">
      {label}
    </Badge>
  );
}

function ParameterRow({ param, draft, setDraft, saving, modern, onPreviewLayout }) {
  const isDirty = draft[param.key] !== param.value;

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors",
        modern
          ? cn(
              "rounded-xl border px-4 py-4 sm:px-5",
              isDirty
                ? "border-[#06B6D4]/40 bg-[#06B6D4]/[0.04] shadow-sm shadow-cyan-500/5"
                : "border-[#E5E7EB] bg-white hover:border-[#06B6D4]/25 hover:bg-[#F7F9FC]/60"
            )
          : "gap-3 p-4 rounded-lg border border-slate-200 bg-white"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Label className={cn("text-sm font-medium", modern ? "text-[#172033]" : "text-slate-900")}>
            {param.label}
          </Label>
          <CategoryBadge category={param.category} modern={modern} />
          {modern && isDirty ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#06B6D4]">
              Alterado
            </span>
          ) : null}
        </div>
        {param.description ? (
          <p className={cn("text-sm mt-1.5 leading-relaxed", modern ? "text-[#667085]" : "text-slate-500")}>
            {param.description}
          </p>
        ) : null}
        {param.key === "appearance.default_layout" ? (
          <Button
            type="button"
            variant="link"
            className={cn(
              "h-auto p-0 mt-2 text-xs",
              modern ? "text-[#06B6D4] hover:text-[#0891b2]" : "text-blue-600"
            )}
            onClick={() => onPreviewLayout(draft[param.key] || param.value)}
          >
            <Eye className="w-3 h-3 mr-1 inline" />
            Visualizar
          </Button>
        ) : null}
      </div>
      <div className={cn("shrink-0", modern && "sm:pl-4")}>
        <ParameterControl
          param={param}
          value={draft[param.key]}
          onChange={(val) => setDraft((prev) => ({ ...prev, [param.key]: val }))}
          disabled={!param.isEditable || saving}
          modern={modern}
        />
      </div>
    </div>
  );
}

export default function ParametersPanel() {
  const { user, isLoadingAuth } = useAuth();
  const { layoutMode } = useLayoutMode();
  const { loading: platformLoading } = usePlatform();
  const isModernLayout = layoutMode === "modern";
  const contextReady = Boolean(user) && !isLoadingAuth && !platformLoading;
  const needsTenantSelection = contextReady && masterNeedsTenant(user);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [previewLayout, setPreviewLayout] = useState(null);

  const load = useCallback(async () => {
    if (!contextReady) return;

    if (masterNeedsTenant(user)) {
      setItems([]);
      setDraft({});
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await parametersApi.list({ category, search });
      const data = result.data || [];
      setItems(data);
      const initial = {};
      for (const item of data) {
        initial[item.key] = item.value;
      }
      setDraft(initial);
    } catch (error) {
      if (isTenantContextError(error)) {
        setItems([]);
        setDraft({});
        return;
      }
      toast.error(error.message || "Não foi possível carregar os parâmetros");
    } finally {
      setLoading(false);
    }
  }, [category, search, contextReady, user]);

  useEffect(() => {
    if (!contextReady) {
      setLoading(true);
      return;
    }
    load();
  }, [load, contextReady]);

  const dirtyKeys = useMemo(() => {
    return items.filter((item) => draft[item.key] !== item.value).map((item) => item.key);
  }, [items, draft]);

  const hasChanges = dirtyKeys.length > 0;

  const groupedItems = useMemo(() => {
    const order = ["appearance", "finance", "contracts", "accounting", "integrations", "system", "general"];
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [items]);

  const handleSave = async () => {
    setSaving(true);
    const layoutChanged = dirtyKeys.includes("appearance.default_layout");
    try {
      for (const key of dirtyKeys) {
        await parametersApi.update(key, draft[key], "TENANT");
      }
      toast.success("Parâmetros salvos com sucesso");
      if (layoutChanged) {
        window.location.reload();
        return;
      }
      await load();
    } catch (error) {
      toast.error(error.message || "Erro ao salvar parâmetros");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    const reset = {};
    for (const item of items) {
      reset[item.key] = item.value;
    }
    setDraft(reset);
  };

  const categoryOptions = useMemo(() => [
    { value: "all", label: "Todas as categorias" },
    ...Object.entries(PARAMETER_CATEGORIES).map(([value, label]) => ({ value, label })),
  ], []);

  const tenantSelectionNotice = needsTenantSelection ? (
    <p
      className={cn(
        "text-sm rounded-md px-3 py-2 border",
        isModernLayout
          ? "text-[#0891B2] bg-[#06B6D4]/10 border-[#06B6D4]/25"
          : "text-amber-800 bg-amber-50 border-amber-200"
      )}
    >
      Você está vendo todos os clientes. Selecione um cliente no topo para visualizar e editar os parâmetros.
    </p>
  ) : null;

  const filtersBar = (
    <div className={cn("flex flex-col sm:flex-row gap-3", isModernLayout && "sm:items-center")}>
      <div className="relative flex-1 max-w-md">
        {isModernLayout ? (
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#667085]" />
        ) : null}
        <Input
          placeholder="Buscar parâmetro..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={needsTenantSelection}
          className={cn(
            isModernLayout && "pl-9 border-[#E5E7EB] bg-[#F7F9FC]/80 focus-visible:ring-[#06B6D4]/25"
          )}
        />
      </div>
      <Select value={category} onValueChange={setCategory} disabled={needsTenantSelection}>
        <SelectTrigger className={cn("w-full sm:w-[220px]", isModernLayout && "border-[#E5E7EB] bg-[#F7F9FC]/80")}>
          <SelectValue placeholder="Todas as categorias" />
        </SelectTrigger>
        <SelectContent>
          {categoryOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const listContent = loading ? (
    <div className={cn("py-16 text-center", isModernLayout ? "text-[#667085]" : "text-slate-500")}>
      <div className={cn(
        "inline-block w-6 h-6 border-2 rounded-full animate-spin mb-3",
        isModernLayout ? "border-[#E5E7EB] border-t-[#06B6D4]" : "border-slate-200 border-t-slate-600"
      )} />
      <p className="text-sm">Carregando parâmetros...</p>
    </div>
  ) : needsTenantSelection ? null : items.length === 0 ? (
    <p className={cn("text-sm py-16 text-center", isModernLayout ? "text-[#667085]" : "text-slate-500")}>
      Nenhum parâmetro encontrado.
    </p>
  ) : isModernLayout && category === "all" ? (
    <div className="space-y-8">
      {groupedItems.map(([cat, params]) => (
        <section key={cat}>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
              {PARAMETER_CATEGORIES[cat] || cat}
            </h3>
            <div className="flex-1 h-px bg-gradient-to-r from-[#E5E7EB] to-transparent" />
          </div>
          <div className="space-y-2.5">
            {params.map((param) => (
              <ParameterRow
                key={param.key}
                param={param}
                draft={draft}
                setDraft={setDraft}
                saving={saving}
                modern
                onPreviewLayout={setPreviewLayout}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  ) : (
    <div className="space-y-3">
      {items.map((param) => (
        <ParameterRow
          key={param.key}
          param={param}
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          modern={isModernLayout}
          onPreviewLayout={setPreviewLayout}
        />
      ))}
    </div>
  );

  const saveBar = hasChanges ? (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4",
        isModernLayout
          ? "sticky bottom-0 z-10 -mx-5 px-5 py-4 mt-2 border-t border-[#E5E7EB] bg-white/95 backdrop-blur-sm"
          : "border-t border-slate-200"
      )}
    >
      {isModernLayout ? (
        <p className="text-sm text-[#667085]">
          <span className="font-medium text-[#06B6D4]">{dirtyKeys.length}</span>
          {" "}alteração{dirtyKeys.length !== 1 ? "ões" : ""} pendente{dirtyKeys.length !== 1 ? "s" : ""}
        </p>
      ) : null}
      <div className={cn("flex gap-2", isModernLayout ? "sm:ml-auto" : "justify-end w-full")}>
        <Button variant="outline" onClick={handleCancel} disabled={saving} className={isModernLayout ? "border-[#E5E7EB]" : undefined}>
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className={isModernLayout ? "bg-[#06B6D4] hover:bg-[#0891b2] text-white shadow-sm" : undefined}
        >
          {saving ? "Salvando..." : "Salvar alterações"}
        </Button>
      </div>
    </div>
  ) : null;

  if (isModernLayout) {
    return (
      <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
        <div className="sticky top-0 z-20 flex items-start gap-3 border-b border-[#E5E7EB] bg-white/95 backdrop-blur-sm px-5 py-4">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#06B6D4]/10 text-[#06B6D4]">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <p className="text-sm text-[#667085] leading-relaxed">
              Ajuste layout, financeiro e demais comportamentos. Alterações de layout exigem recarregar a página.
            </p>
            {tenantSelectionNotice}
            {filtersBar}
          </div>
        </div>

        <div className="px-5 py-5">
          {listContent}
          {saveBar}
        </div>

        <Dialog open={previewLayout != null} onOpenChange={(open) => !open && setPreviewLayout(null)}>
          <DialogContent className="border-[#E5E7EB]">
            <DialogHeader>
              <DialogTitle>Pré-visualização do layout</DialogTitle>
              <DialogDescription>
                A alteração só terá efeito após salvar. O sistema será recarregado ao aplicar o layout.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {LAYOUT_OPTIONS.filter((o) => o.value === previewLayout).map((opt) => (
                <div key={opt.value} className="rounded-xl border border-[#E5E7EB] bg-[#F7F9FC]/50 p-4">
                  <p className="font-medium text-[#172033]">{opt.label}</p>
                  <p className="text-[#667085] mt-1">{opt.description}</p>
                  {opt.value === "modern" ? (
                    <p className="text-[#667085] mt-2 text-xs">
                      Menu lateral, header com breadcrumb e identidade visual SaaS B2B.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Parâmetros do sistema</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Defina configurações de comportamento do AllDebt para sua empresa.
        </p>
      </div>

      {tenantSelectionNotice}
      {filtersBar}
      {listContent}
      {saveBar}

      <Dialog open={previewLayout != null} onOpenChange={(open) => !open && setPreviewLayout(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pré-visualização do layout</DialogTitle>
            <DialogDescription>
              A alteração só terá efeito após salvar. O sistema será recarregado ao aplicar o layout.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {LAYOUT_OPTIONS.filter((o) => o.value === previewLayout).map((opt) => (
              <div key={opt.value} className="rounded-md border border-slate-200 p-3">
                <p className="font-medium text-slate-900">{opt.label}</p>
                <p className="text-slate-600 mt-1">{opt.description}</p>
                {opt.value === "modern" ? (
                  <p className="text-[#667085] mt-2 text-xs">
                    Menu lateral, header com breadcrumb e identidade visual SaaS B2B.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
