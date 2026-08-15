export function normalizeEmpresaCode(value) {
  const digits = String(value ?? "").trim().replace(/\D/g, "");
  if (!digits) return String(value ?? "").trim();
  return digits.padStart(2, "0").slice(-2);
}

export function entityScopeLabel(entity) {
  if (!entity) return "";
  const empresa = normalizeEmpresaCode(entity.codigo_empresa);
  const filial = normalizeEmpresaCode(entity.codigo_filial);
  if (empresa && filial) return `${empresa}/${filial}`;
  if (empresa) return empresa;
  return "";
}

export function entityLabel(entity) {
  if (!entity) return "";
  const scope = entityScopeLabel(entity);
  return scope ? `${entity.entity_name} (${scope})` : entity.entity_name;
}
