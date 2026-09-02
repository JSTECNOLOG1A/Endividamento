-- Isolamento multi-tenant: group_id em todas as tabelas de dados do cliente.

ALTER TABLE natures ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE payable_titles ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE receivable_titles ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE calculation_snapshots ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE accounting_closings ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE contract_settlements ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE accounting_event_mappings ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE accounting_journal_entries ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE scheduled_job_runs ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE SET NULL;

ALTER TABLE audit_events DISABLE TRIGGER trg_audit_no_update;
ALTER TABLE calculation_snapshots DISABLE TRIGGER trg_snapshot_immutable;
ALTER TABLE banks ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE currencies ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE cdi_rates ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;

UPDATE natures n SET group_id = e.group_id
FROM company_entities e WHERE n.entity_id = e.id AND n.group_id IS NULL;

UPDATE bank_accounts a SET group_id = e.group_id
FROM company_entities e WHERE a.entity_id = e.id AND a.group_id IS NULL;

UPDATE payable_titles t SET group_id = c.group_id
FROM loan_contracts c WHERE t.contract_id = c.id AND t.group_id IS NULL;

UPDATE payable_titles t SET group_id = e.group_id
FROM company_entities e WHERE t.entity_id = e.id AND t.group_id IS NULL;

UPDATE receivable_titles t SET group_id = c.group_id
FROM loan_contracts c WHERE t.contract_id = c.id AND t.group_id IS NULL;

UPDATE receivable_titles t SET group_id = e.group_id
FROM company_entities e WHERE t.entity_id = e.id AND t.group_id IS NULL;

UPDATE calculation_snapshots s SET group_id = c.group_id
FROM loan_contracts c WHERE s.contract_id = c.id AND s.group_id IS NULL;

UPDATE accounting_closings x SET group_id = e.group_id
FROM company_entities e WHERE x.entity_id = e.id AND x.group_id IS NULL;

UPDATE contract_settlements s SET group_id = c.group_id
FROM loan_contracts c WHERE s.contract_id = c.id AND s.group_id IS NULL;

UPDATE accounting_event_mappings m SET group_id = e.group_id
FROM company_entities e WHERE m.entity_id = e.id AND m.group_id IS NULL;

UPDATE accounting_journal_entries j SET group_id = x.group_id
FROM accounting_closings x WHERE j.closing_id = x.id AND j.group_id IS NULL;

UPDATE chart_of_accounts SET group_id = (SELECT group_id FROM tenants ORDER BY created_date ASC LIMIT 1)
WHERE group_id IS NULL AND EXISTS (SELECT 1 FROM tenants);

UPDATE natures SET group_id = (SELECT group_id FROM tenants ORDER BY created_date ASC LIMIT 1)
WHERE group_id IS NULL AND EXISTS (SELECT 1 FROM tenants);

UPDATE bank_accounts SET group_id = (SELECT group_id FROM tenants ORDER BY created_date ASC LIMIT 1)
WHERE group_id IS NULL AND EXISTS (SELECT 1 FROM tenants);

UPDATE integrations SET group_id = (SELECT group_id FROM tenants ORDER BY created_date ASC LIMIT 1)
WHERE group_id IS NULL AND EXISTS (SELECT 1 FROM tenants);

UPDATE scheduled_jobs SET group_id = (SELECT group_id FROM tenants ORDER BY created_date ASC LIMIT 1)
WHERE group_id IS NULL AND EXISTS (SELECT 1 FROM tenants);

UPDATE scheduled_job_runs r SET group_id = j.group_id
FROM scheduled_jobs j WHERE r.job_id = j.id AND r.group_id IS NULL;

UPDATE audit_events SET group_id = (SELECT group_id FROM tenants ORDER BY created_date ASC LIMIT 1)
WHERE group_id IS NULL AND EXISTS (SELECT 1 FROM tenants);

INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, joined_at, created_date, updated_date, created_by)
SELECT
  'tuser_' || replace(u.id::text, '-', ''),
  t.id,
  t.group_id,
  u.email,
  CASE WHEN u.role = 'viewer' THEN 'VIEWER' WHEN u.role = 'admin' THEN 'ADMIN' ELSE 'ADMIN' END,
  now(), now(), now(), u.email
FROM users u
JOIN tenants t ON TRUE
WHERE (SELECT COUNT(*) FROM tenants) = 1
  AND NOT EXISTS (
    SELECT 1 FROM tenant_users tu WHERE lower(tu.user_email) = lower(u.email)
  );

DROP INDEX IF EXISTS natures_empresa_filial_codigo_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS natures_group_empresa_filial_codigo_uidx
  ON natures (group_id, empresa, filial, codigo)
  WHERE group_id IS NOT NULL;

ALTER TABLE chart_of_accounts DROP CONSTRAINT IF EXISTS chart_of_accounts_account_code_key;
DROP INDEX IF EXISTS chart_of_accounts_account_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_group_code_uidx
  ON chart_of_accounts (group_id, account_code)
  WHERE group_id IS NOT NULL;

-- Duas entidades do mesmo grupo podem compartilhar uma conta bancária
-- (conta centralizadora/pool) — por isso a unicidade fica por entidade
-- dentro do grupo, não só por grupo, senão duas empresas com a mesma
-- conta física derrubam a migração (caso real: Grupo Cangaia, ag. 0240
-- conta 148940-2, compartilhada entre 2 empresas).
DROP INDEX IF EXISTS bank_accounts_empresa_banco_agencia_conta_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_group_banco_agencia_conta_uidx
  ON bank_accounts (group_id, entity_id, bank_id, agencia, conta)
  WHERE group_id IS NOT NULL;

ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_code_key;
DROP INDEX IF EXISTS integrations_code_idx;
CREATE UNIQUE INDEX IF NOT EXISTS integrations_group_code_uidx
  ON integrations (group_id, code)
  WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS integrations_code_idx ON integrations (code);

DROP INDEX IF EXISTS scheduled_jobs_tarefa_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_group_tarefa_uidx
  ON scheduled_jobs (group_id, tarefa)
  WHERE group_id IS NOT NULL;

DROP INDEX IF EXISTS integration_endpoints_cadastro_key_metodo_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS integration_endpoints_integration_cadastro_uidx
  ON integration_endpoints (integration_id, cadastro_key, metodo)
  WHERE cadastro_key IS NOT NULL;

ALTER TABLE banks DROP CONSTRAINT IF EXISTS banks_bank_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS banks_shared_code_uidx ON banks (bank_code) WHERE group_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS banks_group_code_uidx ON banks (group_id, bank_code) WHERE group_id IS NOT NULL;

ALTER TABLE cdi_rates DROP CONSTRAINT IF EXISTS cdi_rates_rate_date_rate_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS cdi_rates_shared_date_type_uidx
  ON cdi_rates (rate_date, rate_type) WHERE group_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cdi_rates_group_date_type_uidx
  ON cdi_rates (group_id, rate_date, rate_type) WHERE group_id IS NOT NULL;

ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_holiday_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS holidays_shared_date_uidx ON holidays (holiday_date) WHERE group_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS holidays_group_date_uidx ON holidays (group_id, holiday_date) WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_natures_group ON natures (group_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_group ON bank_accounts (group_id);
CREATE INDEX IF NOT EXISTS idx_chart_group ON chart_of_accounts (group_id);
CREATE INDEX IF NOT EXISTS idx_payable_titles_group ON payable_titles (group_id);
CREATE INDEX IF NOT EXISTS idx_receivable_titles_group ON receivable_titles (group_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_group ON calculation_snapshots (group_id);
CREATE INDEX IF NOT EXISTS idx_integrations_group ON integrations (group_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_group ON scheduled_jobs (group_id);
CREATE INDEX IF NOT EXISTS idx_audit_group ON audit_events (group_id);

ALTER TABLE calculation_snapshots ENABLE TRIGGER trg_snapshot_immutable;
ALTER TABLE audit_events ENABLE TRIGGER trg_audit_no_update;
