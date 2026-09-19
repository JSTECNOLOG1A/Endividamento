ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS interest_day_count_convention TEXT;

ALTER TABLE loan_contracts
  DROP CONSTRAINT IF EXISTS loan_contracts_day_count_convention_check;
ALTER TABLE loan_contracts
  ADD CONSTRAINT loan_contracts_day_count_convention_check
  CHECK (interest_day_count_convention IN (
    'dias_corridos_360', 'dias_corridos_365', 'dias_uteis_252', 'convencao_30_360'
  ));

-- Backfill: preserva o comportamento efetivo de hoje por contrato existente.
-- Prefixado sempre calculou em dias corridos/360; indexado (CDI/SELIC + spread)
-- sempre calculou o spread em dias úteis/252. Ver CalculationEngine.js.
UPDATE loan_contracts
SET interest_day_count_convention = CASE
  WHEN indexer = 'NA' OR indexer IS NULL THEN 'dias_corridos_360'
  ELSE 'dias_uteis_252'
END
WHERE interest_day_count_convention IS NULL;

ALTER TABLE loan_contracts
  ALTER COLUMN interest_day_count_convention SET DEFAULT 'dias_corridos_360';
ALTER TABLE loan_contracts
  ALTER COLUMN interest_day_count_convention SET NOT NULL;
