import React, { useEffect, useId, useState } from "react";
import { FileText, Shield } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { legalApi } from "@/api/firstAccess";
import { LOGIN } from "@/components/auth/loginTheme";
import { useFirstAccess } from "@/lib/FirstAccessContext";

function DocButton({ icon: Icon, title, version, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/35"
      style={{ borderColor: LOGIN.border }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${LOGIN.blue}12`, color: LOGIN.blue }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: LOGIN.title }}>
          {title}
        </span>
        {version ? (
          <span className="block text-xs" style={{ color: LOGIN.muted }}>
            Versão {version}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function DocumentViewer({ doc, onClose }) {
  if (!doc) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-doc-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-white shadow-xl"
        style={{ borderColor: LOGIN.border }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: LOGIN.border }}>
          <div>
            <h2 id="legal-doc-title" className="text-base font-semibold" style={{ color: LOGIN.title }}>
              {doc.title}
            </h2>
            <p className="text-xs" style={{ color: LOGIN.muted }}>
              Versão {doc.version}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[#64748B] hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/35"
          >
            Fechar
          </button>
        </div>
        <div className="overflow-auto px-5 py-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
            {doc.content}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function LegalFirstAccessModal() {
  const { needsLegal, refresh } = useFirstAccess();
  const [docs, setDocs] = useState(null);
  const [privacyOk, setPrivacyOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const titleId = useId();

  useEffect(() => {
    if (!needsLegal) return undefined;
    let cancelled = false;
    legalApi.getCurrent().then((data) => {
      if (!cancelled) setDocs(data);
    }).catch((err) => {
      if (!cancelled) setError(err.message || "Não foi possível carregar os documentos");
    });
    return () => {
      cancelled = true;
    };
  }, [needsLegal]);

  if (!needsLegal) return null;

  const canContinue = privacyOk && termsOk && !saving;

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      await legalApi.accept({
        privacyAcknowledged: privacyOk,
        termsAccepted: termsOk,
        marketingConsent: marketing,
      });
      await refresh();
    } catch (err) {
      setError(err.message || "Não foi possível registrar os aceites");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className="w-full max-w-lg rounded-2xl border bg-white px-6 py-6 shadow-xl sm:px-8"
          style={{ borderColor: LOGIN.border }}
        >
          <div className="mb-5 text-center">
            <div
              className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: `${LOGIN.blue}12`, color: LOGIN.blue }}
            >
              <Shield className="h-5 w-5" />
            </div>
            <h1 id={titleId} className="text-xl font-bold tracking-tight" style={{ color: LOGIN.title }}>
              Privacidade e proteção de dados
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: LOGIN.muted }}>
              Antes de continuar, conheça como o AllDebt utiliza e protege seus dados pessoais.
            </p>
          </div>

          <div className="space-y-2.5">
            <DocButton
              icon={Shield}
              title="Política de Privacidade"
              version={docs?.privacyPolicy?.version}
              onClick={() => setViewer(docs?.privacyPolicy)}
            />
            <DocButton
              icon={FileText}
              title="Termos de Uso"
              version={docs?.terms?.version}
              onClick={() => setViewer(docs?.terms)}
            />
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="ack-privacy"
                checked={privacyOk}
                onCheckedChange={(v) => setPrivacyOk(v === true)}
                className="mt-0.5 border-[#D9E2EC] data-[state=checked]:border-[#155EEF] data-[state=checked]:bg-[#155EEF]"
              />
              <Label htmlFor="ack-privacy" className="text-sm font-normal leading-snug text-[#334155] cursor-pointer">
                Li e estou ciente da Política de Privacidade.
              </Label>
            </div>
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="ack-terms"
                checked={termsOk}
                onCheckedChange={(v) => setTermsOk(v === true)}
                className="mt-0.5 border-[#D9E2EC] data-[state=checked]:border-[#155EEF] data-[state=checked]:bg-[#155EEF]"
              />
              <Label htmlFor="ack-terms" className="text-sm font-normal leading-snug text-[#334155] cursor-pointer">
                Li e aceito os Termos de Uso.
              </Label>
            </div>
          </div>

          <div className="mt-6 rounded-xl border px-4 py-3" style={{ borderColor: LOGIN.border, background: "#F8FAFC" }}>
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: LOGIN.muted }}>
              Preferências opcionais
            </p>
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="ack-marketing"
                checked={marketing}
                onCheckedChange={(v) => setMarketing(v === true)}
                className="mt-0.5 border-[#D9E2EC] data-[state=checked]:border-[#155EEF] data-[state=checked]:bg-[#155EEF]"
              />
              <Label htmlFor="ack-marketing" className="text-sm font-normal leading-snug text-[#334155] cursor-pointer">
                Aceito receber comunicações comerciais e novidades do AllDebt.
              </Label>
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={!canContinue}
            onClick={handleContinue}
            className="mt-6 flex h-11 w-full items-center justify-center rounded-lg text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: canContinue ? LOGIN.blue : "#94A3B8" }}
          >
            {saving ? "Registrando…" : "Continuar"}
          </button>
        </div>
      </div>
      <DocumentViewer doc={viewer} onClose={() => setViewer(null)} />
    </>
  );
}
