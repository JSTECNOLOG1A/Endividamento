ALTER TABLE scheduled_jobs
  ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT 'intervalo',
  ADD COLUMN IF NOT EXISTS dia_mes INTEGER,
  ADD COLUMN IF NOT EXISTS hora_execucao TIME;

ALTER TABLE scheduled_jobs DROP CONSTRAINT IF EXISTS scheduled_jobs_modo_check;
ALTER TABLE scheduled_jobs
  ADD CONSTRAINT scheduled_jobs_modo_check
  CHECK (modo IN ('intervalo', 'mensal'));

ALTER TABLE scheduled_jobs DROP CONSTRAINT IF EXISTS scheduled_jobs_dia_mes_check;
ALTER TABLE scheduled_jobs
  ADD CONSTRAINT scheduled_jobs_dia_mes_check
  CHECK (dia_mes IS NULL OR (dia_mes >= 1 AND dia_mes <= 31));

UPDATE scheduled_jobs
SET
  modo = 'mensal',
  dia_mes = 1,
  hora_execucao = TIME '00:10',
  intervalo_minutos = 1440
WHERE tarefa = 'converter_titulos_pr_tx';
