CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  descricao TEXT,
  erp_nome TEXT,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'api_key', 'bearer', 'basic')),
  auth_header TEXT,
  username TEXT,
  credential_encrypted TEXT,
  grupo_empresas TEXT NOT NULL DEFAULT '',
  empresa TEXT NOT NULL DEFAULT '',
  filial TEXT NOT NULL DEFAULT '',
  timeout_seconds INTEGER NOT NULL DEFAULT 30 CHECK (timeout_seconds BETWEEN 5 AND 120),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE INDEX integrations_status_idx ON integrations (status);
CREATE INDEX integrations_code_idx ON integrations (code);

CREATE TABLE integration_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  metodo TEXT NOT NULL DEFAULT 'GET' CHECK (metodo IN ('GET', 'POST', 'PUT', 'PATCH')),
  path TEXT NOT NULL,
  cadastro_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX integration_endpoints_integration_id_idx ON integration_endpoints (integration_id);
CREATE UNIQUE INDEX integration_endpoints_cadastro_key_metodo_uidx
  ON integration_endpoints (cadastro_key, metodo)
  WHERE cadastro_key IS NOT NULL;
