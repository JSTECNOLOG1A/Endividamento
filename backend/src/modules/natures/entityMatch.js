export function normalizeEmpresaCode(value) {
  const digits = String(value ?? "").trim().replace(/\D/g, "");
  if (!digits) return String(value ?? "").trim();
  return digits.padStart(2, "0").slice(-2);
}

export function entityMatchesNature(entity, empresa, filial) {
  const entityEmpresa = normalizeEmpresaCode(entity?.codigo_empresa);
  const natureEmpresa = normalizeEmpresaCode(empresa) || normalizeEmpresaCode(filial);
  if (!entityEmpresa || !natureEmpresa) return false;
  return entityEmpresa === natureEmpresa;
}

export function findEntityByEmpresaFilial(entities, empresa, filial) {
  const matches = (entities || []).filter((entity) => entityMatchesNature(entity, empresa, filial));
  if (matches.length === 0) return { entity: null, ambiguous: false };
  if (matches.length === 1) return { entity: matches[0], ambiguous: false };

  const active = matches.filter((entity) => entity.status === "ativa");
  if (active.length === 1) return { entity: active[0], ambiguous: false };
  return { entity: null, ambiguous: true };
}
