import React from "react";
import { useQuery } from "@tanstack/react-query";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { Loader2, MailCheck } from "lucide-react";

function proposalSendsQueryKey(proposalId) {
  return ["commercial-proposals", "sends", proposalId];
}

function formatSentAt(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("pt-BR");
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return ` em ${day} às ${time}`;
}

function describeSend(send) {
  const sender = send.sent_by_name || send.sent_by_email;
  const name = String(send.recipient_name || "").trim();
  const recipient = name ? `${name} (${send.recipient_email})` : send.recipient_email;
  return `Enviada para ${recipient}${formatSentAt(send.created_date)}${sender ? ` por ${sender}` : ""}`;
}

// Envios bem-sucedidos da proposta, do mais recente para o mais antigo — o
// servidor já devolve nessa ordem. Tentativas que falharam não entram: a
// pessoa já viu o erro na hora do envio.
export default function ProposalSendHistory({ proposalId }) {
  const { data: sends, isLoading, isError } = useQuery({
    queryKey: proposalSendsQueryKey(proposalId),
    queryFn: () => commercialProposalsApi.listSends(proposalId),
    enabled: Boolean(proposalId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando envios...
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-slate-500 py-2">Não foi possível carregar o histórico de envios agora.</p>;
  }

  const delivered = (sends || []).filter((s) => s.result === "enviado");
  if (!delivered.length) {
    return <p className="text-sm text-slate-500 py-2">Esta proposta ainda não foi enviada por e-mail.</p>;
  }

  const [latest, ...older] = delivered;
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-md border border-cyan-200 bg-cyan-50/60 px-3 py-2">
        <MailCheck className="w-4 h-4 mt-0.5 shrink-0 text-cyan-700" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 break-words">{describeSend(latest)}</p>
          <p className="text-xs text-slate-500">Envio mais recente</p>
        </div>
      </div>
      {older.length > 0 && (
        <ul className="space-y-1 pl-1">
          {older.map((send) => (
            <li key={send.id} className="text-xs text-slate-600 break-words">{describeSend(send)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
