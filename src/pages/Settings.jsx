import React from "react";
import { Navigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { useLayoutMode } from "@/lib/LayoutContext";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SETTINGS_PAGE,
  SETTINGS_META_BY_SECTION,
  filterSettingsSections,
} from "@/config/settingsNavigation";
import IntegrationsPanel from "@/components/settings/IntegrationsPanel";
import SchedulesPanel from "@/components/settings/SchedulesPanel";
import AuditLogPanel from "@/components/settings/AuditLogPanel";
import UsersPanel from "@/components/settings/UsersPanel";
import PlanPanel from "@/components/settings/PlanPanel";
import ParametersPanel from "@/components/settings/ParametersPanel";

const ROLE_LABELS = {
  admin: "Administrador",
  OWNER: "Proprietário",
  user: "Usuário",
  viewer: "Visualizador",
};

const SECTION_COPY = {
  integracoes: {
    description: "Conexões REST, autenticação, contexto Protheus e endpoints vinculados a cadastros.",
  },
  agendamento: {
    description: "Cadastre tarefas automáticas e escolha dia ou intervalo de execução.",
  },
  parametros: {
    description: "Comportamento do AllDebt para sua empresa — layout, financeiro e aparência.",
  },
  usuarios: {
    description: "Convide por e-mail. A pessoa define a própria senha no link (válido por 7 dias).",
  },
  log: {
    description: "Inclusões, alterações, exclusões e processamentos com data/hora e responsável.",
  },
  conta: {
    description: "Plano, dados da sessão e encerramento de acesso neste navegador.",
  },
};

export function SettingsView({ section = "integracoes" }) {
  const { user, logout } = useAuth();
  const { viewingAll } = usePlatform();
  const { layoutMode } = useLayoutMode();
  const isModernLayout = layoutMode === "modern";
  const isTenantAdmin = user?.role === "admin" || user?.tenant_role === "OWNER" || user?.platform_admin;
  const isOwner = Boolean(user?.platform_admin || user?.tenant_role === "OWNER");

  const meta = SETTINGS_META_BY_SECTION[section];
  const allowed = filterSettingsSections(isTenantAdmin).some((item) => item.section === section);

  if (!meta || !allowed) {
    return <Navigate to={`/${DEFAULT_SETTINGS_PAGE}`} replace />;
  }

  const copy = SECTION_COPY[section];

  return (
    <div className={cn(isModernLayout ? "w-full" : "w-full px-4 sm:px-6 py-8")}>
      <div className={cn("mb-6", isModernLayout && "shrink-0")}>
        <h1 className={cn(
          "text-2xl font-bold tracking-tight",
          isModernLayout ? "text-[#172033]" : "text-slate-900"
        )}>
          {meta.name}
        </h1>
        <p className={cn("text-sm mt-1", isModernLayout ? "text-[#667085]" : "text-slate-500")}>
          {copy.description}
        </p>
      </div>

      <SettingsPanel
        section={section}
        isTenantAdmin={isTenantAdmin}
        isOwner={isOwner}
        viewingAll={viewingAll}
        user={user}
        logout={logout}
      />
    </div>
  );
}

function SettingsPanel({ section, isTenantAdmin, isOwner, viewingAll, user, logout }) {
  if (section === "integracoes") {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Conexões de API</CardTitle>
          <CardDescription>
            Mesmo modelo do Clarity: URL REST, autenticação, contexto Protheus e endpoints vinculados a cadastros.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntegrationsPanel canManage={isOwner} viewingAll={viewingAll} />
        </CardContent>
      </Card>
    );
  }
  if (section === "agendamento") {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Agendamento</CardTitle>
          <CardDescription>
            Cadastre cada tarefa (consultar pagar, consultar receber ou converter PR→JUR) e escolha o dia ou o intervalo. Nas rotinas também há execução manual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulesPanel />
        </CardContent>
      </Card>
    );
  }
  if (section === "parametros" && isTenantAdmin) {
    return <ParametersPanel />;
  }
  if (section === "usuarios" && isTenantAdmin) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Usuários</CardTitle>
          <CardDescription>
            Convide por e-mail. A pessoa define a própria senha no link (válido por 7 dias).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersPanel />
        </CardContent>
      </Card>
    );
  }
  if (section === "log" && isTenantAdmin) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Log de atividades</CardTitle>
          <CardDescription>
            Identifica o usuário responsável por cada inclusão, alteração, exclusão ou processamento, com data/hora, rotina, registro e de/para.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditLogPanel />
        </CardContent>
      </Card>
    );
  }
  if (section === "conta") {
    return (
      <div className="space-y-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Plano</CardTitle>
            <CardDescription>
              Alteração local sem gateway. O proprietário ou o master pode ativar Pro ou Enterprise.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PlanPanel />
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Conta</CardTitle>
            <CardDescription>Dados do usuário autenticado nesta sessão</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-600">Nome</span>
              <span className="font-medium text-slate-900">{user?.full_name || "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-600">E-mail</span>
              <span className="font-medium text-slate-900">{user?.email || "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-600">Perfil</span>
              <span className="font-medium text-slate-900">
                {user?.tenant_role === "OWNER" ? "Proprietário" : (ROLE_LABELS[user?.role] || user?.role || "—")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500">Plano da sessão</span>
              <span className="font-medium text-slate-900">{user?.plan || "—"} · {user?.billing_status || "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Sessão</CardTitle>
            <CardDescription>Encerre o acesso neste navegador</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={logout} className="gap-2">
              <LogOut className="w-4 h-4" />
              Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  return null;
}

/** Layout Classic — abas horizontais (inalterado). */
export function SettingsClassic() {
  const { user, logout } = useAuth();
  const { viewingAll } = usePlatform();
  const isTenantAdmin = user?.role === "admin" || user?.tenant_role === "OWNER" || user?.platform_admin;
  const isOwner = Boolean(user?.platform_admin || user?.tenant_role === "OWNER");
  const navItems = filterSettingsSections(isTenantAdmin);

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Configurações</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Conta, usuários, plano, sessão, integrações, agendamentos e log de atividades
        </p>
      </div>
      <Tabs defaultValue="integracoes">
        <TabsList className="bg-slate-100 h-auto flex-wrap">
          {navItems.map(({ section, name }) => (
            <TabsTrigger key={section} value={section}>{name}</TabsTrigger>
          ))}
        </TabsList>
        {navItems.map(({ section }) => (
          <TabsContent key={section} value={section} className="mt-4">
            <SettingsPanel
              section={section}
              isTenantAdmin={isTenantAdmin}
              isOwner={isOwner}
              viewingAll={viewingAll}
              user={user}
              logout={logout}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  const { layoutMode } = useLayoutMode();
  if (layoutMode === "modern") {
    return <Navigate to={`/${DEFAULT_SETTINGS_PAGE}`} replace />;
  }
  return <SettingsClassic />;
}
