export function isProtheusErp(erpNome) {
  const name = (erpNome ?? "").trim().toLowerCase();
  return name.includes("protheus") || name.includes("totvs");
}

export function normalizeGrupoEmpresas(grupo) {
  const digits = (grupo ?? "").trim().replace(/\D/g, "");
  if (!digits) return "";
  return digits.padStart(2, "0").slice(-2);
}

export function protheusTableName(alias, grupoEmpresas) {
  const grupo = normalizeGrupoEmpresas(grupoEmpresas);
  const clean = alias.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const alias3 = clean.slice(0, 3);
  if (!grupo || alias3.length !== 3) return clean || alias.toUpperCase();
  return `${alias3}${grupo}0`;
}

export function setQueryParams(path, params) {
  const question = path.indexOf("?");
  const pathname = question >= 0 ? path.slice(0, question) : path;
  const search = question >= 0 ? path.slice(question + 1) : "";
  const existing = new URLSearchParams(search);
  for (const [key, value] of Object.entries(params)) {
    for (const current of [...existing.keys()]) {
      if (current.toLowerCase() === key.toLowerCase()) existing.delete(current);
    }
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    existing.set(key, text);
  }
  const qs = existing.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function replaceTableName(path, tableName) {
  if (!tableName) return path;
  if (/tableName=/i.test(path)) {
    return path.replace(/tableName=[^&]*/i, `tableName=${encodeURIComponent(tableName)}`);
  }
  return path;
}

export function replaceTableAlias(path, alias) {
  const raw = String(path || "");
  if (!alias) return null;
  if (/\/alias\/[A-Za-z0-9_]+/i.test(raw)) {
    return raw.replace(/\/alias\/[A-Za-z0-9_]+/i, `/alias/${alias}`);
  }
  if (/tableName=/i.test(raw)) {
    return replaceTableName(raw, alias);
  }
  return null;
}

export function usesProtheusQueryContext(path) {
  return /tabledata|genericAdapter|\/api\/framework\//i.test(String(path || ""));
}

export function protheusContextHeaders(ctx = {}) {
  if (!isProtheusErp(ctx.erpNome)) return {};
  const headers = {};
  const grupo = normalizeGrupoEmpresas(ctx.grupoEmpresas);
  const empresa = String(ctx.empresa || "").trim();
  const filial = String(ctx.filial || "").trim();
  if (grupo) headers.tenantId = grupo;
  if (empresa) headers.company = empresa;
  if (filial) headers.branch = filial;
  return headers;
}

export function applyProtheusContext(path, ctx = {}) {
  if (!isProtheusErp(ctx.erpNome)) return path;
  if (!usesProtheusQueryContext(path)) return path;

  const grupo = normalizeGrupoEmpresas(ctx.grupoEmpresas);
  const empresa = (ctx.empresa ?? "").trim();
  const filial = (ctx.filial ?? "").trim();
  if (!grupo && !empresa && !filial) return path;

  return setQueryParams(path, {
    tenantId: grupo || null,
    company: empresa || null,
    branch: filial || null,
  });
}
