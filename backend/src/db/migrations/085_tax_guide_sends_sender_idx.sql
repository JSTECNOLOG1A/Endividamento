-- Gestão Tributária: limite de envios de guia por e-mail por usuário (tentativas da última hora).
CREATE INDEX IF NOT EXISTS tax_guide_sends_sender_idx ON tax_guide_sends (enviado_por, created_date DESC);
