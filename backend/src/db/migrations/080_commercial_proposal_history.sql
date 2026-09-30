-- Linha do tempo da proposta comercial: criação, edição salva, cada envio por
-- e-mail (inclusive a tentativa que falhou), aceite e recusa, com quem e
-- quando. Mesmo desenho de client_implementation_activity_history (077).
--
-- Este arquivo pode rodar de novo sobre dados já registrados sem duplicar
-- nada: a tabela e os índices são IF NOT EXISTS, e o preenchimento das
-- propostas antigas passa pelos índices únicos abaixo (ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS commercial_proposal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: como o histórico de envios (078), é registro comercial; excluir
  -- a proposta não pode apagá-lo em silêncio.
  proposal_id UUID NOT NULL REFERENCES commercial_proposals(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'criada', 'editada', 'email_enviado', 'email_falhou', 'aceita', 'recusada'
  )),
  -- Situação antes e depois, quando o evento muda a situação.
  previous_value TEXT,
  new_value TEXT,
  -- Contexto curto para a linha do tempo: destinatário do e-mail, motivo da
  -- recusa.
  note TEXT,
  actor TEXT,
  actor_name TEXT,
  -- Envio que gerou o evento (email_enviado / email_falhou).
  send_id UUID REFERENCES commercial_proposal_sends(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_proposal_history_proposal
  ON commercial_proposal_history (proposal_id, occurred_at DESC);

-- Um evento por fato: uma criação e um desfecho por proposta, um evento por
-- envio. Protege o preenchimento abaixo e qualquer caminho de escrita.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_proposal_history_created
  ON commercial_proposal_history (proposal_id) WHERE event_type = 'criada';
CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_proposal_history_outcome
  ON commercial_proposal_history (proposal_id) WHERE event_type IN ('aceita', 'recusada');
CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_proposal_history_send
  ON commercial_proposal_history (send_id) WHERE send_id IS NOT NULL;

-- Propostas que já existem: o que dá para reconstruir. Edições antigas não
-- deixaram rastro e não são inventadas; a situação anterior ao desfecho
-- também não é conhecida (previous_value NULL).
INSERT INTO commercial_proposal_history (proposal_id, event_type, new_value, actor, occurred_at)
SELECT p.id, 'criada', 'elaborando', p.created_by, p.created_date
FROM commercial_proposals p
ON CONFLICT DO NOTHING;

INSERT INTO commercial_proposal_history (proposal_id, event_type, note, actor, actor_name, send_id, occurred_at)
SELECT s.proposal_id,
       CASE WHEN s.result = 'enviado' THEN 'email_enviado' ELSE 'email_falhou' END,
       s.recipient_email, s.sent_by_email, s.sent_by_name, s.id, s.created_date
FROM commercial_proposal_sends s
ON CONFLICT DO NOTHING;

INSERT INTO commercial_proposal_history (proposal_id, event_type, new_value, actor, actor_name, occurred_at)
SELECT p.id, 'aceita', 'aceita', p.accepted_by_email, p.accepted_by_name, p.accepted_at
FROM commercial_proposals p
WHERE p.status = 'aceita' AND p.accepted_at IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO commercial_proposal_history (proposal_id, event_type, new_value, note, actor, actor_name, occurred_at)
SELECT p.id, 'recusada', 'recusada', p.motivo_recusa, p.rejected_by_email, p.rejected_by_name, p.rejected_at
FROM commercial_proposals p
WHERE p.status = 'recusada' AND p.rejected_at IS NOT NULL
ON CONFLICT DO NOTHING;
