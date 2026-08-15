import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, CheckCircle, XCircle, Copy, Edit } from "lucide-react";

export default function ContractWorkflow({ contract, user, onStatusChange, onDuplicate }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [action, setAction] = useState(null);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(false);

  const canEdit = contract.status === "rascunho";
  const canSendApproval = contract.status === "rascunho";
  const canApprove = contract.status === "pendente_aprovacao" && user?.role === "admin";
  const canReject = contract.status === "pendente_aprovacao" && user?.role === "admin";
  const canReopen = contract.status === "aprovado" && user?.role === "admin";
  const canCancel = ["rascunho", "pendente_aprovacao"].includes(contract.status);

  const addToHistory = (newStatus, comments = "") => {
    const history = contract.status_history ? JSON.parse(contract.status_history) : [];
    history.push({
      from: contract.status,
      to: newStatus,
      by: user?.email,
      at: new Date().toISOString(),
      comments,
    });
    return JSON.stringify(history);
  };

  const handleAction = async () => {
    if (action === "reject" && !comments.trim()) {
      alert("Comentários são obrigatórios ao recusar");
      return;
    }

    // Validar PDF obrigatório para envio de aprovação
    if (action === "send_approval" && !contract.contract_pdf_url) {
      alert("⚠️ É obrigatório anexar o PDF do contrato antes de enviar para aprovação");
      return;
    }

    setLoading(true);
    try {
      let updateData = {};

      switch (action) {
        case "send_approval":
          updateData = {
            status: "pendente_aprovacao",
            status_history: addToHistory("pendente_aprovacao"),
          };
          break;
        case "approve":
          updateData = {
            status: "aprovado",
            approved_by: user?.email,
            approved_date: new Date().toISOString(),
            status_history: addToHistory("aprovado", comments),
          };
          break;
        case "reject":
          updateData = {
            status: "rascunho",
            rejection_comments: comments,
            status_history: addToHistory("rascunho", comments),
          };
          break;
        case "cancel":
          updateData = {
            status: "cancelado",
            status_history: addToHistory("cancelado", comments),
          };
          break;
        case "reopen":
          updateData = {
            status: "rascunho",
            status_history: addToHistory("rascunho", comments),
          };
          break;
      }

      await base44.entities.LoanContract.update(contract.id, updateData);

      // Se é reopen, redirecionar para o Simulator com os dados
      if (action === "reopen") {
        const contractData = encodeURIComponent(JSON.stringify({
          group_id: contract.group_id,
          entity_id: contract.entity_id,
          bank_id: contract.bank_id,
          currency_id: contract.currency_id,
          contract_number: contract.contract_number,
          operation_type: contract.operation_type,
          operation_value: contract.operation_value,
          signal_value: contract.signal_value,
          iof_value: contract.iof_value,
          iof_financed: contract.iof_financed,
          other_fees: contract.other_fees,
          other_fees_financed: contract.other_fees_financed,
          fixed_rate: contract.fixed_rate,
          indexer: contract.indexer,
          indexer_spread: contract.indexer_spread,
          operation_date: contract.operation_date,
          first_payment_date: contract.first_payment_date,
          principal_grace_months: contract.principal_grace_months,
          interest_grace_months: contract.interest_grace_months,
          grace_action: contract.grace_action,
          principal_installments: contract.principal_installments,
          interest_installments: contract.interest_installments,
          principal_frequency: contract.principal_frequency,
          interest_frequency: contract.interest_frequency,
          calculation_system: contract.calculation_system,
        }));
        window.location.href = `/Simulator?edit=${contract.id}`;
      } else {
        setDialogOpen(false);
        setComments("");
        if (onStatusChange) onStatusChange();
      }
    } catch (error) {
      alert("Erro ao atualizar status: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const openDialog = (actionType) => {
    setAction(actionType);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {canSendApproval && (
          <Button
            size="sm"
            variant="default"
            onClick={() => openDialog("send_approval")}
            className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700"
          >
            <Send className="w-3.5 h-3.5" />
            Enviar para Aprovação
          </Button>
        )}
        {canApprove && (
          <Button
            size="sm"
            variant="default"
            onClick={() => openDialog("approve")}
            className="gap-1.5 text-xs bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Aprovar
          </Button>
        )}
        {canReject && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => openDialog("reject")}
            className="gap-1.5 text-xs"
          >
            <XCircle className="w-3.5 h-3.5" />
            Recusar
          </Button>
        )}
        {canReopen && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openDialog("reopen")}
            className="gap-1.5 text-xs"
          >
            <Edit className="w-3.5 h-3.5" />
            Reabrir para Edição
          </Button>
        )}
         {canCancel && (
           <Button
             size="sm"
             variant="outline"
             onClick={() => openDialog("cancel")}
             className="gap-1.5 text-xs"
           >
             Cancelar Contrato
           </Button>
         )}
        <Button
          size="sm"
          variant="outline"
          onClick={onDuplicate}
          className="gap-1.5 text-xs"
        >
          <Copy className="w-3.5 h-3.5" />
          Duplicar
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "send_approval" && "Enviar para Aprovação"}
              {action === "approve" && "Aprovar Contrato"}
              {action === "reject" && "Recusar Contrato"}
              {action === "cancel" && "Cancelar Contrato"}
              {action === "reopen" && "Reabrir Contrato para Edição"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {action === "send_approval" && (
              <p className="text-sm text-slate-600">
                O contrato será enviado para análise e aprovação. Deseja continuar?
              </p>
            )}
            {action === "reopen" && (
              <p className="text-sm text-slate-600">
                O contrato voltará ao status de rascunho e poderá ser editado novamente.
              </p>
            )}
            {(action === "approve" || action === "reject" || action === "cancel") && (
              <div className="space-y-2">
                <Label className="text-sm">
                  Comentários {action === "reject" && <span className="text-red-600">*</span>}
                </Label>
                <Textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder={action === "reject" ? "Obrigatório" : "Opcional"}
                  className="min-h-24"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button onClick={handleAction} disabled={loading}>
              {loading ? "Processando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}