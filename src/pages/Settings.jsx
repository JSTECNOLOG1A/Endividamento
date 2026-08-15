import React from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/AuthContext";
import IntegrationsPanel from "@/components/settings/IntegrationsPanel";

const ROLE_LABELS = {
  admin: "Administrador",
  OWNER: "Proprietário",
  user: "Usuário",
  viewer: "Visualizador",
};

export default function Settings() {
  const { user, logout } = useAuth();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Configurações</h1>
        <p className="text-sm text-slate-500 mt-0.5">Conta, sessão e integrações via API</p>
      </div>

      <Tabs defaultValue="integracoes">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
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
              <IntegrationsPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conta" className="mt-4">
          <div className="max-w-3xl space-y-4">
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
                    {ROLE_LABELS[user?.role] || user?.role || "—"}
                  </span>
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
