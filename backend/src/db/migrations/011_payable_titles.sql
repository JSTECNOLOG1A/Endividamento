CREATE TABLE payable_titles (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES company_entities(id) ON DELETE RESTRICT,
  contract_id TEXT NOT NULL REFERENCES loan_contracts(id) ON DELETE RESTRICT,
  parcela TEXT NOT NULL,
  titulo_numero TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'NP',
  prefixo TEXT NOT NULL DEFAULT 'EMP',
  emissao DATE,
  vencimento DATE,
  valor NUMERIC(18, 2) NOT NULL DEFAULT 0,
  saldo NUMERIC(18, 2) NOT NULL DEFAULT 0,
  natureza TEXT NOT NULL DEFAULT '',
  historico TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'baixado', 'cancelado')),
  origem TEXT NOT NULL DEFAULT 'contrato' CHECK (origem IN ('contrato', 'manual', 'integrado')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX payable_titles_contract_parcela_uidx
  ON payable_titles (contract_id, parcela);

CREATE INDEX payable_titles_entity_vencimento_idx
  ON payable_titles (entity_id, vencimento);
