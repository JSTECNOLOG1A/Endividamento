-- Histórico de envios por e-mail de cada proposta comercial (tela "Proposta
-- Comercial", master-only). Uma linha por tentativa: a mesma proposta pode ir
-- mais de uma vez (reenvio, outro destinatário), e a falha também fica
-- registrada para quem enviou saber o que aconteceu. O PDF não é guardado —
-- ele é gerado no navegador e só atravessa o backend a caminho do emails-api.
CREATE TABLE IF NOT EXISTS commercial_proposal_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: o histórico é prova de envio de documento comercial; excluir a
  -- proposta não pode apagá-lo em silêncio.
  proposal_id UUID NOT NULL REFERENCES commercial_proposals(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  -- Nome usado na saudação do e-mail; NULL quando foi sem nome ("Prezados,").
  recipient_name TEXT,
  sent_by_email TEXT,
  sent_by_name TEXT,
  message TEXT,
  file_name TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('enviado', 'falhou')),
  error_detail TEXT,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_proposal_sends_proposal
  ON commercial_proposal_sends (proposal_id, created_date DESC);
