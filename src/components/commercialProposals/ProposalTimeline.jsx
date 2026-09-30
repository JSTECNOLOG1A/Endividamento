import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { openPdfInNewTab } from "@/lib/documentActions";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FilePlus2, FileText, History, Loader2, MailCheck, MailX, Pencil, XCircle } from "lucide-react";
import { PROPOSAL_STATUS_LABELS, formatDateTimeLongBR, serverMessage } from "./proposalOutcome";

export function proposalHistoryQueryKey(proposalId) {
  return ["commercial-proposals", "history", proposalId];
}

const EVENT_META = {
  criada: { icon: FilePlus2, tone: "text-slate-500" },
  editada: { icon: Pencil, tone: "text-slate-500" },
  email_enviado: { icon: MailCheck, tone: "text-cyan-700" },
  email_falhou: { icon: MailX, tone: "text-amber-700" },
  aceita: { icon: CheckCircle2, tone: "text-emerald-700" },
  recusada: { icon: XCircle, tone: "text-red-700" },
};

function describeEvent(event) {
  const note = String(event.note || "").trim();
  switch (event.event_type) {
    case "criada":
      return "Proposta criada";
    case "editada":
      return "Proposta alterada";
    case "email_enviado":
      return note ? `Enviada por e-mail para ${note}` : "Enviada por e-mail";
    case "email_falhou":
      return note ? `Tentativa de envio para ${note} não deu certo` : "Tentativa de envio por e-mail não deu certo";
    case "aceita":
      return "Aceite registrado";
    case "recusada":
      return note ? `Recusada — motivo: ${note}` : "Recusada";
    default:
      return "Registro na proposta";
  }
}

// Linha extra de situação: aparece quando o evento traz a situação anterior e a
// nova, e elas diferem. Criação, aceite e recusa ficam de fora porque o texto
// do próprio evento já diz a situação resultante.
function statusChange(event) {
  if (["criada", "aceita", "recusada"].includes(event.event_type)) return null;
  const before = PROPOSAL_STATUS_LABELS[event.previous_value];
  const after = PROPOSAL_STATUS_LABELS[event.new_value];
  if (!before || !after || before === after) return null;
  return `Situação: ${before} → ${after}`;
}

function describeWhoAndWhen(event) {
  const who = event.actor_name || event.actor;
  const when = formatDateTimeLongBR(event.occurred_at);
  return [who ? `por ${who}` : "", when ? `em ${when}` : ""].filter(Boolean).join(" ");
}

// Cópia do PDF anexado naquele envio. Envios antigos não guardavam o arquivo:
// para eles o botão simplesmente não aparece.
function SentFileButton({ proposalId, event }) {
  const [opening, setOpening] = useState(false);
  if (!event.send_id || !event.send_has_file) return null;

  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const title = event.note ? `Proposta enviada para ${event.note}` : "Proposta enviada";
      await openPdfInNewTab(() => commercialProposalsApi.sentFile(proposalId, event.send_id), title);
    } catch (error) {
      toast.error(serverMessage(error, "Não foi possível abrir o PDF enviado. Tente novamente."));
    } finally {
      setOpening(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 gap-1 text-xs text-cyan-700 hover:text-cyan-800 shrink-0"
      title="Ver o PDF que foi enviado"
      disabled={opening}
      onClick={handleOpen}
    >
      {opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
      Ver PDF
    </Button>
  );
}

// Linha do tempo da proposta, do evento mais recente para o mais antigo — o
// servidor já devolve nessa ordem.
export default function ProposalTimeline({ proposalId }) {
  const { data: events, isLoading, isError } = useQuery({
    queryKey: proposalHistoryQueryKey(proposalId),
    queryFn: () => commercialProposalsApi.history(proposalId),
    enabled: Boolean(proposalId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando histórico...
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-slate-500 py-2">Não foi possível carregar o histórico agora.</p>;
  }

  if (!events?.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500 py-2">
        <History className="w-4 h-4" /> Nenhum registro no histórico desta proposta ainda.
      </p>
    );
  }

  return (
    <ol className="space-y-2.5">
      {events.map((event) => {
        const meta = EVENT_META[event.event_type] || { icon: History, tone: "text-slate-500" };
        const Icon = meta.icon;
        const change = statusChange(event);
        const whoAndWhen = describeWhoAndWhen(event);
        return (
          <li key={event.id} className="flex items-start gap-2">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.tone}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800 break-words whitespace-pre-line">{describeEvent(event)}</p>
              {change && <p className="text-xs text-slate-600">{change}</p>}
              {whoAndWhen && <p className="text-xs text-slate-500">{whoAndWhen}</p>}
            </div>
            <SentFileButton proposalId={proposalId} event={event} />
          </li>
        );
      })}
    </ol>
  );
}
