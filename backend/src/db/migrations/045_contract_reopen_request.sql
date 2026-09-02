ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS reopen_requested_by TEXT,
  ADD COLUMN IF NOT EXISTS reopen_requested_at TIMESTAMPTZ;
