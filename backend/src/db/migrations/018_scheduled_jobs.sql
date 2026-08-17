CREATE TABLE scheduled_jobs (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tarefa TEXT NOT NULL,
  intervalo_minutos INTEGER NOT NULL CHECK (intervalo_minutos >= 1 AND intervalo_minutos <= 1440),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  executando BOOLEAN NOT NULL DEFAULT FALSE,
  ultima_execucao_em TIMESTAMPTZ,
  ultima_execucao_ok BOOLEAN,
  ultima_mensagem TEXT,
  proxima_execucao_em TIMESTAMPTZ,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX scheduled_jobs_tarefa_uidx ON scheduled_jobs (tarefa);

CREATE TABLE scheduled_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT REFERENCES scheduled_jobs(id) ON DELETE SET NULL,
  tarefa TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('automatico', 'manual')),
  ok BOOLEAN NOT NULL,
  mensagem TEXT,
  detalhes JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX scheduled_job_runs_job_started_idx
  ON scheduled_job_runs (job_id, started_at DESC);
