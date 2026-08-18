UPDATE integration_endpoints
SET path = regexp_replace(
      regexp_replace(path, '/estornarReceber', '/receber', 'gi'),
      '/receber/(extornar|estornar)$',
      '/receber',
      'gi'
    ),
    nome = 'Estornar títulos a receber'
WHERE cadastro_key = 'titulos_receber_extornar'
  AND path !~* '/receber$';

UPDATE integration_endpoints
SET path = regexp_replace(
      regexp_replace(path, '/consultarReceber', '/receber', 'gi'),
      '/receber/consultar$',
      '/receber',
      'gi'
    ),
    nome = 'Consultar títulos a receber'
WHERE cadastro_key = 'titulos_receber_consultar'
  AND path !~* '/receber$';
