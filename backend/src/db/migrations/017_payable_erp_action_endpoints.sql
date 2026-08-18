INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
SELECT
  e.integration_id,
  'Estornar títulos a pagar',
  'POST',
  CASE
    WHEN regexp_replace(split_part(e.path, '?', 1), '/+$', '') ~* '/(extornar|estornar)$'
      THEN e.path
    ELSE regexp_replace(split_part(e.path, '?', 1), '/+$', '')
      || '/extornar'
      || CASE WHEN e.path LIKE '%?%' THEN '?' || split_part(e.path, '?', 2) ELSE '' END
  END,
  'titulos_pagar_extornar',
  e.sort_order + 1
FROM integration_endpoints e
WHERE e.cadastro_key = 'titulos_pagar'
  AND upper(e.metodo) = 'POST'
  AND NOT EXISTS (
    SELECT 1 FROM integration_endpoints x
    WHERE x.cadastro_key = 'titulos_pagar_extornar'
  );

INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
SELECT
  e.integration_id,
  'Consultar títulos a pagar',
  'POST',
  CASE
    WHEN regexp_replace(split_part(e.path, '?', 1), '/+$', '') ~* '/consultar$'
      THEN e.path
    ELSE regexp_replace(split_part(e.path, '?', 1), '/+$', '')
      || '/consultar'
      || CASE WHEN e.path LIKE '%?%' THEN '?' || split_part(e.path, '?', 2) ELSE '' END
  END,
  'titulos_pagar_consultar',
  e.sort_order + 2
FROM integration_endpoints e
WHERE e.cadastro_key = 'titulos_pagar'
  AND upper(e.metodo) = 'POST'
  AND NOT EXISTS (
    SELECT 1 FROM integration_endpoints x
    WHERE x.cadastro_key = 'titulos_pagar_consultar'
  );
