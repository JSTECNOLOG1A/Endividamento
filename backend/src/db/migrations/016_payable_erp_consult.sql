ALTER TABLE payable_titles
  ADD COLUMN IF NOT EXISTS erp_consultado_em TIMESTAMPTZ;

ALTER TABLE payable_titles DROP CONSTRAINT IF EXISTS payable_titles_erp_status_check;
ALTER TABLE payable_titles
  ADD CONSTRAINT payable_titles_erp_status_check
  CHECK (erp_status IN ('pendente', 'integrado', 'falha', 'estornado', 'baixado'));
