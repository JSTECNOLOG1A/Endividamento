import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { formatDateTime } from "@/lib/taxGuides";
import { taxTitleInstallmentNote, taxTitleLink, taxTitleNotes, taxTitleStatusLabel, taxTitleTone } from "@/lib/taxTitles";

const TONE_STYLES = {
  warning: { dot: "bg-amber-400", text: "text-amber-800", box: "border-amber-200 bg-amber-50" },
  danger: { dot: "bg-rose-500", text: "text-rose-800", box: "border-rose-200 bg-rose-50" },
  success: { dot: "bg-emerald-500", text: "text-emerald-800", box: "border-emerald-200 bg-emerald-50" },
  info: { dot: "bg-sky-500", text: "text-sky-800", box: "border-sky-200 bg-sky-50" },
  neutral: { dot: "bg-slate-400", text: "text-slate-700", box: "border-slate-200 bg-slate-50" },
};

/** Selo da situação do título de tributo no Protheus (mesmo desenho do selo dos títulos de empréstimo). */
export function TaxTitleBadge({ title, className }) {
  const style = TONE_STYLES[taxTitleTone(title)];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span className={cn("inline-block size-2.5 shrink-0 rounded-full", style.dot)} aria-hidden="true" />
      <span className={cn("text-xs font-medium", style.text)}>{taxTitleStatusLabel(title)}</span>
      {title?.em_andamento ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          em andamento
        </span>
      ) : null}
    </span>
  );
}

/**
 * Motivo (o que o AllDebt decidiu), resposta do Protheus e, quando a baixa já atualizou a parcela, o aviso disso.
 * `compact` corta em uma linha cada.
 */
export function TaxTitleNotes({ title, compact = false, className }) {
  const { motivo, erpMensagem } = taxTitleNotes(title);
  const installmentNote = taxTitleInstallmentNote(title, formatDateTime);
  if (!motivo && !erpMensagem && !installmentNote) return null;
  const lineClass = compact ? "truncate" : "break-words";
  return (
    <div className={cn("min-w-0 space-y-0.5 text-[11px] leading-snug", className)}>
      {installmentNote ? (
        <p className={cn("font-medium text-emerald-800", lineClass)} title={compact ? installmentNote : undefined}>{installmentNote}</p>
      ) : null}
      {motivo ? (
        <p className={cn("text-slate-600", lineClass)} title={compact ? motivo : undefined}>{motivo}</p>
      ) : null}
      {erpMensagem ? (
        <p className={cn("text-slate-500", lineClass)} title={compact ? erpMensagem : undefined}>
          <span className="font-medium text-slate-600">Protheus:</span> {erpMensagem}
        </p>
      ) : null}
    </div>
  );
}

/** Atalho para o título em Contas a Pagar. */
export function TaxTitleLink({ title, children = "Ver em Contas a Pagar", className }) {
  if (!title?.id) return null;
  return (
    <Link
      to={taxTitleLink(title.id)}
      className={cn("inline-flex items-center gap-1 text-xs font-medium text-sky-700 underline-offset-2 hover:underline", className)}
    >
      {children}
      <ArrowRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

/** Célula da tabela de parcelas: situação do título no Protheus, motivo e atalho. */
export function TaxTitleCell({ title, isLoading, error }) {
  if (isLoading) return <span className="text-[11px] text-slate-400">Carregando…</span>;
  if (error) return <span className="text-[11px] text-slate-500">Indisponível</span>;
  if (!title) {
    return (
      <span className="text-[11px] text-slate-400" title="O título a pagar é criado quando a guia da parcela fica vinculada.">
        Sem título
      </span>
    );
  }
  return (
    <div className="flex max-w-[220px] flex-col items-start gap-0.5">
      <TaxTitleBadge title={title} />
      <TaxTitleNotes title={title} compact className="w-full" />
      <TaxTitleLink title={title} className="text-[11px]">Abrir título</TaxTitleLink>
    </div>
  );
}

/** Quadro do título a pagar na janela da guia. `title` null = ainda não há título para a parcela. */
export function TaxTitlePanel({ title }) {
  const style = TONE_STYLES[title ? taxTitleTone(title) : "neutral"];
  return (
    <section className={cn("rounded-lg border p-3", style.box)} aria-label="Título a pagar no Protheus">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Título a pagar no Protheus</p>
      {title ? (
        <div className="mt-1.5 space-y-1.5">
          <TaxTitleBadge title={title} />
          <TaxTitleNotes title={title} />
          <TaxTitleLink title={title} />
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-600">
          Ainda não há título a pagar para esta parcela. Ele é criado e enviado ao Protheus quando a guia fica vinculada
          à parcela, com o valor e o código de barras da guia.
        </p>
      )}
    </section>
  );
}

/** Código (de barras ou linha digitável) com botão de copiar. Copia só os dígitos. */
export function CopyableCode({ label, value, display }) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return <span className="text-slate-400">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(digits);
      toast.success(`${label} copiado(a).`);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  };
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <span className="min-w-0 break-all font-mono text-[12px] text-slate-800">{display || digits}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        title={`Copiar ${label.toLowerCase()}`}
        aria-label={`Copiar ${label.toLowerCase()}`}
        onClick={copy}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </span>
  );
}

/** Exclusão barrada pelo título de tributo no Protheus: os motivos por parcela e o caminho para resolver. */
export function TaxDeletionBlockedDialog({ reasons, onClose }) {
  return (
    <AlertDialog open={Boolean(reasons?.length)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nada foi excluído</AlertDialogTitle>
          <AlertDialogDescription>
            Antes de excluir, o título a pagar da parcela precisa sair do Protheus (estorno confirmado). Não foi possível por
            este motivo:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          {(reasons || []).map((reason) => (
            <li key={reason} className="break-words">{reason}</li>
          ))}
        </ul>
        <p className="text-xs text-slate-600">
          Os títulos de tributo ficam em{" "}
          <Link to="/AccountsPayable" className="font-medium text-sky-700 underline-offset-2 hover:underline" onClick={onClose}>
            Contas a Pagar
          </Link>
          , onde dá para consultar e acompanhar cada um.
        </p>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>Entendi</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
