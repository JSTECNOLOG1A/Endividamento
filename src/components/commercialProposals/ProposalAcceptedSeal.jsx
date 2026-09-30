import React, { useState } from "react";
import { toast } from "@/lib/notify";
import { openPdfInNewTab } from "@/lib/documentActions";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import { serverMessage } from "./proposalOutcome";

// "dd/mm" a partir do texto AAAA-MM-DD — sem new Date, que mudaria o dia pelo
// fuso.
function dayMonth(value) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}/${month}` : "";
}

// Selo da proposta aceita na lista: data da assinatura, quem assinou e, se
// houver, o atalho para abrir a cópia assinada.
export default function ProposalAcceptedSeal({ proposal }) {
  const [opening, setOpening] = useState(false);
  const date = dayMonth(proposal.data_assinatura);
  const signer = String(proposal.nome_assinante || "").trim();
  const text = [date ? `Aceita em ${date}` : "Aceita", signer ? `assinada por ${signer}` : ""].filter(Boolean).join(" · ");

  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await openPdfInNewTab(
        () => commercialProposalsApi.signedFile(proposal.id),
        proposal.arquivo_assinado_nome || (proposal.numero ? `Proposta ${proposal.numero} assinada` : "Proposta assinada")
      );
    } catch (error) {
      toast.error(serverMessage(error, "Não foi possível abrir a proposta assinada. Tente novamente."));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Badge variant="default" className="max-w-[16rem] whitespace-nowrap" title={text}>
        <span className="truncate">{text}</span>
      </Badge>
      {proposal.tem_arquivo_assinado && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Ver proposta assinada"
          aria-label="Ver proposta assinada"
          disabled={opening}
          onClick={handleOpen}
        >
          {opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
        </Button>
      )}
    </div>
  );
}
