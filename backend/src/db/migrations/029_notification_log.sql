-- Registro de notificações (envios de e-mail e afins). Enquanto nenhum
-- provedor de e-mail estiver configurado (ver mailer.js), toda chamada de
-- notificação cai aqui com status "simulado" — dá pra auditar exatamente o
-- que teria sido enviado, pra quem e quando, sem nenhum risco de disparo
-- real antes das credenciais existirem.
CREATE TABLE notification_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  contract_id TEXT REFERENCES loan_contracts(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'simulado' CHECK (status IN ('simulado', 'enviado', 'falhou')),
  error_message TEXT,
  extra_json JSONB,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE INDEX notification_log_contract_idx ON notification_log (contract_id);
CREATE INDEX notification_log_event_type_idx ON notification_log (event_type);
