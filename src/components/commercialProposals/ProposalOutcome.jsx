import React, { useState } from "react";
import { toast } from "@/lib/notify";
import { downloadPdf, openPdfInNewTab } from "@/lib/documentActions";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Download, Eye, Loader2, XCircle } from "lucide-react";
import {
  acceptanceChannelLabel,
  asSentence,
  formatDateOnlyBR,
  formatDateTimeLongBR,
  formatFileSize,
  serverMessage,
} from "./proposalOutcome";

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium text-slate-800 break-words">{children}</div>
    </div>
  );
}

function registeredBy(prefix, name, email, timestamp) {
  const who = name || email;
  const when = formatDateTimeLongBR(timestamp);
  if (!who && !when) return null;
  return asSentence(`${prefix}${who ? ` por ${who}` : ""}${when ? ` em ${when}` : ""}`);
}

function SignedFileActions({ proposal }) {
  const [busy, setBusy] = useState(null); // "open" | "download" | null
  const fileName = proposal.arquivo_assinado_nome || `Proposta-${proposal.numero || "assinada"}-assinada.pdf`;

  const run = async (kind) => {
    if (busy) return;
    setBusy(kind);
    try {
      const load = () => commercialProposalsApi.signedFile(proposal.id);
      if (kind === "open") await openPdfInNewTab(load, fileName);
      else await downloadPdf(load, fileName);
    } catch (error) {
      toast.error(serverMessage(error, "Não foi possível abrir a proposta assinada. Tente novamente."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-slate-500">Proposta assinada</div>
      <p className="text-sm text-slate-700 break-all">
        {fileName}
        {proposal.arquivo_assinado_tamanho ? <span className="text-slate-500"> · {formatFileSize(proposal.arquivo_assinado_tamanho)}</span> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={Boolean(busy)} onClick={() => run("open")}>
          {busy === "open" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
          Ver
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={Boolean(busy)} onClick={() => run("download")}>
          {busy === "download" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Baixar
        </Button>
      </div>
    </div>
  );
}

// Desfecho registrado da proposta: aceite (com os dados da assinatura) ou
// recusa (com o motivo). Proposta ainda aberta não mostra nada.
export default function ProposalOutcome({ proposal }) {
  if (proposal?.status === "aceita") {
    const signer = [proposal.nome_assinante, proposal.cargo_assinante].filter(Boolean).join(" — ");
    const audit = registeredBy("Aceite registrado", proposal.accepted_by_name, proposal.accepted_by_email, proposal.accepted_at);
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 space-y-3 text-sm">
        <p className="flex items-center gap-2 font-semibold text-emerald-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> Aceita pelo cliente
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Data da assinatura">{formatDateOnlyBR(proposal.data_assinatura)}</Field>
          <Field label="Como o cliente devolveu">{acceptanceChannelLabel(proposal.canal_aceite)}</Field>
          <div className="sm:col-span-2">
            <Field label="Assinada por">{signer || "—"}</Field>
          </div>
          {proposal.observacao_aceite ? (
            <div className="sm:col-span-2">
              <Field label="Observação"><span className="font-normal whitespace-pre-line">{proposal.observacao_aceite}</span></Field>
            </div>
          ) : null}
        </div>
        {proposal.tem_arquivo_assinado ? (
          <SignedFileActions proposal={proposal} />
        ) : (
          <p className="text-xs text-slate-500">Nenhuma cópia assinada foi anexada.</p>
        )}
        {audit ? <p className="text-xs text-slate-500">{audit}</p> : null}
      </div>
    );
  }

  if (proposal?.status === "recusada") {
    const audit = registeredBy("Recusa registrada", proposal.rejected_by_name, proposal.rejected_by_email, proposal.rejected_at);
    return (
      <div className="rounded-md border border-red-200 bg-red-50/60 p-3 space-y-3 text-sm">
        <p className="flex items-center gap-2 font-semibold text-red-800">
          <XCircle className="w-4 h-4 shrink-0" /> Recusada pelo cliente
        </p>
        <Field label="Motivo da recusa">
          <span className="font-normal whitespace-pre-line">{proposal.motivo_recusa || "—"}</span>
        </Field>
        {audit ? <p className="text-xs text-slate-500">{audit}</p> : null}
      </div>
    );
  }

  return null;
}
