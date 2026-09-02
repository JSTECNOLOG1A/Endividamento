-- P0-07: isolamento de lançamentos de conta garantida.
ALTER TABLE account_movements
  ADD COLUMN IF NOT EXISTS group_id TEXT;

UPDATE account_movements m
SET group_id = c.group_id
FROM loan_contracts c
WHERE m.contract_id = c.id
  AND m.group_id IS NULL
  AND c.group_id IS NOT NULL;

DO $$
DECLARE
  orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans
  FROM account_movements
  WHERE group_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      'P0-07: % account_movements sem group_id derivável. Não atribua tenant arbitrário. Ver docs/security/P0-HARDENING-REPORT.md',
      orphans;
  END IF;
END $$;

ALTER TABLE account_movements
  ADD CONSTRAINT account_movements_group_fk
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS account_movements_group_idx
  ON account_movements (group_id);

ALTER TABLE account_movements
  ALTER COLUMN group_id SET NOT NULL;
