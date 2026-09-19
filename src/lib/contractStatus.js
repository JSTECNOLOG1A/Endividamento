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
//
// "renegociado": contrato amortizado (SAC/PRICE/etc, não Conta Garantida)
// encerrado por renegociação — vira só histórico, um contrato NOVO nasce
// com o saldo como principal (ver renegotiateContract() em
// backend/src/modules/functions/contractLifecycle.js, mesmo espírito do
// renewGuaranteedAccount() acima, mas com um link real via
// renegotiated_from_id em vez de nota em rejection_comments).
//
// "quitado": encerrado por quitação antecipada (com ou sem desconto) —
// passa por 'pendente_aprovacao' antes (mesma alçada de aprovação de um
// contrato novo) e só vira 'quitado' quando aprovado (ver
// settleContractEarly() no mesmo arquivo, e o hook em
// applyLoanContractRules() em backend/src/modules/entities/store.js).
export const STATUS_LABELS = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente",
  aprovado: "Aprovado",
  devolvido: "Devolvido para Correção",
  cancelado: "Cancelado",
  renegociado: "Renegociado",
  quitado: "Quitado Antecipadamente",
};

export const STATUS_BADGE_CLASSES = {
  rascunho: "bg-blue-100 text-blue-800 border-blue-200",
  pendente_aprovacao: "bg-amber-100 text-amber-800 border-amber-200",
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  devolvido: "bg-orange-100 text-orange-800 border-orange-200",
  cancelado: "bg-red-100 text-red-800 border-red-200",
  renegociado: "bg-slate-100 text-slate-700 border-slate-300",
  quitado: "bg-cyan-100 text-cyan-800 border-cyan-200",
};

// Status a partir dos quais o contrato pode voltar para edição na Calculadora.
export const EDITABLE_STATUSES = ["rascunho", "devolvido"];

// `contract` é opcional — quando informado e o status for "pendente_aprovacao"
// com o nível 1 já registrado, mostra o sub-estado da alçada em 2 níveis
// (ver ContractWorkflow.jsx). Não é um status novo no banco, só um rótulo.
export function statusLabel(status, contract) {
  if (status === "pendente_aprovacao" && contract?.level1_approved_at) {
    return "Pendente — aguardando nível 2";
  }
  return STATUS_LABELS[status] || status?.replace(/_/g, " ") || STATUS_LABELS.rascunho;
}

export function statusBadgeClass(status) {
  return STATUS_BADGE_CLASSES[status] || STATUS_BADGE_CLASSES.rascunho;
}
