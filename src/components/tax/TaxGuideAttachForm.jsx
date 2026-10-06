import React, { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, Keyboard, Paperclip, X } from "lucide-react";
import { taxGuidesApi } from "@/api/taxGuides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { MAX_GUIDE_FILE_BYTES, formatFileSize, isGuideException } from "@/lib/taxGuides";
import { useInvalidateTaxGuides } from "@/hooks/useTaxData";
import { FieldError, serverErrorField } from "./TaxBadges";
import TaxConfirmDialog from "./TaxConfirmDialog";

const MODES = [
  { key: "pdf", label: "Anexar o PDF", icon: Paperclip },
  { key: "linha", label: "Colar a linha digitável", icon: Keyboard },
];

const FILE_ERROR_CODES = new Set(["INVALID_FILE", "FILE_TOO_LARGE"]);

function validateFile(file) {
  if (!file) return "Escolha o PDF da guia.";
  const looksLikePdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!looksLikePdf) return "A guia precisa ser um arquivo PDF.";
  if (file.size === 0) return "O arquivo escolhido está vazio.";
  if (file.size > MAX_GUIDE_FILE_BYTES) return `A guia passa do tamanho máximo de ${formatFileSize(MAX_GUIDE_FILE_BYTES)}.`;
  return "";
}

/**
 * Anexa (ou substitui) a guia de uma parcela: o PDF ou a linha digitável, com "pagar até" opcional.
 * Substituir sempre passa por confirmação — também quando outra pessoa anexou uma guia nesse meio-tempo.
 */
export default function TaxGuideAttachForm({ installmentId, replacing, onDone, onCancel }) {
  const [mode, setMode] = useState("pdf");
  const [file, setFile] = useState(null);
  const [line, setLine] = useState("");
  const [payBy, setPayBy] = useState("");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const fileInputRef = useRef(null);
  const invalidateGuides = useInvalidateTaxGuides();

  const mutation = useMutation({
    mutationFn: ({ substituir }) =>
      taxGuidesApi.attach(installmentId, {
        file: mode === "pdf" ? file : null,
        linhaDigitavel: mode === "linha" ? line.trim() : undefined,
        pagarAte: payBy || undefined,
        substituir,
      }),
    onSuccess: async (result, { substituir }) => {
      setConfirmReplace(false);
      const verb = substituir ? "substituída" : "anexada";
      if (isGuideException(result?.guia)) {
        toast.warning(`Guia ${verb}, mas ela está em exceção. Veja os motivos antes de pagar.`);
      } else {
        toast.success(`Guia ${verb} e vinculada à parcela.`);
      }
      await invalidateGuides();
      onDone();
    },
    onError: (error) => {
      setConfirmReplace(false);
      if (error.code === "TAX_GUIDE_EXISTS") {
        setServerError(error.message);
        setConfirmReplace(true);
        return;
      }
      const field = serverErrorField(error);
      if (field) {
        setErrors({ [field]: error.message });
        return;
      }
      if (FILE_ERROR_CODES.has(error.code) || (mode === "pdf" && error.code === "VALIDATION")) {
        setErrors({ file: error.message });
        return;
      }
      setServerError(error.message);
    },
  });

  const busy = mutation.isPending;

  const clearFeedback = () => {
    setErrors({});
    setServerError("");
  };

  const handleFileChange = (event) => {
    const chosen = event.target.files?.[0] || null;
    event.target.value = "";
    if (!chosen) return;
    const problem = validateFile(chosen);
    clearFeedback();
    setErrors(problem ? { file: problem } : {});
    setFile(problem ? null : chosen);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    clearFeedback();
    if (mode === "pdf") {
      const problem = validateFile(file);
      if (problem) {
        setErrors({ file: problem });
        return;
      }
    } else if (!line.trim()) {
      setErrors({ linha_digitavel: "Informe a linha digitável da guia." });
      return;
    }
    if (replacing) setConfirmReplace(true);
    else mutation.mutate({ substituir: false });
  };

  return (
    <>
      <form className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3" onSubmit={handleSubmit} noValidate>
        <div>
          <p className="text-sm font-semibold text-slate-900">{replacing ? "Substituir a guia" : "Anexar a guia"}</p>
          <p className="text-xs text-slate-500">
            Anexe o PDF da guia (DARF ou guia estadual) ou cole a linha digitável. A guia não muda a situação de pagamento da parcela.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Como informar a guia">
          {MODES.map((item) => {
            const Icon = item.icon;
            const active = mode === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                disabled={busy}
                onClick={() => {
                  setMode(item.key);
                  clearFeedback();
                }}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                  active ? "border-slate-900 bg-white text-slate-900 shadow-sm" : "border-slate-200 bg-white/60 text-slate-500 hover:text-slate-800"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>

        {mode === "pdf" ? (
          <div className="space-y-1">
            <Label htmlFor="tax-guide-file" className="text-xs">PDF da guia</Label>
            <input
              id="tax-guide-file"
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            {file ? (
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{formatFileSize(file.size)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  title="Tirar o arquivo"
                  aria-label="Tirar o arquivo"
                  disabled={busy}
                  onClick={() => setFile(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("gap-1.5 bg-white", errors.file && "border-rose-400")}
                aria-invalid={Boolean(errors.file)}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-3.5 w-3.5" /> Escolher o PDF
              </Button>
            )}
            <p className="text-[11px] text-slate-500">
              Só PDF, até {formatFileSize(MAX_GUIDE_FILE_BYTES)}. O sistema lê a linha digitável do arquivo; se não conseguir, você poderá
              informá-la depois.
            </p>
            <FieldError message={errors.file} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="tax-guide-line" className="text-xs">Linha digitável</Label>
            <Input
              id="tax-guide-line"
              inputMode="numeric"
              autoComplete="off"
              className={cn("h-9 bg-white font-mono text-sm", errors.linha_digitavel && "border-rose-400 focus-visible:ring-rose-400")}
              aria-invalid={Boolean(errors.linha_digitavel)}
              value={line}
              onChange={(event) => {
                setLine(event.target.value);
                clearFeedback();
              }}
              placeholder="85800000001-2 34560328202-6 …"
            />
            <p className="text-[11px] text-slate-500">Os 48 números impressos na guia. Pode colar com espaços, pontos ou traços.</p>
            <FieldError message={errors.linha_digitavel} />
          </div>
        )}

        <div className="space-y-1 sm:max-w-[220px]">
          <Label htmlFor="tax-guide-pay-by" className="text-xs">Pagar até (opcional)</Label>
          <Input
            id="tax-guide-pay-by"
            type="date"
            className={cn("h-9 bg-white", errors.pagar_ate && "border-rose-400 focus-visible:ring-rose-400")}
            aria-invalid={Boolean(errors.pagar_ate)}
            value={payBy}
            onChange={(event) => {
              setPayBy(event.target.value);
              clearFeedback();
            }}
          />
          <FieldError message={errors.pagar_ate} />
        </div>

        {serverError ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{serverError}</p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancelar</Button>
          ) : null}
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Enviando a guia…" : replacing ? "Substituir guia" : "Anexar guia"}
          </Button>
        </div>
      </form>

      <TaxConfirmDialog
        open={confirmReplace}
        title="Substituir a guia atual?"
        description="A guia atual sai da parcela e fica no histórico, com o PDF. A nova guia passa a valer para esta parcela. A situação de pagamento da parcela não muda."
        confirmLabel="Substituir guia"
        tone="neutral"
        busy={busy}
        busyLabel="Substituindo…"
        onConfirm={() => mutation.mutate({ substituir: true })}
        onCancel={() => setConfirmReplace(false)}
      />
    </>
  );
}
