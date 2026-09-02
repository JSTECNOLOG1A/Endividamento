import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/AuthContext";
import { onboardingApi } from "@/api/billing";

export default function Onboarding() {
  const navigate = useNavigate();
  const { checkAppState } = useAuth();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    entity_name: "",
    codigo_empresa: "01",
    codigo_filial: "01",
  });

  useEffect(() => {
    let cancelled = false;
    onboardingApi.get()
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setForm({
          entity_name: data.entity?.entity_name || data.tenant_name || "",
          codigo_empresa: data.entity?.codigo_empresa || "01",
          codigo_filial: data.entity?.codigo_filial || "01",
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Não foi possível carregar o onboarding");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const save = async (goToSettings) => {
    setError(null);
    setSaving(true);
    try {
      await onboardingApi.complete({
        entity_id: info?.entity?.id,
        entity_name: form.entity_name.trim(),
        codigo_empresa: form.codigo_empresa.trim(),
        codigo_filial: form.codigo_filial.trim(),
      });
      await checkAppState();
      navigate(goToSettings ? "/Settings" : "/", { replace: true });
    } catch (err) {
      setError(err.message || "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl text-slate-900">Configuração inicial</CardTitle>
          <CardDescription>
            Confirme a empresa/filial e os códigos do Protheus. Depois você pode colar a integração ERP em Configurações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-slate-500">Carregando...</p> : (
            <form onSubmit={(event) => { event.preventDefault(); save(true); }} className="space-y-4">
              <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                <p><span className="text-slate-500">Cliente:</span> {info?.tenant_name || "—"}</p>
                <p><span className="text-slate-500">Plano:</span> {info?.plan || "STARTER"} (avaliação)</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entity_name">Nome da empresa / filial</Label>
                <Input
                  id="entity_name"
                  value={form.entity_name}
                  onChange={(e) => setForm((current) => ({ ...current, entity_name: e.target.value }))}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="codigo_empresa">Código empresa Protheus</Label>
                  <Input
                    id="codigo_empresa"
                    value={form.codigo_empresa}
                    onChange={(e) => setForm((current) => ({ ...current, codigo_empresa: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="codigo_filial">Código filial Protheus</Label>
                  <Input
                    id="codigo_filial"
                    value={form.codigo_filial}
                    onChange={(e) => setForm((current) => ({ ...current, codigo_filial: e.target.value }))}
                    required
                  />
                </div>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar e ir às integrações"}
                </Button>
                <Button type="button" variant="ghost" disabled={saving} onClick={() => save(false)}>
                  Concluir e ir ao início
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
