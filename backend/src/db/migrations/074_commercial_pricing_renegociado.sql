-- Multiplicador aplicado à proposta comercial quando o cliente marca
-- "contratos renegociados" — nesse cenário o valor praticamente dobra em
-- relação à carteira normal, por isso o parâmetro é editável em vez de fixo.
ALTER TABLE commercial_pricing_config
  ADD COLUMN IF NOT EXISTS renegociado_multiplicador NUMERIC(6,2) NOT NULL DEFAULT 2.00;
