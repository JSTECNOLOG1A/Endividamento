-- Append-only audit (ISO/IEC 27001 A.8.15 / A.8.10)
CREATE OR REPLACE FUNCTION forbid_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_events;
CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE PROCEDURE forbid_audit_mutation();

-- Immutable calculation snapshots
CREATE OR REPLACE FUNCTION forbid_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'calculation_snapshots are immutable';
  END IF;
  IF OLD.immutable_flag IS TRUE THEN
    RAISE EXCEPTION 'calculation_snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_immutable ON calculation_snapshots;
CREATE TRIGGER trg_snapshot_immutable
BEFORE UPDATE OR DELETE ON calculation_snapshots
FOR EACH ROW EXECUTE PROCEDURE forbid_snapshot_mutation();
