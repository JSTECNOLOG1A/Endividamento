-- Fechamento Contábil: baixas manuais de parcelas, conciliação por evento
-- (abertura + juros + variação cambial - pagamentos = fechamento) e geração
-- de lançamentos D/C, com trilha de aprovação e histórico mensal imutável.
--
-- accounting_mode / payment_source / posting_approval em company_entities
-- permitem que empresas do mesmo grupo operem em modos diferentes (API,
-- exportação de arquivo, lançamento manual ou apenas controle) — a tela de
-- Fechamento Contábil nunca é suprimida, apenas os componentes mudam
-- conforme o modo configurado.

ALTER TABLE company_entities
  ADD COLUMN IF NOT EXISTS accounting_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (accounting_mode IN ('api', 'file_export', 'manual', 'control_only')),
  ADD COLUMN IF NOT EXISTS payment_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (payment_source IN ('api', 'bank_import', 'file_import', 'manual')),
  ADD COLUMN IF NOT EXISTS posting_approval TEXT NOT NULL DEFAULT 'required'
    CHECK (posting_approval IN ('required', 'automatic'));

-- Fechamento mensal por empresa + competência.
CREATE TABLE accounting_closings (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES company_entities(id) ON DELETE RESTRICT,
  competencia DATE NOT NULL,
  data_base DATE NOT NULL,
  previous_closing_id TEXT REFERENCES accounting_closings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho', 'pagamentos_informados', 'calculado', 'divergencia',
    'pronto_aprovacao', 'aprovado', 'reaberto', 'recalculado', 'aprovado_novamente'
  )),
  -- Snapshots imutáveis (JSON serializado como texto, mesmo padrão de
  -- calculation_snapshots) — só existem a partir do status "calculado".
  opening_snapshot TEXT,
  events_snapshot TEXT,
  journal_snapshot TEXT,
  engine_version TEXT,
  total_debito NUMERIC(18, 2),
  total_credito NUMERIC(18, 2),
  calculated_by TEXT,
  calculated_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  reopened_by TEXT,
  reopened_at TIMESTAMPTZ,
  reopened_reason TEXT,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX accounting_closings_entity_competencia_uidx
  ON accounting_closings (entity_id, competencia);

-- Baixa manual de uma parcela (ou pagamento fora do previsto). É a origem
-- de verdade do que foi efetivamente pago — o schedule_data do contrato
-- continua sendo a projeção contratual.
CREATE TABLE contract_settlements (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES loan_contracts(id) ON DELETE RESTRICT,
  closing_id TEXT REFERENCES accounting_closings(id) ON DELETE SET NULL,
  parcela TEXT,
  scheduled_date DATE,
  actual_payment_date DATE NOT NULL,
  scheduled_amount NUMERIC(18, 2),
  -- Composição obrigatória do valor pago — a soma destes campos deve ser
  -- igual a total_paid (validado na aplicação antes de salvar a baixa).
  principal_paid NUMERIC(18, 2) NOT NULL DEFAULT 0,
  interest_paid NUMERIC(18, 2) NOT NULL DEFAULT 0,
  penalty_paid NUMERIC(18, 2) NOT NULL DEFAULT 0,
  fee_paid NUMERIC(18, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  rounding_adjustment NUMERIC(18, 2) NOT NULL DEFAULT 0,
  other_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(18, 2) NOT NULL DEFAULT 0,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  extraordinary_amortization BOOLEAN NOT NULL DEFAULT FALSE,
  -- Marca se esta baixa exigiu recálculo do cronograma do contrato
  -- (ver CalculationSnapshotIntegration — trigger "RECALCULATED").
  triggers_recalculation BOOLEAN NOT NULL DEFAULT FALSE,
  recalculation_snapshot_id TEXT,
  proof_url TEXT,
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'baixado' CHECK (status IN ('baixado', 'estornado')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE INDEX contract_settlements_contract_idx ON contract_settlements (contract_id);
CREATE INDEX contract_settlements_closing_idx ON contract_settlements (closing_id);

-- Matriz contábil: evento → conta de débito/crédito, por empresa.
CREATE TABLE accounting_event_mappings (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES company_entities(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'liberacao', 'juros_apropriados', 'pagamento_principal', 'pagamento_juros',
    'variacao_cambial_passiva', 'variacao_cambial_ativa', 'tarifa_bancaria',
    'custo_transacao_inicial', 'custo_transacao_apropriacao',
    'reclassificacao_circulante', 'multa_mora', 'desconto_financeiro',
    'ajuste_arredondamento', 'outros'
  )),
  debit_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  credit_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX accounting_event_mappings_entity_event_uidx
  ON accounting_event_mappings (entity_id, event_type);

-- Lançamentos gerados (a prévia do Step 3 e o lote aprovado final).
-- Modelo de linhas (débito e crédito como linhas separadas, não um par fixo
-- na mesma linha) — é o que torna o controle "total débito = total crédito"
-- do Step 3 uma verificação real: se a matriz contábil estiver incompleta
-- para um evento, só uma das pernas é gerada e o lote fica desbalanceado.
CREATE TABLE accounting_journal_entries (
  id TEXT PRIMARY KEY,
  closing_id TEXT NOT NULL REFERENCES accounting_closings(id) ON DELETE RESTRICT,
  contract_id TEXT REFERENCES loan_contracts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entry_date DATE NOT NULL,
  account_id TEXT NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  side TEXT NOT NULL CHECK (side IN ('debito', 'credito')),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  historico TEXT,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE INDEX accounting_journal_entries_closing_idx ON accounting_journal_entries (closing_id);
CREATE INDEX accounting_journal_entries_contract_idx ON accounting_journal_entries (contract_id);
