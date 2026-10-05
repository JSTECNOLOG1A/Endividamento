-- Permissões de módulo por usuário dentro do tenant, ex.: {"tax": true} libera a Gestão Tributária.
-- A coluna já existia como TEXT e nunca foi preenchida por nenhum fluxo, então a troca de tipo não perde dado.
ALTER TABLE tenant_users
  ALTER COLUMN permissions TYPE JSONB USING NULL::jsonb;
