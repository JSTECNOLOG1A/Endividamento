UPDATE integration_endpoints
SET path = regexp_replace(path, '/receber/extornar', '/estornarReceber', 'gi'),
    nome = 'Estornar títulos a receber'
WHERE cadastro_key = 'titulos_receber_extornar'
  AND path ~* '/receber/extornar';

UPDATE integration_endpoints
SET path = regexp_replace(path, '/receber/consultar', '/consultarReceber', 'gi'),
    nome = 'Consultar títulos a receber'
WHERE cadastro_key = 'titulos_receber_consultar'
  AND path ~* '/receber/consultar';
