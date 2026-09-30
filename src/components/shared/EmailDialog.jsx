import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Mail } from "lucide-react";

// Dialog genérico de "enviar por e-mail" para qualquer PDF já anexado no
// sistema — usado hoje pela tela de Contratos (contract_pdf) e reaproveitável
// por qualquer outra tela que precise enviar um documento (comprovante de
// baixa, por exemplo), bastando passar o `document` no formato esperado.
//
// document: { documentType: string, id: string, label: string }
export default function EmailDialog({ open, onOpenChange, document }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) {
      toast.warning("Informe o e-mail do destinatário.");
      return;
    }
    setSending(true);
    try {
      const { data } = await base44.functions.invoke("sendDocumentByEmail", {
        document_type: document.documentType,
        document_id: document.id,
        to_email: email.trim(),
      });
      if (data?.status === "enviado") {
        toast.success("E-mail enviado.");
      } else if (data?.status === "falhou") {
        toast.error("Não foi possível enviar o e-mail agora. O pedido ficou registrado; tente novamente em alguns minutos.");
      } else {
        toast.success("Registrado. O envio real de e-mail ainda não está configurado neste sistema — nenhum e-mail foi disparado de fato.");
      }
      onOpenChange(false);
      setEmail("");
    } catch (err) {
      toast.error("Erro ao registrar envio: " + (err.message || "tente novamente"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="w-4 h-4" /> Enviar por e-mail</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-600">{document?.label}</p>
          <div className="space-y-1">
            <Label className="text-xs">E-mail do destinatário</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com" />
          </div>
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            O e-mail traz um link pro documento (não o PDF anexado). O pedido fica registrado em auditoria,
            enviado ou não.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancelar</Button>
          <Button type="button" onClick={handleSend} disabled={sending}>{sending ? "Enviando..." : "Enviar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
