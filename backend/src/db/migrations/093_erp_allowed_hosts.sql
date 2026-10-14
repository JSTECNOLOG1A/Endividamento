-- Lista de endereços de ERP permitidos por cliente (anti-SSRF).
-- Faixas privadas (RFC1918/ULA) só podem ser alcançadas pela API se o host
-- ou a faixa estiver cadastrado aqui para o grupo. Loopback, link-local e
-- metadata continuam SEMPRE bloqueados, mesmo que cadastrados.
CREATE TABLE IF NOT EXISTS erp_allowed_hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  host TEXT NOT NULL,
  descricao TEXT,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_allowed_hosts_group_host_uidx
  ON erp_allowed_hosts (group_id, lower(host));

CREATE INDEX IF NOT EXISTS erp_allowed_hosts_group_idx
  ON erp_allowed_hosts (group_id);
