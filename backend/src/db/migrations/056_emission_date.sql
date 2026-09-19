-- Campo novo, puramente informativo — não entra em nenhum cálculo. A "Data
-- da Operação" existente foi renomeada na tela para "Data de Liberação" e
-- continua sendo a que o motor usa (coluna operation_date, intocada).
ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS emission_date DATE;
