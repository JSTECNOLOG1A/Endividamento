// Rótulos e classes de exibição para o status de um LoanContract.
//
// Fluxo atual:
//   Editando (autosave local, não persistido) --Salvar como Rascunho--> Rascunho
//   Rascunho --Enviar para Revisão--> Pendente
//   Pendente --Aprovar--> Aprovado
//   Pendente --Devolver (comentário obrigatório)--> Devolvido para Correção
//   Devolvido para Correção --Continuar editando + Enviar--> Pendente
//
// "rascunho" só existe ANTES do primeiro envio para aprovação; depois disso
// o contrato nunca mais volta a esse status — uma recusa vira "devolvido",
// um status próprio (não reaproveita "rascunho" nem "cancelado").
//
// "cancelado" é um status diferente e não faz parte deste fluxo — é usado
// só na renovação de Conta Garantida (o contrato antigo é marcado assim
// quando substituído por um novo, ver backend/src/modules/functions/
// guaranteedAccount.js). Não confundir com "devolvido".
export const STATUS_LABELS = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente",
  aprovado: "Aprovado",
  devolvido: "Devolvido para Correção",
  cancelado: "Cancelado",
};

export const STATUS_BADGE_CLASSES = {
  rascunho: "bg-blue-100 text-blue-800 border-blue-200",
  pendente_aprovacao: "bg-amber-100 text-amber-800 border-amber-200",
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  devolvido: "bg-orange-100 text-orange-800 border-orange-200",
  cancelado: "bg-red-100 text-red-800 border-red-200",
};

// Status a partir dos quais o contrato pode voltar para edição na Calculadora.
export const EDITABLE_STATUSES = ["rascunho", "devolvido"];

export function statusLabel(status) {
  return STATUS_LABELS[status] || status?.replace(/_/g, " ") || STATUS_LABELS.rascunho;
}

export function statusBadgeClass(status) {
  return STATUS_BADGE_CLASSES[status] || STATUS_BADGE_CLASSES.rascunho;
}
