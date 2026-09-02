UPDATE tenants
SET domain = lower(btrim(domain))
WHERE domain IS NOT NULL AND domain <> lower(btrim(domain));

DROP INDEX IF EXISTS tenants_domain_uidx;
CREATE UNIQUE INDEX tenants_domain_uidx
  ON tenants (lower(domain))
  WHERE domain IS NOT NULL AND btrim(domain) <> '';

DROP INDEX IF EXISTS tenant_signups_domain_pending_uidx;
CREATE UNIQUE INDEX tenant_signups_domain_pending_uidx
  ON tenant_signups (lower(domain))
  WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS groups_domain_uidx
  ON groups (lower(extra_json->>'domain'))
  WHERE extra_json ? 'domain'
    AND btrim(COALESCE(extra_json->>'domain', '')) <> '';
