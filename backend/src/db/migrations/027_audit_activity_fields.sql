ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS actor_name TEXT,
  ADD COLUMN IF NOT EXISTS processing_type TEXT,
  ADD COLUMN IF NOT EXISTS rotina TEXT,
  ADD COLUMN IF NOT EXISTS registro TEXT,
  ADD COLUMN IF NOT EXISTS before_json JSONB,
  ADD COLUMN IF NOT EXISTS after_json JSONB;

CREATE INDEX IF NOT EXISTS idx_audit_actor_email ON audit_events (actor_email);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events (action);
CREATE INDEX IF NOT EXISTS idx_audit_rotina ON audit_events (rotina);
CREATE INDEX IF NOT EXISTS idx_audit_processing ON audit_events (processing_type);
