-- Endividamento schema v1
-- ISO 8601 (timestamptz), ISO 4217 (currency_code), NUMERIC for money (ISO/IEC 60559-friendly)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at TIMESTAMPTZ,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  cnpj_group TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE company_entities (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  entity_name TEXT NOT NULL,
  document_number TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('CNPJ', 'CPF')),
  entity_type TEXT CHECK (entity_type IN ('empresa', 'pf')),
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'inativa')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE banks (
  id TEXT PRIMARY KEY,
  bank_code TEXT NOT NULL UNIQUE,
  bank_name TEXT NOT NULL,
  bank_type TEXT CHECK (bank_type IN ('privado', 'publico', 'estrangeiro')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE currencies (
  id TEXT PRIMARY KEY,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  currency_name TEXT NOT NULL,
  exchange_rate NUMERIC(18, 6),
  rate_date DATE,
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'inativa')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE loan_contracts (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT,
  entity_id TEXT REFERENCES company_entities(id) ON DELETE RESTRICT,
  bank_id TEXT REFERENCES banks(id) ON DELETE RESTRICT,
  currency_id TEXT REFERENCES currencies(id) ON DELETE SET NULL,
  contract_number TEXT,
  operation_category TEXT,
  operation_type TEXT,
  operation_value NUMERIC(18, 2),
  amount_foreign NUMERIC(18, 2),
  exchange_rate_closing NUMERIC(18, 6),
  signal_value NUMERIC(18, 2),
  iof_value NUMERIC(18, 2),
  iof_financed BOOLEAN DEFAULT FALSE,
  other_fees NUMERIC(18, 2),
  other_fees_financed BOOLEAN DEFAULT FALSE,
  mip_value NUMERIC(18, 2),
  mip_embedded BOOLEAN DEFAULT FALSE,
  dfi_value NUMERIC(18, 2),
  dfi_embedded BOOLEAN DEFAULT FALSE,
  other_insurance_value NUMERIC(18, 2),
  other_insurance_embedded BOOLEAN DEFAULT FALSE,
  fixed_rate NUMERIC(12, 6),
  indexer TEXT,
  indexer_spread NUMERIC(12, 6),
  exchange_lag SMALLINT DEFAULT 1,
  exchange_rates TEXT,
  operation_date DATE,
  first_payment_date DATE,
  total_term_months NUMERIC(8, 2),
  final_maturity_date DATE,
  principal_grace_months NUMERIC(8, 2),
  interest_grace_months NUMERIC(8, 2),
  grace_action TEXT,
  grace_interest_behavior TEXT,
  amortization_trigger TEXT,
  principal_installments NUMERIC(8, 2),
  interest_installments NUMERIC(8, 2),
  principal_frequency TEXT,
  interest_frequency TEXT,
  calculation_system TEXT,
  amortization_percentages TEXT,
  percentage_base TEXT DEFAULT 'saldo_devedor',
  schedule_data TEXT,
  contract_pdf_url TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'pendente_aprovacao', 'aprovado', 'cancelado')),
  status_history TEXT,
  approved_by TEXT,
  approved_date TIMESTAMPTZ,
  rejection_comments TEXT,
  exported_to_payables BOOLEAN DEFAULT FALSE,
  current_snapshot_id TEXT,
  approved_snapshot_id TEXT,
  last_recalculated_at TIMESTAMPTZ,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE calculation_snapshots (
  id TEXT PRIMARY KEY,
  contract_id TEXT REFERENCES loan_contracts(id) ON DELETE RESTRICT,
  contract_number TEXT,
  engine_version TEXT,
  engine_build_id TEXT,
  calculation_hash_strict TEXT,
  calculation_hash_instance TEXT,
  schedule_snapshot TEXT,
  disclosure_snapshot TEXT,
  risk_flags_snapshot TEXT,
  audit_log_snapshot TEXT,
  currency CHAR(3),
  principal NUMERIC(18, 2),
  total_interest NUMERIC(18, 2),
  total_paid NUMERIC(18, 2),
  trigger_event TEXT,
  calculation_parameters TEXT,
  metadata TEXT,
  immutable_flag BOOLEAN NOT NULL DEFAULT TRUE,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE cdi_rates (
  id TEXT PRIMARY KEY,
  rate_date DATE NOT NULL,
  annual_rate NUMERIC(12, 6) NOT NULL,
  daily_factor NUMERIC(18, 12),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('CDI', 'SELIC')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  UNIQUE (rate_date, rate_type)
);

CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  holiday_name TEXT NOT NULL,
  day_of_week TEXT,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  tenant_name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'STARTER' CHECK (plan IN ('STARTER', 'PRO', 'ENTERPRISE')),
  billing_status TEXT NOT NULL DEFAULT 'trial' CHECK (billing_status IN ('active', 'trial', 'suspended')),
  trial_ends_at DATE,
  contract_limit NUMERIC(12, 0),
  contracts_used NUMERIC(12, 0) DEFAULT 0,
  owner_email TEXT,
  metadata TEXT,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE tenant_users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('OWNER', 'ADMIN', 'VIEWER')),
  permissions TEXT,
  invited_by TEXT,
  joined_at TIMESTAMPTZ,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  UNIQUE (tenant_id, user_email)
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id TEXT,
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address INET,
  user_agent TEXT,
  payload JSONB
);

CREATE INDEX idx_company_entities_group ON company_entities(group_id);
CREATE INDEX idx_loan_contracts_group ON loan_contracts(group_id);
CREATE INDEX idx_loan_contracts_status ON loan_contracts(status);
CREATE INDEX idx_loan_contracts_entity ON loan_contracts(entity_id);
CREATE INDEX idx_snapshots_contract ON calculation_snapshots(contract_id);
CREATE INDEX idx_cdi_rates_type_date ON cdi_rates(rate_type, rate_date);
CREATE INDEX idx_holidays_date ON holidays(holiday_date);
CREATE INDEX idx_currencies_code_date ON currencies(currency_code, rate_date);
CREATE INDEX idx_audit_occurred ON audit_events(occurred_at DESC);
CREATE INDEX idx_audit_resource ON audit_events(resource_type, resource_id);
CREATE INDEX idx_users_email ON users(email);
