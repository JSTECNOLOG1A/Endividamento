-- 062: layout Modern como padrão da plataforma (Classic permanece opcional por tenant)

-- Global da plataforma → modern
UPDATE system_parameters
SET value_json = '{"v":"modern"}'::jsonb,
    updated_by = 'migration_062',
    updated_date = now()
WHERE scope = 'GLOBAL'
  AND param_key = 'appearance.default_layout';

INSERT INTO system_parameters (scope, group_id, user_id, param_key, value_json, updated_by)
SELECT 'GLOBAL', NULL, NULL, 'appearance.default_layout', '{"v":"modern"}'::jsonb, 'migration_062'
WHERE NOT EXISTS (
  SELECT 1 FROM system_parameters sp
  WHERE sp.scope = 'GLOBAL' AND sp.param_key = 'appearance.default_layout'
);

-- Tenants que ainda estão no seed clássico da 049 → modern (herdam o novo padrão).
-- Overrides conscientes (updated_by diferente de migration_049) são preservados.
UPDATE system_parameters
SET value_json = '{"v":"modern"}'::jsonb,
    updated_by = 'migration_062',
    updated_date = now()
WHERE scope = 'TENANT'
  AND param_key = 'appearance.default_layout'
  AND value_json = '{"v":"classic"}'::jsonb
  AND updated_by IN ('migration_049', 'migration_062');
