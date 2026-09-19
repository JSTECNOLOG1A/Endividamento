-- Separa "devolvido" (recusa de aprovação, aguardando correção e reenvio)
-- de "cancelado" (retirada/substituição definitiva, ex.: renovação de Conta
-- Garantida em backend/src/modules/functions/guaranteedAccount.js). Os dois
-- eram a mesma coisa até aqui só na intenção documentada em
-- src/lib/contractStatus.js, nunca realmente implementada — o reject
-- continuava gravando "rascunho". Ver plano "Status Devolvido separado de
-- Rascunho (e de Cancelado)".
ALTER TABLE loan_contracts
  DROP CONSTRAINT loan_contracts_status_check,
  ADD CONSTRAINT loan_contracts_status_check
    CHECK (status IN ('rascunho', 'pendente_aprovacao', 'aprovado', 'cancelado', 'devolvido'));
