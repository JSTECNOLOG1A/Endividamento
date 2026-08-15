ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_origem_check;

ALTER TABLE chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_origem_check
  CHECK (origem IN ('manual', 'integrado'));
