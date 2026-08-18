-- Novo campo: Valor do Encargo por Concessão de Garantia (ECG)
-- Mesmo padrão de IOF / Taxas Diversas: valor monetário + flag de "financiado"
-- (soma ao principal quando financiado, ou é pago à vista quando não).
ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS encargo_garantia_value NUMERIC(18, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS encargo_garantia_financed BOOLEAN DEFAULT FALSE;
