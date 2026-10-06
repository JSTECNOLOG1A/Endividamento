import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Copy, Download, ExternalLink, Loader2, Mail, Replace, Trash2 } from "lucide-react";
import { taxGuidesApi } from "@/api/taxGuides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { downloadPdf } from "@/lib/documentActions";
import { formatCivilDate, todayInBrazil } from "@/lib/taxDates";
import { formatMoney } from "@/lib/taxLabels";
import {
  amountComesFromGuide,
  amountToPay,
  canCorrectGuide,
  exceptionHint,
  formatDateTime,
  formatFileSize,
  guideLineSourceLabel,
  guideOriginLabel,
  isGuideException,
  needsManualLine,
} from "@/lib/taxGuides";
import { useInstallmentGuide, useInvalidateTaxGuides } from "@/hooks/useTaxData";
import { FieldError, GuideStatusBadge, InstallmentStatusBadge, serverErrorField } from "./TaxBadges";
import { TaxErrorState } from "./TaxPageShell";
import { GuideSendHistory, PreviousGuides, openGuidePdf } from "./TaxGuideHistory";
import TaxGuideAttachForm from "./TaxGuideAttachForm";
import TaxGuideEmailPanel from "./TaxGuideEmailPanel";
import TaxConfirmDialog from "./TaxConfirmDialog";

function Info({ label, className, children }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{children}</dd>
    </div>
  );
}

/** Linha não lida e/ou "pagar até" fora do mês: corrige os dados da própria guia, sem anexar outra. */
function GuideCorrectionForm({ installmentId, guide }) {
  const askLine = needsManualLine(guide);
  const [line, setLine] = useState("");
  const [payBy, setPayBy] = useState(guide.pagar_ate || "");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const invalidateGuides = useInvalidateTaxGuides();

  const mutation = useMutation({
    mutationFn: (changes) => taxGuidesApi.correct(installmentId, changes),
    onSuccess: async (result) => {
      if (isGuideException(result?.guia)) toast.warning("Guia corrigida, mas ela ainda está em exceção. Confira os motivos.");
      else toast.success("Guia corrigida e vinculada à parcela.");
      await invalidateGuides();
    },
    onError: (error) => {
      const field = serverErrorField(error);
      if (field) setErrors({ [field]: error.message });
      else setServerError(error.message);
    },
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    setErrors({});
    setServerError("");
    const changes = {};
    if (askLine && line.trim()) changes.linha_digitavel = line.trim();
    if (payBy !== (guide.pagar_ate || "")) changes.pagar_ate = payBy || null;
    if (!Object.keys(changes).length) {
      setErrors(
        askLine
          ? { linha_digitavel: "Informe a linha digitável impressa na guia." }
          : { pagar_ate: "Informe a data de “pagar até” impressa na guia." }
      );
      return;
    }
    mutation.mutate(changes);
  };

  const busy = mutation.isPending;

  return (
    <form className="mt-3 space-y-3 border-t border-amber-200 pt-3" onSubmit={handleSubmit} noValidate>
      <p className="text-xs font-semibold text-amber-900">Corrigir os dados da guia</p>
      {askLine ? (
        <div className="space-y-1">
          <Label htmlFor="tax-guide-fix-line" className="text-xs">Linha digitável</Label>
          <Input
            id="tax-guide-fix-line"
            inputMode="numeric"
            autoComplete="off"
            className={cn("h-9 bg-white font-mono text-sm", errors.linha_digitavel && "border-rose-400 focus-visible:ring-rose-400")}
            aria-invalid={Boolean(errors.linha_digitavel)}
            value={line}
            placeholder="85800000001-2 34560328202-6 …"
            onChange={(event) => {
              setLine(event.target.value);
              setErrors({});
              setServerError("");
            }}
          />
          <FieldError message={errors.linha_digitavel} />
        </div>
      ) : null}
      <div className="space-y-1 sm:max-w-[220px]">
        <Label htmlFor="tax-guide-fix-pay-by" className="text-xs">Pagar até</Label>
        <Input
          id="tax-guide-fix-pay-by"
          type="date"
          className={cn("h-9 bg-white", errors.pagar_ate && "border-rose-400 focus-visible:ring-rose-400")}
          aria-invalid={Boolean(errors.pagar_ate)}
          value={payBy}
          onChange={(event) => {
            setPayBy(event.target.value);
            setErrors({});
            setServerError("");
          }}
        />
        <FieldError message={errors.pagar_ate} />
      </div>
      {serverError ? (
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{serverError}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="w-full sm:w-auto" disabled={busy}>
          {busy ? "Salvando…" : "Salvar correção"}
        </Button>
      </div>
    </form>
  );
}

function ExceptionPanel({ installmentId, guide, canWrite }) {
  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="flex items-start gap-1.5 text-sm font-semibold text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Guia em exceção: confira antes de pagar
      </p>
      <ul className="mt-2 space-y-2">
        {guide.motivos.map((item) => (
          <li key={item.codigo} className="text-xs">
            <p className="font-medium text-amber-950">{item.mensagem}</p>
            <p className="mt-0.5 text-amber-800">O que fazer: {exceptionHint(item.codigo)}</p>
          </li>
        ))}
      </ul>
      {!guide.motivos.length ? (
        <p className="mt-1 text-xs text-amber-900">Confira a guia e, se precisar, substitua por outra.</p>
      ) : null}
      {canWrite && canCorrectGuide(guide) ? <GuideCorrectionForm key={guide.id} installmentId={installmentId} guide={guide} /> : null}
    </div>
  );
}

function amountNote(installment, guide) {
  if (amountComesFromGuide(guide)) return `valor da guia · estimado ${formatMoney(installment.valor)}`;
  if (isGuideException(guide)) return "valor cadastrado (estimado) — a guia está em exceção";
  return "valor cadastrado (estimado) — a guia não traz o valor";
}

function GuideDetails({ installment, guide, canWrite, onReplace, onRemove, onSend }) {
  const lineSource = guideLineSourceLabel(guide);

  const copyLine = async () => {
    try {
      await navigator.clipboard.writeText(guide.linha_digitavel);
      toast.success("Linha digitável copiada.");
    } catch {
      toast.error("Não foi possível copiar. Selecione a linha e copie à mão.");
    }
  };

  const download = async () => {
    try {
      await downloadPdf(() => taxGuidesApi.file(guide.id, { download: true }), guide.arquivo_nome || "guia.pdf");
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GuideStatusBadge guide={guide} />
        <span className="text-xs text-slate-500">{guideOriginLabel(guide)}</span>
      </div>

      {isGuideException(guide) ? <ExceptionPanel installmentId={installment.id} guide={guide} canWrite={canWrite} /> : null}

      <dl className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
        <Info label="Linha digitável" className="sm:col-span-2">
          {guide.linha_digitavel_formatada ? (
            <span className="flex items-start gap-2">
              <span className="min-w-0 break-all font-mono text-[13px]">{guide.linha_digitavel_formatada}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title="Copiar linha digitável"
                aria-label="Copiar linha digitável"
                onClick={copyLine}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </span>
          ) : (
            <span className="text-amber-800">Não foi lida do PDF</span>
          )}
          {lineSource ? <span className="block text-[11px] text-slate-500">{lineSource}</span> : null}
        </Info>
        <Info label="Valor para pagamento">
          <span className="font-semibold tabular-nums">{formatMoney(amountToPay(installment, guide))}</span>
          <span className="block text-[11px] text-slate-500">{amountNote(installment, guide)}</span>
        </Info>
        <Info label="Valor da guia">
          {guide.valor_guia !== null && guide.valor_guia !== undefined ? (
            <span className="tabular-nums">{formatMoney(guide.valor_guia)}</span>
          ) : (
            <span className="text-slate-500">A guia não traz o valor</span>
          )}
        </Info>
        <Info label="Pagar até">
          {guide.pagar_ate ? formatCivilDate(guide.pagar_ate) : <span className="text-slate-500">Não informado</span>}
        </Info>
        <Info label="Arquivo">
          {guide.tem_arquivo ? (
            <span>
              {guide.arquivo_nome || "guia.pdf"}
              {guide.arquivo_tamanho ? <span className="text-slate-500"> · {formatFileSize(guide.arquivo_tamanho)}</span> : null}
            </span>
          ) : (
            <span className="text-slate-500">Sem PDF (informada pela linha digitável)</span>
          )}
        </Info>
        <Info label="Anexada por" className="sm:col-span-2">
          {guide.criada_por_nome || guide.criada_por || "—"}
          <span className="text-slate-500"> em {formatDateTime(guide.created_date)}</span>
        </Info>
      </dl>

      <div className="flex flex-wrap gap-2">
        {guide.tem_arquivo ? (
          <>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => openGuidePdf(guide)}>
              <ExternalLink className="h-4 w-4" />
              Abrir PDF
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={download}>
              <Download className="h-4 w-4" />
              Baixar PDF
            </Button>
          </>
        ) : null}
        {canWrite ? (
          <>
            <Button type="button" size="sm" className="gap-1.5" onClick={onSend}>
              <Mail className="h-4 w-4" />
              Enviar por e-mail
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onReplace}>
              <Replace className="h-4 w-4" />
              Substituir guia
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 text-rose-600 hover:text-rose-700" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
              Remover guia
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function GuideDialogBody({ installment: listedInstallment, agreement, entityName, canWrite }) {
  const { data, isLoading, error, refetch } = useInstallmentGuide(listedInstallment.id);
  const [view, setView] = useState("detalhe");
  const [removing, setRemoving] = useState(false);
  const invalidateGuides = useInvalidateTaxGuides();
  const today = todayInBrazil();

  // A situação da parcela vem da leitura da guia, que é a mais recente.
  const installment = data?.parcela ? { ...listedInstallment, ...data.parcela } : listedInstallment;
  const guide = data?.guia || null;
  const history = data?.historico || [];

  const removeMutation = useMutation({
    mutationFn: () => taxGuidesApi.remove(installment.id),
    onSuccess: async () => {
      setRemoving(false);
      toast.success("Guia removida. Ela continua no histórico da parcela.");
      await invalidateGuides();
    },
    onError: (err) => {
      setRemoving(false);
      toast.error(err.message);
    },
  });

  let content;
  if (isLoading) {
    content = (
      <p className="flex items-center justify-center gap-2 p-6 text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Carregando a guia…
      </p>
    );
  } else if (error) {
    content = <TaxErrorState title="Não foi possível carregar a guia" message={error.message} onRetry={refetch} />;
  } else if (view === "enviar" && guide) {
    content = (
      <TaxGuideEmailPanel
        installment={installment}
        agreement={agreement}
        entityName={entityName}
        guide={guide}
        onBack={() => setView("detalhe")}
      />
    );
  } else {
    const replacing = view === "substituir" && Boolean(guide);
    content = (
      <div className="space-y-5">
        {replacing ? (
          <TaxGuideAttachForm
            installmentId={installment.id}
            replacing
            onDone={() => setView("detalhe")}
            onCancel={() => setView("detalhe")}
          />
        ) : guide ? (
          <GuideDetails
            installment={installment}
            guide={guide}
            canWrite={canWrite}
            onSend={() => setView("enviar")}
            onReplace={() => setView("substituir")}
            onRemove={() => setRemoving(true)}
          />
        ) : canWrite ? (
          <TaxGuideAttachForm installmentId={installment.id} replacing={false} onDone={() => setView("detalhe")} />
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
            Nenhuma guia anexada a esta parcela.
          </p>
        )}
        <PreviousGuides guides={history} />
        <GuideSendHistory installmentId={installment.id} />
      </div>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Guia da parcela {installment.numero_parcela}</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span>
                Vencimento {formatCivilDate(installment.vencimento)} · valor cadastrado {formatMoney(installment.valor)}
              </span>
              <InstallmentStatusBadge installment={installment} today={today} />
            </div>
            <p className="text-xs">A guia não muda a situação de pagamento da parcela.</p>
          </div>
        </DialogDescription>
      </DialogHeader>
      {content}
      <TaxConfirmDialog
        open={removing}
        title={`Remover a guia da parcela ${installment.numero_parcela}?`}
        description="A guia sai da parcela e fica no histórico, com o PDF. A situação de pagamento da parcela não muda."
        confirmLabel="Remover guia"
        busy={removeMutation.isPending}
        busyLabel="Removendo…"
        onConfirm={() => removeMutation.mutate()}
        onCancel={() => setRemoving(false)}
      />
    </>
  );
}

/** Guia de pagamento de uma parcela: ver, anexar, corrigir, substituir, remover e enviar por e-mail. */
export default function TaxGuideDialog({ installment, agreement, entityName, canWrite, onOpenChange }) {
  return (
    <Dialog open={Boolean(installment)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        {installment ? (
          <GuideDialogBody
            key={installment.id}
            installment={installment}
            agreement={agreement}
            entityName={entityName}
            canWrite={canWrite}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
