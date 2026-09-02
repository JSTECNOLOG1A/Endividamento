ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cargo TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS setor TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;

UPDATE users
SET
  blocked = (status = 'disabled'),
  blocked_at = CASE
    WHEN status = 'disabled' THEN COALESCE(blocked_at, updated_date)
    ELSE NULL
  END
WHERE blocked IS DISTINCT FROM (status = 'disabled')
   OR (status = 'disabled' AND blocked_at IS NULL)
   OR (status = 'active' AND blocked_at IS NOT NULL);
