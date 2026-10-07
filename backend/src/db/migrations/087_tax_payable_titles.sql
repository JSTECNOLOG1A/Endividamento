-- Gestão Tributária: título a pagar da parcela de tributo no Protheus (SE2).
-- Tabela própria, separada de payable_titles: as rotinas dos títulos de empréstimo (geração, limpeza de órfãos,
-- reabertura, integração automática, consulta, fechamento) leem só payable_titles e não alcançam este título.
-- Uma linha por parcela, reaproveitada a cada envio/estorno; o histórico fica na auditoria.

-- Número do título no SE2 (E2_NUM, 9 posições): sequência única, nunca reaproveitada entre parcelas.
CREATE SEQUENCE IF NOT EXISTS tax_payable_title_number_seq;

CREATE TABLE IF NOT EXISTS tax_payable_titles (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  -- RESTRICT: a parcela só sai depois de o título estar fora do Protheus (estornado ou nunca enviado).
  installment_id TEXT NOT NULL REFERENCES tax_installments(id) ON DELETE RESTRICT,
  numero_e2 TEXT NOT NULL CHECK (numero_e2 ~ '^[0-9]{9}$'),
  parcela_e2 TEXT NOT NULL DEFAULT '01' CHECK (parcela_e2 ~ '^[0-9A-Z]{2}$'),
  -- pendente: não está no Protheus (motivo diz por quê); incerto: envio sem confirmação, consultar antes de
  -- reenviar; enviado: incluído com confirmação; estornado: estorno confirmado; baixado/parcial: pago no
  -- Protheus (não muda mais); conferencia: precisa de alguém (ex.: não achado onde deveria estar).
  situacao TEXT NOT NULL DEFAULT 'pendente'
    CHECK (situacao IN ('pendente', 'incerto', 'enviado', 'estornado', 'baixado', 'parcial', 'conferencia')),
  motivo TEXT,
  -- Guia e dados enviados ao Protheus (a chave do SE2 usada para consultar e estornar).
  guide_id TEXT REFERENCES tax_installment_guides(id) ON DELETE SET NULL,
  filial TEXT,
  fil_orig TEXT,
  prefixo TEXT,
  tipo TEXT,
  natureza TEXT,
  fornecedor TEXT,
  loja TEXT,
  emissao DATE,
  vencimento DATE,
  valor NUMERIC(18, 2),
  codigo_barras TEXT,
  linha_digitavel TEXT,
  historico TEXT,
  -- Retorno da consulta ao Protheus (só do título; a parcela não muda por aqui).
  saldo NUMERIC(18, 2),
  baixa_data DATE,
  erp_mensagem TEXT,
  enviado_em TIMESTAMPTZ,
  estornado_em TIMESTAMPTZ,
  consultado_em TIMESTAMPTZ,
  -- Trava por título: um envio/estorno/consulta por vez (botão, agendador e ação da guia).
  trava_ate TIMESTAMPTZ,
  trava_por TEXT,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_payable_titles_installment_uidx ON tax_payable_titles (installment_id);
CREATE UNIQUE INDEX IF NOT EXISTS tax_payable_titles_number_uidx ON tax_payable_titles (numero_e2, parcela_e2);
CREATE INDEX IF NOT EXISTS tax_payable_titles_group_idx ON tax_payable_titles (group_id, situacao);
