INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
SELECT
  e.integration_id,
  'Títulos a receber',
  'POST',
  regexp_replace(e.path, '/pagar', '/receber', 'gi'),
  'titulos_receber',
  e.sort_order + 3
FROM integration_endpoints e
WHERE e.cadastro_key = 'titulos_pagar'
  AND upper(e.metodo) = 'POST'
  AND NOT EXISTS (
    SELECT 1 FROM integration_endpoints x
    WHERE x.cadastro_key = 'titulos_receber'
  );

INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
SELECT
  e.integration_id,
  'Estornar títulos a receber',
  'POST',
  CASE
    WHEN regexp_replace(split_part(e.path, '?', 1), '/+$', '') ~* '/(extornar|estornar)$'
      THEN e.path
    ELSE regexp_replace(split_part(e.path, '?', 1), '/+$', '')
      || '/extornar'
      || CASE WHEN e.path LIKE '%?%' THEN '?' || split_part(e.path, '?', 2) ELSE '' END
  END,
  'titulos_receber_extornar',
  e.sort_order + 1
FROM integration_endpoints e
WHERE e.cadastro_key = 'titulos_receber'
  AND upper(e.metodo) = 'POST'
  AND NOT EXISTS (
    SELECT 1 FROM integration_endpoints x
    WHERE x.cadastro_key = 'titulos_receber_extornar'
  );

INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
SELECT
  e.integration_id,
  'Consultar títulos a receber',
  'POST',
  CASE
    WHEN regexp_replace(split_part(e.path, '?', 1), '/+$', '') ~* '/consultar$'
      THEN e.path
    ELSE regexp_replace(split_part(e.path, '?', 1), '/+$', '')
      || '/consultar'
      || CASE WHEN e.path LIKE '%?%' THEN '?' || split_part(e.path, '?', 2) ELSE '' END
  END,
  'titulos_receber_consultar',
  e.sort_order + 2
FROM integration_endpoints e
WHERE e.cadastro_key = 'titulos_receber'
  AND upper(e.metodo) = 'POST'
  AND NOT EXISTS (
    SELECT 1 FROM integration_endpoints x
    WHERE x.cadastro_key = 'titulos_receber_consultar'
  );

INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
SELECT
  e.integration_id,
  'Clientes',
  'GET',
  CASE
    WHEN e.path ~* '/alias/[A-Za-z0-9_]+' THEN regexp_replace(e.path, '/alias/[A-Za-z0-9_]+', '/alias/SA1', 'i')
    WHEN e.path ~* 'tableName=' THEN regexp_replace(e.path, 'tableName=[^&]*', 'tableName=SA1', 'i')
    ELSE '/api/fin/v1/tabledata/alias/SA1'
  END,
  'clientes',
  e.sort_order + 22
FROM integration_endpoints e
WHERE e.cadastro_key IN ('naturezas', 'fornecedores')
  AND upper(e.metodo) = 'GET'
  AND NOT EXISTS (
    SELECT 1 FROM integration_endpoints x
    WHERE x.cadastro_key = 'clientes'
  )
LIMIT 1;
