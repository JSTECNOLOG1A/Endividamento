CREATE TABLE natures (
  id TEXT PRIMARY KEY,
  filial TEXT NOT NULL DEFAULT '',
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  tipo_conta TEXT,
  c_custo TEXT,
  tipo_natureza TEXT NOT NULL DEFAULT 'analitica' CHECK (tipo_natureza IN ('analitica', 'sintetica')),
  origem TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'integrado')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX natures_filial_codigo_uidx ON natures (filial, codigo);

CREATE TABLE chart_of_accounts (
  id TEXT PRIMARY KEY,
  account_code TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  account_class TEXT NOT NULL DEFAULT 'despesa' CHECK (account_class IN ('ativo', 'passivo', 'receita', 'despesa', 'patrimonio_liquido')),
  account_type TEXT NOT NULL DEFAULT 'analitica' CHECK (account_type IN ('analitica', 'sintetica')),
  account_nature TEXT NOT NULL DEFAULT 'devedora' CHECK (account_nature IN ('devedora', 'credora')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);
