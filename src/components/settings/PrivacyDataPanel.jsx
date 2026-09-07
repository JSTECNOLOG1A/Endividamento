import React, { useEffect, useState } from "react";
import { ExternalLink, Shield } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { firstAccessApi } from "@/api/firstAccess";
import { LOGIN } from "@/components/auth/loginTheme";
import { useFirstAccess } from "@/lib/FirstAccessContext";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";

const REQUEST_TYPES = [
  { code: "ACCESS", label: "Solicitar acesso aos dados" },
  { code: "CORRECTION", label: "Solicitar correção cadastral" },
  { code: "PORTABILITY", label: "Solicitar portabilidade" },
  { code: "ERASURE", label: "Solicitar exclusão (quando possível)" },
  { code: "INFORMATION", label: "Consultar informações de tratamento" },
];

export default function PrivacyDataPanel() {
  const { startManualTour } = useFirstAccess();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingConsent, setSavingConsent] = useState(false);
  const [requestType, setRequestType] = useState("ACCESS");
  const [details, setDetails] = useState("");
  const [requestMsg, setRequestMsg] = useState(null);
  const [viewer, setViewer] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await firstAccessApi.getPrivacy());
    } catch (err) {
      setError(err.message || "Falha ao carregar privacidade");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const marketingOn = Boolean(data?.legal?.marketing?.consent);

  const toggleMarketing = async (checked) => {
    setSavingConsent(true);
    setError(null);
    try {
      if (checked) await firstAccessApi.setMarketingConsent(true);
      else await firstAccessApi.revokeMarketingConsent();
      await load();
    } catch (err) {
      setError(err.message || "Não foi possível atualizar o consentimento");
    } finally {
      setSavingConsent(false);
    }
  };

  const submitRequest = async () => {
    setRequestMsg(null);
    try {
      await firstAccessApi.createPrivacyRequest({ requestType, details });
      setDetails("");
      setRequestMsg("Solicitação registrada. Nossa equipe analisará o pedido.");
      await load();
    } catch (err) {
      setRequestMsg(err.message || "Falha ao registrar solicitação");
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando privacidade…</p>;
  }

  if (error && !data) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6" data-tour="privacy-workspace">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: LOGIN.title }}>
          Privacidade e Dados
        </h2>
        <p className="mt-1 text-sm" style={{ color: LOGIN.muted }}>
          Consulte documentos, gerencie consentimentos opcionais e exerça direitos previstos na LGPD.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="rounded-xl border bg-white p-4 space-y-3" style={{ borderColor: LOGIN.border }}>
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#155EEF]" />
          <h3 className="text-sm font-semibold text-slate-900">Documentos vigentes</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setViewer(data?.documents?.privacy)}
            className="rounded-lg border px-3 py-3 text-left hover:bg-slate-50"
            style={{ borderColor: LOGIN.border }}
          >
            <p className="text-sm font-medium text-slate-900">Política de Privacidade</p>
            <p className="text-xs text-slate-500">
              Versão vigente: {data?.legal?.privacyPolicy?.version || "—"}
              {data?.legal?.privacyPolicy?.acceptedVersion
                ? ` · Aceita: ${data.legal.privacyPolicy.acceptedVersion}`
                : ""}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setViewer(data?.documents?.terms)}
            className="rounded-lg border px-3 py-3 text-left hover:bg-slate-50"
            style={{ borderColor: LOGIN.border }}
          >
            <p className="text-sm font-medium text-slate-900">Termos de Uso</p>
            <p className="text-xs text-slate-500">
              Versão vigente: {data?.legal?.terms?.version || "—"}
              {data?.legal?.terms?.acceptedVersion
                ? ` · Aceita: ${data.legal.terms.acceptedVersion}`
                : ""}
            </p>
          </button>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-3" style={{ borderColor: LOGIN.border }}>
        <h3 className="text-sm font-semibold text-slate-900">Preferências de comunicação</h3>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="marketing-switch" className="text-sm font-medium text-slate-800">
              Comunicações comerciais
            </Label>
            <p className="text-xs text-slate-500 mt-0.5">
              Consentimento opcional. Pode ser retirado a qualquer momento.
            </p>
          </div>
          <Switch
            id="marketing-switch"
            checked={marketingOn}
            disabled={savingConsent}
            onCheckedChange={toggleMarketing}
          />
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-3" style={{ borderColor: LOGIN.border }}>
        <h3 className="text-sm font-semibold text-slate-900">Direitos do titular</h3>
        <ul className="text-sm text-slate-600 space-y-1 list-disc pl-5">
          <li>
            Consultar dados cadastrais em{" "}
            <Link className="text-[#155EEF] underline" to={createPageUrl("SettingsAccount")}>
              Conta
            </Link>
          </li>
          {(data?.notices || []).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
          <div className="space-y-2">
            <Label htmlFor="req-type">Tipo de solicitação</Label>
            <select
              id="req-type"
              className="h-10 w-full rounded-md border px-3 text-sm"
              style={{ borderColor: LOGIN.border }}
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
            >
              {REQUEST_TYPES.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
            <textarea
              className="min-h-[72px] w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: LOGIN.border }}
              placeholder="Detalhes (opcional)"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          <Button type="button" onClick={submitRequest} className="bg-[#155EEF] hover:bg-[#0B4DD8]">
            Enviar solicitação
          </Button>
        </div>
        {requestMsg ? <p className="text-sm text-slate-600">{requestMsg}</p> : null}
        {(data?.requests || []).length > 0 ? (
          <div className="pt-2 border-t" style={{ borderColor: LOGIN.border }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Solicitações recentes
            </p>
            <ul className="space-y-1 text-sm text-slate-600">
              {data.requests.slice(0, 5).map((r) => (
                <li key={r.id}>
                  {r.request_type} · {r.status} · {new Date(r.created_at).toLocaleString("pt-BR")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: LOGIN.border }}>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Ajuda</h3>
          <p className="text-xs text-slate-500">Reproduza o tour do sistema sem alterar o histórico de primeiro acesso.</p>
        </div>
        <Button type="button" variant="outline" onClick={startManualTour}>
          <ExternalLink className="h-4 w-4 mr-2" />
          Rever tour do sistema
        </Button>
      </section>

      {viewer ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border bg-white p-5" style={{ borderColor: LOGIN.border }}>
            <div className="flex justify-between gap-3 mb-3">
              <h3 className="font-semibold text-slate-900">{viewer.title}</h3>
              <button type="button" className="text-sm text-slate-500 underline" onClick={() => setViewer(null)}>
                Fechar
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{viewer.content}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
