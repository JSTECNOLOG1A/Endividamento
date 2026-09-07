-- 052: PLATFORM_MASTER — control plane, lifecycle de tenant, sessões de suporte

-- Lifecycle administrativo (control plane). billing_status permanece para cobrança.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS trade_name TEXT,
  ADD COLUMN IF NOT EXISTS document TEXT,
  ADD COLUMN IF NOT EXISTS admin_email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS responsible_name TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT,
  ADD COLUMN IF NOT EXISTS billing_period TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS user_limit INTEGER,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspension_detail TEXT,
  ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reactivated_by UUID,
  ADD COLUMN IF NOT EXISTS reactivation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_by UUID,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Backfill lifecycle a partir de billing_status
UPDATE tenants
SET lifecycle_status = CASE billing_status
  WHEN 'trial' THEN 'TRIAL'
  WHEN 'suspended' THEN 'SUSPENDED'
  WHEN 'active' THEN 'ACTIVE'
  ELSE 'ACTIVE'
END
WHERE lifecycle_status IS NULL;

UPDATE tenants
SET legal_name = COALESCE(legal_name, tenant_name),
    admin_email = COALESCE(admin_email, owner_email)
WHERE legal_name IS NULL OR admin_email IS NULL;

UPDATE tenants t
SET document = g.cnpj_group
FROM groups g
WHERE g.id = t.group_id
  AND t.document IS NULL
  AND g.cnpj_group IS NOT NULL;

ALTER TABLE tenants
  ALTER COLUMN lifecycle_status SET DEFAULT 'ACTIVE';

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_lifecycle_status_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_lifecycle_status_check
  CHECK (lifecycle_status IN (
    'PENDING', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'CANCELLED', 'DELINQUENT'
  ));

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_billing_period_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_billing_period_check
  CHECK (billing_period IS NULL OR billing_period IN ('monthly', 'yearly'));

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_suspension_reason_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_suspension_reason_check
  CHECK (
    suspension_reason IS NULL OR suspension_reason IN (
      'INADIMPLENCIA', 'SOLICITACAO_CLIENTE', 'SEGURANCA',
      'VIOLACAO_CONTRATUAL', 'MANUTENCAO_ADMINISTRATIVA', 'OUTRO'
    )
  );

-- Expand billing_status para alinhar com lifecycle comercial (sem quebrar existentes)
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_billing_status_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_billing_status_check
  CHECK (billing_status IN (
    'pending', 'trial', 'active', 'suspended', 'disabled', 'cancelled', 'delinquent'
  ));

CREATE INDEX IF NOT EXISTS idx_tenants_lifecycle_status ON tenants (lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_tenants_document ON tenants (document);

-- Sessões de suporte (data plane excepcional)
CREATE TABLE IF NOT EXISTS support_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_user_id UUID NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  reason TEXT NOT NULL,
  ticket_reference TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (15, 30, 60)),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended', 'expired')),
  ip_address TEXT,
  user_agent TEXT,
  ended_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_master_active
  ON support_sessions (master_user_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_sessions_tenant
  ON support_sessions (tenant_id, started_at DESC);

-- Step-up / MFA scaffolding para PLATFORM_MASTER (sem forçar TOTP ainda)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret TEXT,
  ADD COLUMN IF NOT EXISTS privileged_auth_at TIMESTAMPTZ;

-- Ampliar platform_access_log com support_session_id
ALTER TABLE platform_access_log
  ADD COLUMN IF NOT EXISTS support_session_id UUID,
  ADD COLUMN IF NOT EXISTS metadata JSONB;
