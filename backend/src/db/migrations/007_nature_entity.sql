ALTER TABLE company_entities
  ADD COLUMN IF NOT EXISTS codigo_empresa TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS company_entities_group_codigo_empresa_uidx
  ON company_entities (group_id, codigo_empresa)
  WHERE codigo_empresa <> '';

ALTER TABLE natures
  ADD COLUMN IF NOT EXISTS entity_id TEXT REFERENCES company_entities(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_natures_entity ON natures(entity_id);

UPDATE natures n
SET entity_id = e.id
FROM company_entities e
WHERE n.entity_id IS NULL
  AND COALESCE(e.codigo_empresa, '') <> ''
  AND regexp_replace(COALESCE(n.empresa, ''), '[^0-9]', '', 'g') <> ''
  AND lpad(regexp_replace(COALESCE(n.empresa, ''), '[^0-9]', '', 'g'), 2, '0')
    = lpad(regexp_replace(e.codigo_empresa, '[^0-9]', '', 'g'), 2, '0')
  AND (
    SELECT COUNT(*) FROM company_entities e2
    WHERE COALESCE(e2.codigo_empresa, '') <> ''
      AND lpad(regexp_replace(e2.codigo_empresa, '[^0-9]', '', 'g'), 2, '0')
        = lpad(regexp_replace(e.codigo_empresa, '[^0-9]', '', 'g'), 2, '0')
  ) = 1;
