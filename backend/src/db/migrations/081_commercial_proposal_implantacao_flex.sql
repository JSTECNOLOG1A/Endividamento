-- Flexibilidade na cobrança de implantação (tela Proposta Comercial):
-- "Cobrar implantação" (desmarcável, isenta), valor manual só daquela
-- proposta (não mexe nos parâmetros gerais do plano) e nº de parcelas
-- escolhido quando a forma de pagamento da implantação não é à vista.
ALTER TABLE commercial_proposals
  ADD COLUMN IF NOT EXISTS cobrar_implantacao BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS implantacao_valor_manual NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS implantacao_parcelas INTEGER;
