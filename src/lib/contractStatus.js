// Rótulos e classes de exibição para o status de um LoanContract.
//
// Fluxo atual:
//   Editando (autosave local, não persistido) --Salvar--> Pendente
//   Pendente --Aprovar--> Aprovado
//   Pendente --Devolver (comentário obrigatório)--> Devolvido para Correção
//   Devolvido para Correção --Continuar editando + Salvar--> Pendente
//
// "cancelado" é o valor gravado no banco para "Devolvido para Correção" —
// não existe mais um cancelamento definitivo separado; o valor foi apenas
// reaproveitado para evitar uma migração de schema.
export const STATUS_LABELS = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente",
  aprovado: "Aprovado",
  cancelado: "Devolvido para Correção",
};

export const STATUS_BADGE_CLASSES = {
  rascunho: "bg-blue-100 text-blue-800 border-blue-200",
  pendente_aprovacao: "bg-amber-100 text-amber-800 border-amber-200",
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  cancelado: "bg-red-100 text-red-800 border-red-200",
};

// Status a partir dos quais o contrato pode voltar para edição na Calculadora.
// "rascunho" é mantido por compatibilidade com contratos antigos; no fluxo
// atual, um contrato só nasce no banco já como "pendente_aprovacao" (ao
// clicar em Salvar), então na prática o estado editável mais comum é
// "cancelado" (Devolvido para Correção).
export const EDITABLE_STATUSES = ["rascunho", "cancelado"];

export function statusLabel(status) {
  return STATUS_LABELS[status] || status?.replace(/_/g, " ") || STATUS_LABELS.rascunho;
}

export function statusBadgeClass(status) {
  return STATUS_BADGE_CLASSES[status] || STATUS_BADGE_CLASSES.rascunho;
}
