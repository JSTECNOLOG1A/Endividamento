-- Configuração compartilhada de precificação comercial (tela "Proposta
-- Comercial", master-only) — tabela singleton, uma linha só, id fixo.
CREATE TABLE IF NOT EXISTS commercial_pricing_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  standard_implantacao NUMERIC(14,2) NOT NULL DEFAULT 8000,
  standard_mensalidade NUMERIC(14,2) NOT NULL DEFAULT 3000,
  standard_bloco NUMERIC(14,2) NOT NULL DEFAULT 1200,
  pro_implantacao NUMERIC(14,2) NOT NULL DEFAULT 14000,
  pro_mensalidade NUMERIC(14,2) NOT NULL DEFAULT 4200,
  pro_bloco NUMERIC(14,2) NOT NULL DEFAULT 1500,
  proii_implantacao NUMERIC(14,2) NOT NULL DEFAULT 20000,
  proii_mensalidade NUMERIC(14,2) NOT NULL DEFAULT 5500,
  proii_bloco NUMERIC(14,2) NOT NULL DEFAULT 1800,
  cadastramento_valor NUMERIC(14,2) NOT NULL DEFAULT 250,
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO commercial_pricing_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
