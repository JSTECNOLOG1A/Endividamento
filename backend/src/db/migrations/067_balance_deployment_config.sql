-- T7: configuração da Implantação de Saldos, uma por entidade.
-- Guarda contas, datas e a FOTOGRAFIA da posição aprovada (position_snapshot), para explicar e
-- reproduzir o saldo mesmo que taxa, calendário ou contrato mudem depois da aprovação.
CREATE TABLE IF NOT EXISTS balance_deployment_configs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES company_entities(id) ON DELETE RESTRICT,
  data_base DATE NOT NULL,
  data_virada DATE NOT NULL,
  principal_cp_account_id TEXT REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  principal_lp_account_id TEXT REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  juros_cp_account_id TEXT REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  juros_lp_account_id TEXT REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  transitoria_account_id TEXT REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'aprovada', 'aplicada')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  position_snapshot JSONB,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  CHECK (data_virada > data_base)
);

CREATE UNIQUE INDEX IF NOT EXISTS balance_deployment_configs_entity_uidx ON balance_deployment_configs (entity_id);
CREATE INDEX IF NOT EXISTS balance_deployment_configs_group_idx ON balance_deployment_configs (group_id);
