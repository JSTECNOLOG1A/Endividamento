-- Acompanhamento de implantação por cliente (módulo "Implantações",
-- master-only) — cada linha de client_implementations é uma implantação em
-- curso (ou concluída) de um tenant; client_implementation_activities são as
-- 24 atividades do cronograma padrão (planilha "Controle de implantação —
-- AllDebit"), semeadas a partir do modelo fixo em
-- backend/src/modules/implementations/template.js no momento da criação.
CREATE TABLE IF NOT EXISTS client_implementations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'em_andamento'
    CHECK (status IN ('em_andamento', 'concluida', 'cancelada')),
  data_inicio DATE NOT NULL,
  previsao_conclusao DATE,
  concluida_em TIMESTAMPTZ,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_implementations_tenant
  ON client_implementations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_implementations_status
  ON client_implementations (status);

-- Status é apenas ('nao_iniciada','em_andamento','concluida',
-- 'aguardando_validacao') — "Atrasada" NUNCA é gravada aqui: é calculada em
-- tempo de leitura (prazo vencido + não concluída), pra não travar uma
-- atividade em "atrasada" caso ela seja concluída depois do prazo (mesma
-- lição da coluna "Expirada" em commercial_proposals).
CREATE TABLE IF NOT EXISTS client_implementation_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  implementation_id UUID NOT NULL REFERENCES client_implementations(id) ON DELETE CASCADE,
  stage_code TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  activity_code TEXT NOT NULL,
  activity_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  auto_check_key TEXT,
  status TEXT NOT NULL DEFAULT 'nao_iniciada'
    CHECK (status IN ('nao_iniciada', 'em_andamento', 'concluida', 'aguardando_validacao')),
  completion_mode TEXT CHECK (completion_mode IN ('automatica', 'manual')),
  needs_revalidation BOOLEAN NOT NULL DEFAULT false,
  responsavel TEXT,
  prazo DATE,
  data_conclusao TIMESTAMPTZ,
  observacoes TEXT,
  completed_by TEXT,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_implementation_activities_impl
  ON client_implementation_activities (implementation_id, sort_order);

-- Histórico: preserva conclusões, reaberturas e alterações de prazo mesmo
-- depois que o valor atual da atividade for sobrescrito.
CREATE TABLE IF NOT EXISTS client_implementation_activity_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES client_implementation_activities(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'concluida', 'reaberta', 'prazo_alterado', 'observacao_atualizada', 'sinalizada_revalidacao'
  )),
  previous_value TEXT,
  new_value TEXT,
  note TEXT,
  actor TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_implementation_activity_history_activity
  ON client_implementation_activity_history (activity_id, occurred_at DESC);
