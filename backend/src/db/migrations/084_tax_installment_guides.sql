-- Gestão Tributária: guia de pagamento (DARF ou guia estadual) ligada a uma parcela, e os envios dela por e-mail.
-- A guia nunca muda a situação de pagamento da parcela: ela só fica "vinculada" ou "em exceção" (alguém precisa
-- olhar antes de pagar). Substituir ou remover uma guia não apaga a linha: ela é encerrada e fica no histórico,
-- porque um envio por e-mail já feito aponta para a guia que de fato foi enviada.

CREATE TABLE IF NOT EXISTS tax_installment_guides (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  installment_id TEXT NOT NULL REFERENCES tax_installments(id) ON DELETE CASCADE,
  -- Como a guia chegou: PDF anexado ou linha digitada.
  origem TEXT NOT NULL CHECK (origem IN ('pdf', 'digitada')),
  -- De onde veio a linha digitável gravada: lida do PDF ou digitada (inclusive a correção de um PDF ilegível).
  linha_fonte TEXT CHECK (linha_fonte IN ('pdf', 'digitada')),
  -- Por que a linha não foi lida do PDF (só enquanto não houver linha).
  falha_leitura TEXT CHECK (falha_leitura IN ('nao_encontrada', 'multiplas')),
  -- Só dígitos: linha digitável (48) e o código de barras correspondente (44), que é a chave de duplicidade.
  linha_digitavel TEXT CHECK (linha_digitavel ~ '^8[0-9]{47}$'),
  codigo_barras TEXT CHECK (codigo_barras ~ '^8[0-9]{43}$'),
  valor_guia NUMERIC(18, 2) CHECK (valor_guia > 0),
  pagar_ate DATE,
  cnpj_guia TEXT CHECK (cnpj_guia ~ '^[0-9]{14}$'),
  arquivo_chave TEXT,
  arquivo_nome TEXT,
  arquivo_tamanho INTEGER,
  situacao TEXT NOT NULL CHECK (situacao IN ('vinculada', 'excecao')),
  motivos JSONB NOT NULL DEFAULT '[]'::jsonb,
  verificada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  encerrada_em TIMESTAMPTZ,
  encerrada_por TEXT,
  motivo_encerramento TEXT CHECK (motivo_encerramento IN ('substituida', 'removida')),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  created_by_name TEXT,
  updated_by TEXT,
  CONSTRAINT tax_installment_guides_line_pair_check CHECK ((linha_digitavel IS NULL) = (codigo_barras IS NULL)),
  -- Sem linha, a guia está em exceção por falha de leitura; com linha, não há falha de leitura.
  CONSTRAINT tax_installment_guides_read_failure_check CHECK ((codigo_barras IS NULL) = (falha_leitura IS NOT NULL)),
  CONSTRAINT tax_installment_guides_file_check CHECK ((origem = 'pdf') = (arquivo_chave IS NOT NULL)),
  CONSTRAINT tax_installment_guides_status_check
    CHECK ((situacao = 'excecao') = (jsonb_typeof(motivos) = 'array' AND jsonb_array_length(motivos) > 0)),
  CONSTRAINT tax_installment_guides_end_check CHECK ((encerrada_em IS NULL) = (motivo_encerramento IS NULL))
);

-- Uma guia atual por parcela.
CREATE UNIQUE INDEX IF NOT EXISTS tax_installment_guides_current_uidx
  ON tax_installment_guides (installment_id) WHERE encerrada_em IS NULL;
-- Mesma guia em outra parcela do grupo.
CREATE INDEX IF NOT EXISTS tax_installment_guides_barcode_idx
  ON tax_installment_guides (group_id, codigo_barras) WHERE encerrada_em IS NULL;
CREATE INDEX IF NOT EXISTS tax_installment_guides_installment_idx
  ON tax_installment_guides (installment_id, created_date DESC);

CREATE TABLE IF NOT EXISTS tax_guide_sends (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  guide_id TEXT NOT NULL REFERENCES tax_installment_guides(id) ON DELETE CASCADE,
  installment_id TEXT NOT NULL REFERENCES tax_installments(id) ON DELETE CASCADE,
  destinatarios TEXT[] NOT NULL CHECK (cardinality(destinatarios) > 0),
  -- Endereços que o servidor de e-mail recusou (envio parcial ou falho).
  recusados TEXT[] NOT NULL DEFAULT '{}',
  assunto TEXT NOT NULL,
  mensagem TEXT,
  com_anexo BOOLEAN NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('enviado', 'parcial', 'falhou')),
  erro TEXT,
  enviado_por TEXT,
  enviado_por_nome TEXT,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_guide_sends_installment_idx ON tax_guide_sends (installment_id, created_date DESC);
CREATE INDEX IF NOT EXISTS tax_guide_sends_guide_idx ON tax_guide_sends (guide_id);
