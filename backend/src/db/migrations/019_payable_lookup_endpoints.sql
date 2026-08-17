INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
SELECT
  e.integration_id,
  'Tipos de título',
  'GET',
  CASE
    WHEN e.path ~* '/alias/[A-Za-z0-9_]+' THEN regexp_replace(e.path, '/alias/[A-Za-z0-9_]+', '/alias/SX5', 'i')
    WHEN e.path ~* 'tableName=' THEN regexp_replace(e.path, 'tableName=[^&]*', 'tableName=SX5', 'i')
    ELSE '/api/fin/v1/tabledata/alias/SX5'
  END,
  'tipos_titulo',
  e.sort_order + 20
FROM integration_endpoints e
WHERE e.cadastro_key = 'naturezas'
  AND upper(e.metodo) = 'GET'
  AND NOT EXISTS (
    SELECT 1 FROM integration_endpoints x
    WHERE x.cadastro_key = 'tipos_titulo'
  );

INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
SELECT
  e.integration_id,
  'Fornecedores',
  'GET',
  CASE
    WHEN e.path ~* '/alias/[A-Za-z0-9_]+' THEN regexp_replace(e.path, '/alias/[A-Za-z0-9_]+', '/alias/SA2', 'i')
    WHEN e.path ~* 'tableName=' THEN regexp_replace(e.path, 'tableName=[^&]*', 'tableName=SA2', 'i')
    ELSE '/api/fin/v1/tabledata/alias/SA2'
  END,
  'fornecedores',
  e.sort_order + 21
FROM integration_endpoints e
WHERE e.cadastro_key = 'naturezas'
  AND upper(e.metodo) = 'GET'
  AND NOT EXISTS (
    SELECT 1 FROM integration_endpoints x
    WHERE x.cadastro_key = 'fornecedores'
  );
