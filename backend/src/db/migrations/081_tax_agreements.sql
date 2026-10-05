-- Gestão Tributária: parcelamentos de tributos por código de parcelamento, separados por esfera.
-- Tabelas próprias do módulo — não compartilham estrutura com loan_contracts/payable_titles.
-- Todo registro guarda a procedência do dado (manual, importado ou api) e a data da última conferência,
-- pra a tela nunca apresentar dado digitado à mão como se fosse oficial.

CREATE TABLE IF NOT EXISTS tax_agreements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  entity_id TEXT NOT NULL REFERENCES company_entities(id) ON DELETE RESTRICT,
  esfera TEXT NOT NULL CHECK (esfera IN ('federal', 'estadual', 'municipal')),
  orgao TEXT NOT NULL,
  uf TEXT,
  modalidade TEXT NOT NULL,
  tributo TEXT,
  codigo_parcelamento TEXT NOT NULL,
  data_adesao DATE,
  qtd_parcelas INTEGER,
  saldo_oficial NUMERIC(18, 2),
  saldo_data_base DATE,
  situacao TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'quitado', 'rescindido', 'suspenso')),
  origem_dado TEXT NOT NULL DEFAULT 'manual' CHECK (origem_dado IN ('manual', 'importado', 'api')),
  ultima_conferencia DATE,
  observacoes TEXT,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

-- O número do parcelamento só é único dentro do contribuinte, órgão e modalidade (não no país todo).
CREATE UNIQUE INDEX IF NOT EXISTS tax_agreements_code_uidx
  ON tax_agreements (group_id, entity_id, orgao, modalidade, codigo_parcelamento);
CREATE INDEX IF NOT EXISTS tax_agreements_group_idx ON tax_agreements (group_id, esfera);
CREATE INDEX IF NOT EXISTS tax_agreements_entity_idx ON tax_agreements (entity_id);

CREATE TABLE IF NOT EXISTS tax_installments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  agreement_id TEXT NOT NULL REFERENCES tax_agreements(id) ON DELETE CASCADE,
  numero_parcela INTEGER NOT NULL CHECK (numero_parcela > 0),
  vencimento DATE NOT NULL,
  valor NUMERIC(18, 2) NOT NULL CHECK (valor >= 0),
  situacao TEXT NOT NULL DEFAULT 'em_aberto'
    CHECK (situacao IN ('em_aberto', 'paga_aguardando_reconhecimento', 'reconhecida', 'cancelada')),
  data_pagamento DATE,
  valor_pago NUMERIC(18, 2),
  origem_dado TEXT NOT NULL DEFAULT 'manual' CHECK (origem_dado IN ('manual', 'importado', 'api')),
  observacoes TEXT,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_installments_number_uidx ON tax_installments (agreement_id, numero_parcela);
CREATE INDEX IF NOT EXISTS tax_installments_group_due_idx ON tax_installments (group_id, vencimento);
