import React from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import IntegrationsPanel from "@/components/settings/IntegrationsPanel";
import SchedulesPanel from "@/components/settings/SchedulesPanel";
import AuditLogPanel from "@/components/settings/AuditLogPanel";
import UsersPanel from "@/components/settings/UsersPanel";
import PlanPanel from "@/components/settings/PlanPanel";

const ROLE_LABELS = {
  admin: "Administrador",
  OWNER: "Proprietário",
  user: "Usuário",
  viewer: "Visualizador",
};

export default function Settings() {
  const { user, logout } = useAuth();
  const { viewingAll } = usePlatform();
  const isTenantAdmin = user?.role === "admin" || user?.tenant_role === "OWNER" || user?.platform_admin;
  const isOwner = Boolean(user?.platform_admin || user?.tenant_role === "OWNER");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Configurações</h1>
        <p className="text-sm text-slate-500 mt-0.5">Conta, usuários, sessão, integrações, agendamentos e log de atividades</p>
      </div>

      <Tabs defaultValue="integracoes">
        <TabsList className="bg-slate-100 h-auto flex-wrap">
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="agendamento">Agendamento</TabsTrigger>
          {isTenantAdmin ? <TabsTrigger value="usuarios">Usuários</TabsTrigger> : null}
          {isTenantAdmin ? <TabsTrigger value="log">Log</TabsTrigger> : null}
          <TabsTrigger value="conta">Conta</TabsTrigger>
        </TabsList>

        <TabsContent value="integracoes" className="mt-4">
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
        </TabsContent>

        <TabsContent value="agendamento" className="mt-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base text-slate-900">Agendamento</CardTitle>
              <CardDescription>
                Cadastre cada tarefa (consultar pagar, consultar receber ou converter PR→TX) e escolha o dia ou o intervalo. Nas rotinas também há execução manual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SchedulesPanel />
            </CardContent>
          </Card>
        </TabsContent>

        {isTenantAdmin ? (
          <TabsContent value="usuarios" className="mt-4">
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
          </TabsContent>
        ) : null}

        {isTenantAdmin ? (
          <TabsContent value="log" className="mt-4">
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
          </TabsContent>
        ) : null}

        <TabsContent value="conta" className="mt-4">
          <div className="max-w-3xl space-y-4">
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
                  <span className="text-slate-500">Nome</span>
                  <span className="font-medium text-slate-900">{user?.full_name || "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">E-mail</span>
                  <span className="font-medium text-slate-900">{user?.email || "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">Perfil</span>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
