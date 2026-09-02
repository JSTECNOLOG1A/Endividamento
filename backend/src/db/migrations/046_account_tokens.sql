ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

UPDATE tenants
   SET onboarding_completed_at = COALESCE(created_date, now())
 WHERE onboarding_completed_at IS NULL;

CREATE TABLE IF NOT EXISTS account_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('password_reset', 'invite')),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_by TEXT,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_tokens_user_kind_idx
  ON account_tokens (user_id, kind)
  WHERE consumed_at IS NULL;
