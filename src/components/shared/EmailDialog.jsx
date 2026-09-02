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
      if (data?.status === "simulado") {
        toast.success("Registrado. O envio real de e-mail ainda não está configurado neste sistema — nenhum e-mail foi disparado de fato.");
      } else {
        toast.success("E-mail enviado.");
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
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            O envio real de e-mail ainda não está configurado neste sistema — por enquanto, isso só registra o
            pedido (visível em auditoria) com um link pro documento.
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
