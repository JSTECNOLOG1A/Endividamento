-- P0-08: isolamento do log de notificações financeiras.
ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS group_id TEXT;

UPDATE notification_log n
SET group_id = c.group_id
FROM loan_contracts c
WHERE n.contract_id = c.id
  AND n.group_id IS NULL
  AND c.group_id IS NOT NULL;

DO $$
DECLARE
  orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans
  FROM notification_log
  WHERE group_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      'P0-08: % notification_log sem group_id derivável (sem contrato ou contrato sem tenant). Não delete. Ver docs/security/P0-HARDENING-REPORT.md',
      orphans;
  END IF;
END $$;

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_group_fk
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS notification_log_group_idx
  ON notification_log (group_id);

ALTER TABLE notification_log
  ALTER COLUMN group_id SET NOT NULL;
