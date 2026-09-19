-- T8: conciliação da conta transitória. O lançamento espelho (Débito no passivo antigo / Crédito na
-- transitória) é feito pelo contador no sistema antigo; aqui se registra o valor e a referência para
-- fechar o controle "transitória = 0" por configuração.
ALTER TABLE balance_deployment_configs
  ADD COLUMN IF NOT EXISTS mirror_amount NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS mirror_reference TEXT,
  ADD COLUMN IF NOT EXISTS mirror_date DATE,
  ADD COLUMN IF NOT EXISTS mirror_by TEXT,
  ADD COLUMN IF NOT EXISTS mirror_at TIMESTAMPTZ;
