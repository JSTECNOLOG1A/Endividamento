-- Preferências pessoais do usuário dentro de um cliente (grupo), e o registro dos alertas diários da Gestão Tributária.
-- Só tabelas novas: a imagem anterior não as conhece e continua funcionando.

-- Uma linha por usuário, cliente e chave. Sem linha = vale o padrão da chave (definido no código, preferences/service.js).
-- O e-mail fica gravado em minúsculas: a mesma pessoa não ganha duas preferências por causa de maiúscula.
CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  user_email TEXT NOT NULL CHECK (user_email = lower(user_email)),
  -- dashboard_tributos: vencimentos dos tributos junto dos bancários no Dashboard.
  -- alertas_tributarios: resumo diário por e-mail dos vencimentos dos tributos.
  chave TEXT NOT NULL CHECK (chave IN ('dashboard_tributos', 'alertas_tributarios')),
  ligado BOOLEAN NOT NULL,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_key_uidx ON user_preferences (group_id, user_email, chave);

-- Resumo diário de vencimentos dos tributos enviado a um usuário: no máximo um por usuário, cliente e dia (data civil
-- de Brasília). A linha é reservada antes do envio ("enviando"); só um resumo que falhou pode ser tentado de novo no
-- mesmo dia, até o limite de tentativas do código. "enviando" que não terminou não é repetido: o e-mail pode ter saído.
CREATE TABLE IF NOT EXISTS tax_alert_sends (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  user_email TEXT NOT NULL CHECK (user_email = lower(user_email)),
  data_referencia DATE NOT NULL,
  situacao TEXT NOT NULL CHECK (situacao IN ('enviando', 'enviado', 'falhou')),
  tentativas INTEGER NOT NULL DEFAULT 1 CHECK (tentativas > 0),
  -- Quantidades avisadas no resumo: a_vencer, vencidas, guia_pendente.
  resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
  assunto TEXT,
  -- Texto técnico do servidor de e-mail (fica só no banco e no log).
  erro TEXT,
  enviado_em TIMESTAMPTZ,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_alert_sends_day_uidx ON tax_alert_sends (group_id, user_email, data_referencia);
CREATE INDEX IF NOT EXISTS tax_alert_sends_group_idx ON tax_alert_sends (group_id, data_referencia DESC);
