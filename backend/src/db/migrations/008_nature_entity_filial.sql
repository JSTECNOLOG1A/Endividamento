ALTER TABLE company_entities
  ADD COLUMN IF NOT EXISTS codigo_filial TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS company_entities_group_codigo_empresa_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS company_entities_group_empresa_filial_uidx
  ON company_entities (group_id, codigo_empresa, codigo_filial)
  WHERE codigo_empresa <> '';

UPDATE natures n
SET entity_id = NULL
FROM company_entities e
WHERE n.entity_id = e.id
  AND NOT (
    regexp_replace(COALESCE(e.codigo_empresa, ''), '[^0-9]', '', 'g') <> ''
    AND regexp_replace(COALESCE(e.codigo_filial, ''), '[^0-9]', '', 'g') <> ''
    AND regexp_replace(COALESCE(n.empresa, ''), '[^0-9]', '', 'g') <> ''
    AND regexp_replace(COALESCE(n.filial, ''), '[^0-9]', '', 'g') <> ''
    AND lpad(regexp_replace(COALESCE(n.empresa, ''), '[^0-9]', '', 'g'), 2, '0')
      = lpad(regexp_replace(e.codigo_empresa, '[^0-9]', '', 'g'), 2, '0')
    AND lpad(regexp_replace(COALESCE(n.filial, ''), '[^0-9]', '', 'g'), 2, '0')
      = lpad(regexp_replace(e.codigo_filial, '[^0-9]', '', 'g'), 2, '0')
  );
