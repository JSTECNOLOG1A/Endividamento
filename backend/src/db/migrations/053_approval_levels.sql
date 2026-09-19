ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_level SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_approval_level_check;
ALTER TABLE users
  ADD CONSTRAINT users_approval_level_check CHECK (approval_level IN (0, 1, 2));

-- Preserva quem já podia aprovar contratos hoje (admins) no nível máximo.
UPDATE users SET approval_level = 2 WHERE role = 'admin' AND approval_level = 0;

ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS level1_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS level1_approved_at TIMESTAMPTZ;
