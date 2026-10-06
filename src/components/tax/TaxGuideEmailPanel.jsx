import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Send, X, XCircle } from "lucide-react";
import { taxGuidesApi } from "@/api/taxGuides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { formatCivilDate } from "@/lib/taxDates";
import { formatMoney } from "@/lib/taxLabels";
import {
  GUIDE_MESSAGE_MAX,
  MAX_GUIDE_RECIPIENTS,
  amountComesFromGuide,
  amountToPay,
  guideSendBlock,
  isEmailAddress,
  isGuideException,
  joinList,
  mergeRecipients,
  splitRecipients,
} from "@/lib/taxGuides";
import { useInvalidateTax, useInvalidateTaxGuides } from "@/hooks/useTaxData";
import { FieldError } from "./TaxBadges";
import { GuideSendHistory } from "./TaxGuideHistory";

const RESULT_STYLES = {
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: CheckCircle2 },
  partial: { box: "border-amber-300 bg-amber-50 text-amber-900", icon: AlertTriangle },
  error: { box: "border-rose-200 bg-rose-50 text-rose-700", icon: XCircle },
};

function agencyLabel(agreement) {
  return agreement.esfera === "estadual" && agreement.uf ? `${agreement.orgao} — ${agreement.uf}` : agreement.orgao;
}

function PreviewRow({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[150px_1fr] sm:gap-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-xs text-slate-800">{children}</dd>
    </div>
  );
}

/** O que o e-mail leva: os mesmos dados que o servidor monta no corpo da mensagem. */
function EmailPreview({ installment, agreement, entityName, guide }) {
  const fromGuide = amountComesFromGuide(guide);
  const installmentLabel = agreement.qtd_parcelas ? `${installment.numero_parcela} de ${agreement.qtd_parcelas}` : String(installment.numero_parcela);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-900">O que vai no e-mail</p>
      <dl className="mt-1 divide-y divide-slate-100">
        <PreviewRow label="Empresa">{entityName}</PreviewRow>
        <PreviewRow label="Órgão">{agencyLabel(agreement)}</PreviewRow>
        {agreement.tributo ? <PreviewRow label="Tributo">{agreement.tributo}</PreviewRow> : null}
        <PreviewRow label="Parcelamento">nº {agreement.codigo_parcelamento}</PreviewRow>
        <PreviewRow label="Parcela">{installmentLabel}</PreviewRow>
        <PreviewRow label="Vencimento">{formatCivilDate(installment.vencimento)}</PreviewRow>
        {guide.pagar_ate ? <PreviewRow label="Pagar até">{formatCivilDate(guide.pagar_ate)}</PreviewRow> : null}
        <PreviewRow label={fromGuide ? "Valor a pagar" : "Valor estimado"}>
          <span className="font-semibold tabular-nums">{formatMoney(amountToPay(installment, guide))}</span>
          {fromGuide ? null : <span className="text-slate-500"> (a guia não traz o valor; o e-mail pede para pagar o valor impresso na guia)</span>}
        </PreviewRow>
        <PreviewRow label="Linha digitável">
          <span className="break-all font-mono">{guide.linha_digitavel_formatada || "—"}</span>
        </PreviewRow>
        <PreviewRow label="Anexo">
          {guide.tem_arquivo ? `Sim — o PDF da guia (${guide.arquivo_nome || "guia.pdf"})` : "Não — a guia foi informada pela linha digitável"}
        </PreviewRow>
      </dl>
    </div>
  );
}

const RATE_LIMIT_FALLBACK = "Muitos envios em pouco tempo. Aguarde um pouco e tente de novo.";

/**
 * Envio da guia por e-mail. Só fala em "enviado" quando o servidor confirmou; envio parcial e falha aparecem como
 * vieram do servidor. Guia em exceção ou parcela paga/cancelada: bloqueado, com o motivo.
 */
export default function TaxGuideEmailPanel({ installment, agreement, entityName, guide, onBack }) {
  const [recipients, setRecipients] = useState([]);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const invalidateGuides = useInvalidateTaxGuides();
  const invalidateTax = useInvalidateTax();

  const block = guideSendBlock(installment, guide);

  const mutation = useMutation({
    mutationFn: (list) => taxGuidesApi.sendEmail(installment.id, { destinatarios: list, mensagem: message.trim() }),
    onSuccess: async (response, list) => {
      const sentTo = joinList(response?.envio?.destinatarios || list);
      setResult({ kind: "success", message: `Guia enviada para ${sentTo}.` });
      toast.success(`Guia enviada para ${sentTo}.`);
      setRecipients([]);
      setMessage("");
      await invalidateGuides();
    },
    onError: async (error) => {
      const field = error.code === "VALIDATION" ? error.data?.details?.field : null;
      if (field === "destinatarios" || field === "mensagem") {
        setErrors({ [field]: error.message });
        return;
      }
      if (error.code === "EMAIL_SEND_PARTIAL") {
        // Parte dos destinatários recebeu: limpar a lista evita reenviar para quem já recebeu.
        setRecipients([]);
        setResult({ kind: "partial", message: error.message });
      } else if (error.code === "EMAIL_SENT_NOT_RECORDED") {
        setRecipients([]);
        setMessage("");
        setResult({ kind: "partial", message: error.message });
      } else if (error.code === "TAX_GUIDE_SEND_LIMIT" || error.status === 429) {
        // Limite de envios: a mensagem do servidor como veio (com o horário para tentar de novo); um 429 sem mensagem
        // (limite geral do sistema) nunca aparece como "HTTP 429".
        setResult({ kind: "error", message: error.data?.error || RATE_LIMIT_FALLBACK });
      } else {
        setResult({ kind: "error", message: error.message });
      }
      // O servidor confere a guia de novo na hora do envio e grava a tentativa no histórico: recarregar mostra o
      // estado atual (exceção nova, parcela já paga, envio registrado).
      if (error.code === "TAX_INSTALLMENT_CLOSED") await invalidateTax();
      else await invalidateGuides();
    },
  });

  const busy = mutation.isPending;
  const disabled = busy || !block.ok;

  // Leva o que está digitado para a lista; devolve a lista nova ou null se algum endereço for inválido.
  const commitDraft = () => {
    const typed = splitRecipients(draft);
    if (!typed.length) return recipients;
    const invalid = typed.filter((item) => !isEmailAddress(item));
    if (invalid.length) {
      setErrors({
        destinatarios:
          invalid.length === 1
            ? `"${invalid[0]}" não é um e-mail válido. Confira o endereço.`
            : `Estes endereços não são e-mails válidos: ${invalid.map((item) => `"${item}"`).join(", ")}. Confira os endereços.`,
      });
      return null;
    }
    const next = mergeRecipients(recipients, typed);
    if (next.length > MAX_GUIDE_RECIPIENTS) {
      setErrors({ destinatarios: `Informe no máximo ${MAX_GUIDE_RECIPIENTS} destinatários.` });
      return null;
    }
    setRecipients(next);
    setDraft("");
    setErrors({});
    return next;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (disabled) return;
    setResult(null);
    const list = commitDraft();
    if (!list) return;
    if (!list.length) {
      setErrors({ destinatarios: "Informe ao menos um e-mail de destinatário." });
      return;
    }
    if (message.trim().length > GUIDE_MESSAGE_MAX) {
      setErrors({ mensagem: `A mensagem pode ter no máximo ${GUIDE_MESSAGE_MAX} caracteres.` });
      return;
    }
    mutation.mutate(list);
  };

  const resultStyle = result ? RESULT_STYLES[result.kind] : null;
  const ResultIcon = resultStyle?.icon;

  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1.5 text-slate-600" disabled={busy} onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Voltar para a guia
      </Button>

      {!block.ok ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Esta guia não pode ser enviada agora
          </p>
          <p className="mt-1">{block.reason}</p>
          {isGuideException(guide) && guide.motivos?.length ? (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {guide.motivos.map((item) => <li key={item.codigo}>{item.mensagem}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div role="status" className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", resultStyle.box)}>
          <ResultIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{result.message}</p>
        </div>
      ) : null}

      {guide ? <EmailPreview installment={installment} agreement={agreement} entityName={entityName} guide={guide} /> : null}

      <form className="space-y-3" onSubmit={handleSubmit} noValidate>
        <div className="space-y-1">
          <Label htmlFor="tax-guide-recipients" className="text-xs">Para</Label>
          <div
            className={cn(
              "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-white px-2 py-1.5",
              errors.destinatarios ? "border-rose-400" : "border-input",
              disabled && "opacity-60"
            )}
          >
            {recipients.map((item) => (
              <span key={item} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                <span className="min-w-0 truncate">{item}</span>
                <button
                  type="button"
                  className="shrink-0 rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                  aria-label={`Tirar ${item}`}
                  disabled={disabled}
                  onClick={() => setRecipients((current) => current.filter((value) => value !== item))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Input
              id="tax-guide-recipients"
              type="text"
              inputMode="email"
              autoComplete="off"
              disabled={disabled}
              aria-invalid={Boolean(errors.destinatarios)}
              className="h-7 min-w-[10rem] flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
              value={draft}
              placeholder={recipients.length ? "Outro e-mail" : "financeiro@empresa.com.br"}
              onChange={(event) => {
                setDraft(event.target.value);
                if (errors.destinatarios) setErrors({});
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "," || event.key === ";") {
                  event.preventDefault();
                  commitDraft();
                }
                if (event.key === "Backspace" && !draft && recipients.length) {
                  setRecipients((current) => current.slice(0, -1));
                }
              }}
              onBlur={() => {
                if (draft.trim()) commitDraft();
              }}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Digite um ou mais e-mails (até {MAX_GUIDE_RECIPIENTS}), separados por vírgula ou Enter. As respostas vão para o seu e-mail.
          </p>
          <FieldError message={errors.destinatarios} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="tax-guide-message" className="text-xs">Mensagem (opcional)</Label>
          <Textarea
            id="tax-guide-message"
            rows={3}
            disabled={disabled}
            maxLength={GUIDE_MESSAGE_MAX}
            aria-invalid={Boolean(errors.mensagem)}
            className={cn("bg-white text-sm", errors.mensagem && "border-rose-400")}
            value={message}
            placeholder="Ex.: Por favor, programar o pagamento até o vencimento."
            onChange={(event) => {
              setMessage(event.target.value);
              if (errors.mensagem) setErrors({});
            }}
          />
          <p className="text-right text-[11px] text-slate-500">{message.length}/{GUIDE_MESSAGE_MAX}</p>
          <FieldError message={errors.mensagem} />
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" className="w-full gap-1.5 sm:w-auto" disabled={disabled}>
            <Send className="h-4 w-4" />
            {busy ? "Enviando…" : "Enviar guia por e-mail"}
          </Button>
        </div>
      </form>

      <GuideSendHistory installmentId={installment.id} />
    </div>
  );
}
