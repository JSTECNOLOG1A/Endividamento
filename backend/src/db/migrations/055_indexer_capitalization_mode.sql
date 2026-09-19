ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS indexer_capitalization_mode TEXT;

ALTER TABLE loan_contracts
  DROP CONSTRAINT IF EXISTS loan_contracts_indexer_capitalization_check;
ALTER TABLE loan_contracts
  ADD CONSTRAINT loan_contracts_indexer_capitalization_check
  CHECK (indexer_capitalization_mode IN ('paga_junto', 'capitaliza_saldo'));

-- Preserva o comportamento de hoje: todo contrato (inclusive indexado)
-- sempre pagou CDI/SELIC + spread juntos, num valor só.
UPDATE loan_contracts
SET indexer_capitalization_mode = 'paga_junto'
WHERE indexer_capitalization_mode IS NULL;

ALTER TABLE loan_contracts
  ALTER COLUMN indexer_capitalization_mode SET DEFAULT 'paga_junto';
ALTER TABLE loan_contracts
  ALTER COLUMN indexer_capitalization_mode SET NOT NULL;
