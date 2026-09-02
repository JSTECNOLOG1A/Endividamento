ALTER TABLE users
  ADD COLUMN IF NOT EXISTS platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS platform_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT,
  actor_id TEXT,
  actor_email TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  tenant_id TEXT,
  group_id TEXT,
  tenant_name TEXT,
  method TEXT,
  path TEXT,
  ip_address TEXT,
  user_agent TEXT,
  purpose TEXT NOT NULL DEFAULT 'suporte_operacional',
  created_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_access_log_actor_idx
  ON platform_access_log (actor_email, created_date DESC);

CREATE INDEX IF NOT EXISTS platform_access_log_tenant_idx
  ON platform_access_log (tenant_id, created_date DESC);
