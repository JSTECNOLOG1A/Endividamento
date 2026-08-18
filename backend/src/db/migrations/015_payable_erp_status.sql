ALTER TABLE payable_titles
  ADD COLUMN IF NOT EXISTS erp_status TEXT NOT NULL DEFAULT 'pendente';

UPDATE payable_titles
SET erp_status = CASE
  WHEN integrado_erp IS TRUE THEN 'integrado'
  WHEN COALESCE(btrim(erp_mensagem), '') <> '' THEN 'falha'
  ELSE 'pendente'
END;

ALTER TABLE payable_titles DROP CONSTRAINT IF EXISTS payable_titles_erp_status_check;
ALTER TABLE payable_titles
  ADD CONSTRAINT payable_titles_erp_status_check
  CHECK (erp_status IN ('pendente', 'integrado', 'falha', 'estornado'));

CREATE INDEX IF NOT EXISTS payable_titles_erp_status_idx
  ON payable_titles (erp_status);
