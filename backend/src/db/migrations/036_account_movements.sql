-- 036_account_movements.sql
-- Lançamentos (saques/pagamentos) de contas garantidas / capital de giro
-- rotativo — produto sem cronograma de amortização fixo: juros incidem
-- sobre o saldo utilizado, que sobe e desce livremente até o vencimento.
-- Cada vigência é um LoanContract normal (operation_type='conta_garantida',
-- final_maturity_date = vencimento contratado); ao renovar, quita-se esta e
-- cria-se uma nova, com o saldo remanescente entrando como lançamento
-- 'saldo_abertura' (ver backend/src/modules/functions/guaranteedAccount.js).

CREATE TABLE account_movements (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES loan_contracts(id) ON DELETE RESTRICT,
  movement_date DATE NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('saque', 'pagamento', 'saldo_abertura')),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  observacao TEXT,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE INDEX account_movements_contract_idx ON account_movements (contract_id, movement_date);
