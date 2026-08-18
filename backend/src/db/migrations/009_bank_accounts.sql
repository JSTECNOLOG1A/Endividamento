CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES company_entities(id) ON DELETE RESTRICT,
  bank_id TEXT NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
  empresa TEXT NOT NULL DEFAULT '',
  filial TEXT NOT NULL DEFAULT '',
  bank_code TEXT NOT NULL DEFAULT '',
  agencia TEXT NOT NULL,
  conta TEXT NOT NULL,
  digito TEXT,
  nome TEXT NOT NULL,
  tipo TEXT,
  moeda TEXT,
  conta_contabil TEXT,
  natureza TEXT,
  origem TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'integrado')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX bank_accounts_empresa_banco_agencia_conta_uidx
  ON bank_accounts (empresa, bank_code, agencia, conta);

CREATE INDEX idx_bank_accounts_entity ON bank_accounts(entity_id);
CREATE INDEX idx_bank_accounts_bank ON bank_accounts(bank_id);
