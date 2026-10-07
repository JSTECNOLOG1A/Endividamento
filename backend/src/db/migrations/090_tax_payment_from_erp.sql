-- Gestão Tributária: pagamento da parcela registrado a partir da baixa do título de tributo no Protheus.
-- Na parcela, a origem do pagamento (protheus) e de qual título veio; vazio = registrado à mão (como antes).
ALTER TABLE tax_installments ADD COLUMN IF NOT EXISTS pagamento_origem TEXT;
ALTER TABLE tax_installments ADD COLUMN IF NOT EXISTS pagamento_titulo_id TEXT;
ALTER TABLE tax_installments ADD COLUMN IF NOT EXISTS pagamento_registrado_em TIMESTAMPTZ;
ALTER TABLE tax_installments ADD CONSTRAINT tax_installments_pagamento_origem_check
  CHECK (pagamento_origem IS NULL OR pagamento_origem = 'protheus');
-- No título, quando ele moveu a parcela (uma vez só: depois disso a parcela é de quem a editar).
ALTER TABLE tax_payable_titles ADD COLUMN IF NOT EXISTS parcela_atualizada_em TIMESTAMPTZ;
