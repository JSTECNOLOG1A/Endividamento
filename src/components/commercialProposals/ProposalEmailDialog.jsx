import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "@/lib/notify";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Mail, Paperclip, Send } from "lucide-react";

const MESSAGE_MAX_LENGTH = 2000;
const RECIPIENT_NAME_MAX_LENGTH = 120;
const MAX_PDF_BYTES = 3 * 1024 * 1024;

const emailSchema = z.string().trim().min(1, "Informe o e-mail do destinatário.").max(254, "E-mail inválido.").email("E-mail inválido.");

// O servidor recebe o arquivo como texto (base64 puro, sem o prefixo
// "data:"). A conversão vai em blocos para não estourar a pilha com
// String.fromCharCode em arquivos grandes.
function pdfToBase64(doc) {
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), size: bytes.length };
}

// Janela de envio da proposta comercial salva ao cliente, com o PDF completo
// anexado. `buildPdf` devolve o documento jsPDF já montado — o mesmo usado no
// botão "Baixar PDF" — e só é chamado no clique em "Enviar".
export default function ProposalEmailDialog({ open, onOpenChange, proposalId, defaultRecipientName, fileName, buildPdf, onSent }) {
  const [recipientName, setRecipientName] = useState("");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (!open) return;
    setRecipientName(String(defaultRecipientName || "").slice(0, RECIPIENT_NAME_MAX_LENGTH));
    setTo("");
    setMessage("");
    setEmailError("");
    setServerError("");
  }, [open]);

  const sendMutation = useMutation({
    mutationFn: ({ recipient, name, text }) => {
      const { base64, size } = pdfToBase64(buildPdf());
      if (size > MAX_PDF_BYTES) {
        const error = new Error("O arquivo da proposta passou de 3 MB e não pode ser anexado ao e-mail.");
        error.code = "PDF_TOO_LARGE";
        throw error;
      }
      return commercialProposalsApi.sendEmail(proposalId, {
        to: recipient,
        // Sempre enviado: vazio significa "sem nome" (saudação genérica), e
        // não "usar o contato da proposta".
        nomeDestinatario: name,
        mensagem: text || undefined,
        pdfBase64: base64,
        nomeArquivo: fileName,
      });
    },
    onSuccess: (result, { recipient }) => {
      // O e-mail saiu e foi registrado; `warning` avisa que algo depois disso
      // não se concluiu. A janela fecha do mesmo jeito — reenviar duplicaria.
      if (result?.warning?.message) {
        toast.warning(`Proposta enviada para ${recipient}.`, { description: result.warning.message });
      } else {
        toast.success(`Proposta enviada para ${recipient}.`);
      }
      onSent?.(result);
      onOpenChange(false);
    },
    onError: (error) => {
      const text = error.data?.error || error.message || "Não foi possível enviar a proposta. Tente novamente.";
      if (error.code === "EMAIL_SENT_NOT_RECORDED") {
        // O e-mail já saiu: manter a janela aberta com o botão "Enviar"
        // convidaria a um segundo envio ao cliente.
        toast.warning(text);
        onSent?.(null);
        onOpenChange(false);
        return;
      }
      setServerError(text);
    },
  });

  const sending = sendMutation.isPending;

  const handleSend = () => {
    if (sending) return;
    setServerError("");
    const parsed = emailSchema.safeParse(to);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message || "E-mail inválido.");
      return;
    }
    setEmailError("");
    sendMutation.mutate({ recipient: parsed.data, name: recipientName.trim(), text: message.trim() });
  };

  const handleOpenChange = (next) => {
    if (sending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="w-4 h-4" /> Enviar proposta por e-mail</DialogTitle>
          <DialogDescription>
            O cliente recebe a proposta completa em PDF, igual à que está salva.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 py-1"
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          noValidate
        >
          <div className="space-y-1">
            <Label htmlFor="proposal-email-name" className="text-xs text-slate-500">Nome do destinatário (opcional)</Label>
            <Input
              id="proposal-email-name"
              autoComplete="name"
              className="h-9 text-sm"
              value={recipientName}
              maxLength={RECIPIENT_NAME_MAX_LENGTH}
              disabled={sending}
              aria-describedby="proposal-email-name-hint"
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Ex.: Maria da Silva"
            />
            <p id="proposal-email-name-hint" className="text-[11px] text-slate-500">
              Usado na saudação do e-mail. Se ficar em branco, o e-mail começa com &quot;Prezados&quot;.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="proposal-email-to" className="text-xs text-slate-500">E-mail do destinatário</Label>
            <Input
              id="proposal-email-to"
              type="email"
              autoComplete="email"
              className="h-9 text-sm"
              value={to}
              disabled={sending}
              aria-invalid={emailError ? "true" : undefined}
              aria-describedby={emailError ? "proposal-email-to-error" : undefined}
              onChange={(e) => { setTo(e.target.value); if (emailError) setEmailError(""); }}
              placeholder="nome@empresa.com.br"
              autoFocus
            />
            {emailError && (
              <p id="proposal-email-to-error" className="text-xs text-red-600">{emailError}</p>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="proposal-email-message" className="text-xs text-slate-500">Mensagem (opcional)</Label>
              <span className={`text-[11px] ${message.length >= MESSAGE_MAX_LENGTH ? "text-amber-700" : "text-slate-400"}`}>
                {message.length}/{MESSAGE_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="proposal-email-message"
              rows={4}
              className="text-sm resize-none"
              value={message}
              maxLength={MESSAGE_MAX_LENGTH}
              disabled={sending}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escreva algumas palavras para acompanhar a proposta."
            />
          </div>

          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <Paperclip className="w-4 h-4 shrink-0 text-slate-500" />
            <span className="truncate" title={fileName}>{fileName}</span>
          </div>

          {serverError && (
            <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {serverError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={sending}>Cancelar</Button>
            <Button type="submit" className="gap-1.5" disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? "Enviando..." : "Enviar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
