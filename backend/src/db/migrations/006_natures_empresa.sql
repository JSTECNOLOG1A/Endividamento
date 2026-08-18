ALTER TABLE natures
  ADD COLUMN IF NOT EXISTS empresa TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS natures_filial_codigo_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS natures_empresa_filial_codigo_uidx
  ON natures (empresa, filial, codigo);
