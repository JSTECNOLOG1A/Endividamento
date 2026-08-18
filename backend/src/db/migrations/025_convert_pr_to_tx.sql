ALTER TABLE payable_titles
  ADD COLUMN IF NOT EXISTS converted_pr_tx_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payable_titles_converted_pr_tx_idx
  ON payable_titles (converted_pr_tx_em)
  WHERE converted_pr_tx_em IS NOT NULL;

INSERT INTO scheduled_jobs (
  id, nome, tarefa, intervalo_minutos, ativo, proxima_execucao_em, created_by
) VALUES (
  'AGD-PRTX-001',
  'Converter juros PR em TX no virar do mês',
  'converter_titulos_pr_tx',
  1440,
  TRUE,
  now(),
  'system'
)
ON CONFLICT (tarefa) DO NOTHING;
