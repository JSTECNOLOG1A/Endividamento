import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, XCircle } from "lucide-react";
import { OUTCOME_TEXT_MAX_LENGTH, asSentence, isProposalClosedError, serverMessage } from "./proposalOutcome";

// Registro da recusa pelo cliente. Irreversível — a proposta fica travada —,
// por isso a janela pede o motivo e depois uma confirmação.
// `onDone(proposal | null)`: ver ProposalAcceptDialog.
export default function ProposalRejectDialog({ open, onOpenChange, proposal, onDone }) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [serverError, setServerError] = useState("");
  const [step, setStep] = useState("form"); // "form" | "confirm"

  useEffect(() => {
    if (!open) return;
    setReason("");
    setReasonError("");
    setServerError("");
    setStep("form");
  }, [open]);

  const rejectMutation = useMutation({
    mutationFn: (rejectionReason) => commercialProposalsApi.reject(proposal.id, { motivo_recusa: rejectionReason }),
    onSuccess: (updated) => {
      const numero = updated?.numero || proposal.numero;
      toast.success(numero ? `Recusa da proposta ${numero} registrada.` : "Recusa registrada.");
      onDone?.(updated);
      onOpenChange(false);
    },
    onError: (error) => {
      const text = serverMessage(error, "Não foi possível registrar a recusa. Tente novamente.");
      if (isProposalClosedError(error) || error.status === 404) {
        toast.error(text);
        onDone?.(null);
        onOpenChange(false);
        return;
      }
      setServerError(text);
      setStep("form");
    },
  });

  const saving = rejectMutation.isPending;
  const trimmed = reason.trim();

  const handleContinue = () => {
    setServerError("");
    if (!trimmed) {
      setReasonError("Informe o motivo da recusa.");
      return;
    }
    if (trimmed.length > OUTCOME_TEXT_MAX_LENGTH) {
      setReasonError(`O motivo pode ter no máximo ${OUTCOME_TEXT_MAX_LENGTH} caracteres.`);
      return;
    }
    setReasonError("");
    setStep("confirm");
  };

  const handleOpenChange = (next) => {
    if (saving) return;
    onOpenChange(next);
  };

  const proposalName = [proposal?.numero, proposal?.client_name].filter(Boolean).join(" — ");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="w-4 h-4" /> Recusar proposta
          </DialogTitle>
          <DialogDescription>
            {proposalName ? `${asSentence(`Proposta ${proposalName}`)} ` : ""}
            Registre aqui que o cliente não aceitou a proposta.
          </DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <form
            className="space-y-4 py-1"
            onSubmit={(e) => { e.preventDefault(); handleContinue(); }}
            noValidate
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="proposal-reject-reason" className="text-xs text-slate-500">Motivo da recusa</Label>
                <span className={`text-[11px] ${reason.length >= OUTCOME_TEXT_MAX_LENGTH ? "text-amber-700" : "text-slate-400"}`}>
                  {reason.length}/{OUTCOME_TEXT_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="proposal-reject-reason"
                rows={4}
                className="text-sm resize-none"
                maxLength={OUTCOME_TEXT_MAX_LENGTH}
                value={reason}
                aria-invalid={reasonError ? "true" : undefined}
                aria-describedby={reasonError ? "proposal-reject-reason-error" : undefined}
                onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(""); }}
                placeholder="Ex.: o cliente optou por outro fornecedor."
                autoFocus
              />
              {reasonError && <p id="proposal-reject-reason-error" className="text-xs text-red-600">{reasonError}</p>}
            </div>

            {serverError && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {serverError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Continuar</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4 py-1 text-sm">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
              <p className="font-semibold">Tem certeza de que deseja registrar a recusa?</p>
              <p className="text-xs mt-0.5">
                Isso não pode ser desfeito: a proposta não poderá mais ser alterada, enviada por e-mail nem aceita.
              </p>
            </div>
            <div>
              <div className="text-xs text-slate-500">Motivo da recusa</div>
              <p className="font-medium whitespace-pre-line break-words">{trimmed}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setStep("form")}>Voltar</Button>
              <Button type="button" variant="destructive" className="gap-1.5" disabled={saving} onClick={() => rejectMutation.mutate(trimmed)}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                {saving ? "Registrando..." : "Confirmar recusa"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
