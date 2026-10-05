import React from "react";
import { PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIGNALS } from "@/lib/taxSignal";
import { AGREEMENT_STATUS_LABELS, INSTALLMENT_STATUS_LABELS, conferenceLabel, originLabel } from "@/lib/taxLabels";

const SIGNAL_STYLES = {
  desatualizado: "border-slate-400 border-dashed bg-slate-100 text-slate-700",
  em_atraso: "border-rose-200 bg-rose-50 text-rose-700",
  aguardando_reconhecimento: "border-sky-200 bg-sky-50 text-sky-700",
  a_vencer: "border-amber-200 bg-amber-50 text-amber-800",
  em_dia: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const SITUATION_STYLES = {
  quitado: "border-slate-200 bg-slate-50 text-slate-600",
  rescindido: "border-rose-200 bg-white text-rose-700",
  suspenso: "border-slate-300 bg-white text-slate-700",
};

export const SIGNAL_DOT = {
  desatualizado: "bg-slate-400",
  em_atraso: "bg-rose-500",
  aguardando_reconhecimento: "bg-sky-500",
  a_vencer: "bg-amber-500",
  em_dia: "bg-emerald-500",
};

/** Rótulo de uma situação de lista: semáforo (acordo ativo) ou a própria situação do acordo. */
export function statusKeyLabel(statusKey) {
  return SIGNALS[statusKey]?.label || AGREEMENT_STATUS_LABELS[statusKey] || "—";
}

/**
 * Semáforo do acordo. Quando desatualizado, mostra abaixo o que os dados registrados indicam —
 * como informação secundária, nunca como o estado do acordo.
 */
export function TaxSignalBadge({ signal, recordsSignal, situacao, className }) {
  const key = signal || situacao;
  const style = SIGNAL_STYLES[signal] || SITUATION_STYLES[situacao] || SITUATION_STYLES.suspenso;
  return (
    <div className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold", style)}>
        {statusKeyLabel(key)}
      </span>
      {signal === "desatualizado" && recordsSignal ? (
        <span className="text-[11px] leading-tight text-slate-500">pelos dados registrados: {SIGNALS[recordsSignal].hint}</span>
      ) : null}
    </div>
  );
}

const INSTALLMENT_STYLES = {
  em_aberto: "border-slate-200 bg-white text-slate-700",
  paga_aguardando_reconhecimento: "border-sky-200 bg-sky-50 text-sky-700",
  reconhecida: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelada: "border-slate-200 bg-slate-50 text-slate-500 line-through",
};

export function InstallmentStatusBadge({ situacao, overdue }) {
  if (situacao === "em_aberto" && overdue) {
    return (
      <span className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
        Em aberto · vencida
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold", INSTALLMENT_STYLES[situacao])}>
      {INSTALLMENT_STATUS_LABELS[situacao] || "—"}
    </span>
  );
}

/** Procedência do dado: deixa claro que foi digitado à mão e quando foi conferido no e-CAC/portal. */
export function ProvenanceNote({ origem, ultimaConferencia, className }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] leading-tight text-slate-500", className)}>
      <PenLine className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {originLabel(origem)} · {conferenceLabel(ultimaConferencia)}
      </span>
    </span>
  );
}

/** Mensagem de erro sob um campo do formulário. */
export function FieldError({ message }) {
  if (!message) return null;
  return <p className="text-xs text-rose-600">{message}</p>;
}

/** Campo apontado pelo servidor num erro de validação (`code: TAX_VALIDATION`, `details.field`). */
export function serverErrorField(error) {
  if (error?.code !== "TAX_VALIDATION") return null;
  return error?.data?.details?.field || null;
}
