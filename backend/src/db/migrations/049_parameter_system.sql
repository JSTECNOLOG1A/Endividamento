-- Central de parâmetros: valores por escopo GLOBAL / TENANT / USER.
-- Definições (catálogo) ficam em código (parameters/definitions.js).

CREATE TABLE IF NOT EXISTS system_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'TENANT', 'USER')),
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  param_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  CONSTRAINT system_parameters_scope_refs CHECK (
    (scope = 'GLOBAL' AND group_id IS NULL AND user_id IS NULL)
    OR (scope = 'TENANT' AND group_id IS NOT NULL AND user_id IS NULL)
    OR (scope = 'USER' AND group_id IS NOT NULL AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS system_parameters_global_uidx
  ON system_parameters (param_key)
  WHERE scope = 'GLOBAL' AND group_id IS NULL AND user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS system_parameters_tenant_uidx
  ON system_parameters (group_id, param_key)
  WHERE scope = 'TENANT';

CREATE UNIQUE INDEX IF NOT EXISTS system_parameters_user_uidx
  ON system_parameters (group_id, user_id, param_key)
  WHERE scope = 'USER';

CREATE INDEX IF NOT EXISTS system_parameters_group_key_idx
  ON system_parameters (group_id, param_key);

-- Default crítico: layout clássico para todos os tenants existentes.
INSERT INTO system_parameters (scope, group_id, param_key, value_json, updated_by)
SELECT 'TENANT', g.id, 'appearance.default_layout', '{"v":"classic"}'::jsonb, 'migration_049'
FROM groups g
WHERE NOT EXISTS (
  SELECT 1 FROM system_parameters sp
  WHERE sp.scope = 'TENANT' AND sp.group_id = g.id AND sp.param_key = 'appearance.default_layout'
);

-- GLOBAL fallback explícito (código também usa default do catálogo).
INSERT INTO system_parameters (scope, group_id, user_id, param_key, value_json, updated_by)
SELECT 'GLOBAL', NULL, NULL, 'appearance.default_layout', '{"v":"classic"}'::jsonb, 'migration_049'
WHERE NOT EXISTS (
  SELECT 1 FROM system_parameters sp
  WHERE sp.scope = 'GLOBAL' AND sp.param_key = 'appearance.default_layout'
    AND sp.group_id IS NULL AND sp.user_id IS NULL
);
