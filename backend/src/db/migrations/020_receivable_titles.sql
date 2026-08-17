ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS exported_to_receivables BOOLEAN DEFAULT FALSE;

CREATE TABLE receivable_titles (
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
  cliente TEXT NOT NULL DEFAULT '',
  cliente_loja TEXT NOT NULL DEFAULT '01',
  cliente_nome TEXT NOT NULL DEFAULT '',
  filial TEXT NOT NULL DEFAULT '',
  filial_origem TEXT NOT NULL DEFAULT '',
  integrado_erp BOOLEAN NOT NULL DEFAULT FALSE,
  integrado_erp_em TIMESTAMPTZ,
  erp_mensagem TEXT,
  erp_status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (erp_status IN ('pendente', 'integrado', 'falha', 'estornado', 'baixado')),
  erp_consultado_em TIMESTAMPTZ,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX receivable_titles_contract_parcela_uidx
  ON receivable_titles (contract_id, parcela);

CREATE INDEX receivable_titles_entity_vencimento_idx
  ON receivable_titles (entity_id, vencimento);

CREATE INDEX receivable_titles_erp_status_idx
  ON receivable_titles (erp_status);
