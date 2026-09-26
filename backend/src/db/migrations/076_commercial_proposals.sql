-- Acervo de propostas comerciais salvas (tela "Proposta Comercial",
-- master-only) — cada linha é um snapshot completo do formulário no
-- momento do salvamento, para reabertura fiel e histórico comercial.
-- "pricing_snapshot" e os campos "valor_*" ficam congelados: a listagem
-- nunca recalcula usando os parâmetros atuais de commercial_pricing_config.
CREATE TABLE IF NOT EXISTS commercial_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'elaborando'
    CHECK (status IN ('elaborando', 'enviada', 'aceita', 'recusada')),

  -- Partes / identificação
  client_name TEXT,
  client_cnpj TEXT,
  client_endereco TEXT,
  contact_name TEXT,
  contratante_cargo TEXT,
  validity_days TEXT,

  -- Plano e simulação
  tier TEXT NOT NULL,
  contract_count TEXT,
  qtd_renegociados TEXT,
  want_cadastro BOOLEAN NOT NULL DEFAULT false,
  cadastro_qty TEXT,
  pagamento_implantacao TEXT,
  pagamento_mensalidade TEXT,
  dia_vencimento TEXT,
  outros_valores TEXT,

  -- Objeto e escopo (termo de contratação)
  objeto TEXT,
  escopo_disponibilizacao TEXT,
  escopo_implantacao TEXT,
  escopo_integracoes TEXT,
  escopo_treinamento TEXT,
  escopo_demais TEXT,

  -- Cronograma e equipe (termo de contratação)
  cronograma_inicio TEXT,
  cronograma_prazo TEXT,
  cronograma_contado_a TEXT,
  equipe_clarity_ib TEXT,
  equipe_contratante TEXT,

  -- Vigência, cancelamento e foro (termo de contratação)
  vigencia_duracao TEXT,
  vigencia_inicio TEXT,
  vigencia_renovacao TEXT,
  foro_comarca TEXT,
  foro_estado TEXT,

  -- Assinatura (termo de contratação)
  assinatura_cidade TEXT,
  contratada_representante TEXT,
  contratada_cargo TEXT,

  -- Parâmetros de precificação vigentes no momento do salvamento.
  pricing_snapshot JSONB NOT NULL,

  -- Valores comerciais calculados e congelados no momento do salvamento.
  valor_implantacao NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_mensalidade NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_cadastramento_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_total_primeiro_mes NUMERIC(14,2) NOT NULL DEFAULT 0,
  blocos_count INTEGER NOT NULL DEFAULT 0,
  carteira_total INTEGER NOT NULL DEFAULT 0,

  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_commercial_proposals_created_date
  ON commercial_proposals (created_date DESC);
