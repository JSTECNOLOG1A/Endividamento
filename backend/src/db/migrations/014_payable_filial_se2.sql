ALTER TABLE payable_titles
  ADD COLUMN IF NOT EXISTS filial TEXT NOT NULL DEFAULT '';

UPDATE payable_titles t
SET
  filial = lpad(regexp_replace(COALESCE(e.codigo_empresa, ''), '[^0-9]', '', 'g'), 2, '0'),
  filial_origem = lpad(regexp_replace(COALESCE(e.codigo_empresa, ''), '[^0-9]', '', 'g'), 2, '0')
    || lpad(regexp_replace(COALESCE(e.codigo_filial, ''), '[^0-9]', '', 'g'), 2, '0')
FROM company_entities e
WHERE t.entity_id = e.id
  AND COALESCE(e.codigo_empresa, '') <> ''
  AND COALESCE(e.codigo_filial, '') <> ''
  AND (
    COALESCE(t.filial, '') = ''
    OR COALESCE(t.filial_origem, '') = ''
    OR length(regexp_replace(COALESCE(t.filial_origem, ''), '[^0-9]', '', 'g')) <= 2
  );
