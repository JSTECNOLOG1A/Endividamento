ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS domain TEXT;

UPDATE tenants
SET domain = lower(trim(domain))
WHERE domain IS NOT NULL AND domain <> '';

CREATE UNIQUE INDEX IF NOT EXISTS tenants_domain_uidx
  ON tenants (domain)
  WHERE domain IS NOT NULL AND domain <> '';

CREATE TABLE IF NOT EXISTS tenant_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  cnpj_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_signups_email_pending_uidx
  ON tenant_signups (lower(email))
  WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_signups_domain_pending_uidx
  ON tenant_signups (domain)
  WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_signups_cnpj_pending_uidx
  ON tenant_signups (cnpj)
  WHERE consumed_at IS NULL;
