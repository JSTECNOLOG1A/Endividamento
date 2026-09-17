-- Renegociação de contrato e quitação antecipada com desconto — ver plano
-- "Renegociação de contrato e Quitação antecipada com desconto".
--
-- "renegociado": contrato antigo, virou só histórico — um contrato NOVO
-- nasce com o saldo (líquido de entrada) como principal, nos termos novos
-- do banco, linkado via renegotiated_from_id. Mesmo espírito do que
-- renewGuaranteedAccount() já faz pra Conta Garantida (que reaproveita
-- "cancelado" + nota em rejection_comments); aqui optamos por um status e
-- uma FK dedicados, pra permitir link cruzado confiável na tela em vez de
-- depender de texto livre.
--
-- "quitado": contrato encerrado antecipadamente (sem sucessor), depois de
-- aprovado — reaproveita o MESMO fluxo de aprovação de nível 1/2 já
-- existente pra contrato novo, então passa por 'pendente_aprovacao' antes.
ALTER TABLE loan_contracts
  DROP CONSTRAINT loan_contracts_status_check,
  ADD CONSTRAINT loan_contracts_status_check
    CHECK (status IN ('rascunho', 'pendente_aprovacao', 'aprovado', 'cancelado', 'devolvido', 'renegociado', 'quitado'));

ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS payoff_date DATE,
  ADD COLUMN IF NOT EXISTS renegotiated_from_id TEXT REFERENCES loan_contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_discount_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS settlement_discount_mode TEXT
    CHECK (settlement_discount_mode IS NULL OR settlement_discount_mode IN ('juros_futuros', 'percentual_saldo', 'valor_fixo'));

CREATE INDEX IF NOT EXISTS idx_loan_contracts_renegotiated_from ON loan_contracts(renegotiated_from_id);
