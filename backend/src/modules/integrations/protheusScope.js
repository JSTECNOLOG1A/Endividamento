import * as integrationStore from "./store.js";
import { fetchErpJson } from "./erpConnection.js";
import { asTrimmedString, extractArray, flattenItem, isErpBlockedRecord, isErpDeletedRecord, lookup, lookupLoose } from "./erpJson.js";
import { logger } from "../../logger.js";
import {
  applyProtheusContext,
  isProtheusErp,
  protheusTableName,
  replaceTableAlias,
  replaceTableName,
  setQueryParams,
} from "./protheus.js";

const PAGE_SIZE = 500;
const MAX_PAGES = 40;
const MAX_SCOPES = 50;
const SCOPE_CONCURRENCY = 3;

function scopeKey(scope) {
  return `${scope.empresa ?? ""}::${scope.filial ?? ""}`;
}

function uniqueScopes(scopes) {
  const seen = new Set();
  const unique = [];
  for (const scope of scopes) {
    const empresa = String(scope.empresa ?? "").trim();
    const filial = String(scope.filial ?? "").trim();
    if (!empresa && !filial) continue;
    const key = `${empresa}::${filial}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      empresa,
      filial,
      nome: scope.nome || null,
    });
    if (unique.length >= MAX_SCOPES) break;
  }
  return unique;
}

function uniqueCompanies(scopes) {
  const seen = new Set();
  const unique = [];
  for (const scope of scopes || []) {
    const empresa = String(scope.empresa ?? "").trim();
    const key = empresa || "__group__";
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      empresa,
      filial: "",
      nome: scope.nome || null,
    });
    if (unique.length >= MAX_SCOPES) break;
  }
  return unique.length ? unique : [{ empresa: "", filial: "" }];
}

export function parseProtheusScopes(payload) {
  const parsed = [];
  for (const item of extractArray(payload)) {
    const record = flattenItem(item);
    if (!record) continue;
    if (isErpDeletedRecord(record) || isErpBlockedRecord(record)) continue;

    const filial = asTrimmedString(lookup(record, [
      "m0_codfil", "codfil", "cod_filial", "filial", "branch", "branchid", "branchId", "branchCode", "fil",
    ])) ?? "";
    let empresa = asTrimmedString(lookup(record, [
      "m0_codigo", "codemp", "cod_empresa", "codigoempresa", "empresa", "company", "companyid", "companyId", "companyCode", "emp",
    ])) ?? "";
    const code = asTrimmedString(lookup(record, ["code", "id", "codigo"])) ?? "";
    if (!empresa && code && code !== filial) empresa = code;
    const nome = asTrimmedString(lookup(record, [
      "m0_filial", "m0_nome", "m0_nomecom", "nome", "name", "companyName", "branchName",
    ]));

    if (empresa || filial) {
      parsed.push({ empresa, filial, nome });
      continue;
    }
    if (code) parsed.push({ empresa: code, filial: "", nome });
  }
  return uniqueScopes(parsed);
}

function connectionContext(integration, overrides = {}) {
  return {
    erpNome: integration.erpNome,
    grupoEmpresas: integration.grupoEmpresas,
    empresa: overrides.empresa ?? "",
    filial: overrides.filial ?? "",
  };
}

function requestParams(integration, credential, path, overrides = {}) {
  return {
    baseUrl: integration.baseUrl,
    path,
    authType: integration.authType,
    authHeader: integration.authHeader,
    username: integration.username,
    credential,
    timeoutSeconds: Math.max(integration.timeoutSeconds || 30, 60),
    erpNome: integration.erpNome,
    grupoEmpresas: integration.grupoEmpresas,
    empresa: overrides.empresa ?? integration.empresa,
    filial: overrides.filial ?? integration.filial,
  };
}

async function tryFetchJson(integration, credential, path) {
  try {
    const fetched = await fetchErpJson(requestParams(integration, credential, path));
    if (fetched.statusCode < 200 || fetched.statusCode >= 300) return null;
    return fetched.data;
  } catch {
    return null;
  }
}

async function fetchPagedItems(integration, credential, path) {
  if (!/tabledata/i.test(path)) {
    const data = await tryFetchJson(integration, credential, path);
    return data ? extractArray(data) : [];
  }

  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const paged = setQueryParams(path, { pageSize: PAGE_SIZE, page: String(page) });
    const data = await tryFetchJson(integration, credential, paged);
    if (data == null) {
      if (page === 1) return [];
      break;
    }
    const chunk = extractArray(data);
    items.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return items;
}

async function tryFetchBranches(integration, credential, empresa) {
  if (!empresa) return [];
  const path = applyProtheusContext(`/api/framework/v1/companies/${encodeURIComponent(empresa)}/branches`, connectionContext(integration, { empresa }));
  const data = await tryFetchJson(integration, credential, path);
  if (!data) return [];
  const scopes = parseProtheusScopes(data).map((scope) => ({
    ...scope,
    empresa: scope.empresa || empresa,
  }));
  return uniqueScopes(scopes.length ? scopes : [{ empresa, filial: "" }]);
}

async function expandCompanyBranches(integration, credential, scopes) {
  if (!scopes.length) return scopes;
  if (scopes.some((scope) => scope.filial)) return uniqueScopes(scopes);

  const expanded = [];
  for (const scope of scopes) {
    const branches = await tryFetchBranches(integration, credential, scope.empresa);
    if (branches.length) expanded.push(...branches);
    else expanded.push(scope);
  }
  return uniqueScopes(expanded);
}

async function discoverFromLinkedEmpresas(integration, credential) {
  const linked = await integrationStore.findLinkedCadastro("empresas", "GET");
  if (!linked || linked.integration.id !== integration.id) return [];
  const path = applyProtheusContext(linked.endpoint.path, connectionContext(integration));
  const items = await fetchPagedItems(linked.integration, credential, path);
  return expandCompanyBranches(integration, credential, parseProtheusScopes(items));
}

async function discoverFromSigamat(integration, credential, cadastroPath = "") {
  const candidates = [];
  if (/tableName=/i.test(cadastroPath)) {
    candidates.push(replaceTableName(cadastroPath, "SM0"));
    candidates.push(replaceTableName(cadastroPath, "SIGAMAT"));
  }
  candidates.push("/api/framework/v1/genericAdapter/tabledata?tableName=SM0");
  candidates.push("/api/framework/v1/genericAdapter/tabledata?tableName=SIGAMAT");
  candidates.push("/api/framework/v1/companies");

  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const withTenant = applyProtheusContext(candidate, connectionContext(integration));
    let items = await fetchPagedItems(integration, credential, withTenant);
    if (!items.length && integration.empresa) {
      const withCompany = applyProtheusContext(candidate, connectionContext(integration, { empresa: integration.empresa }));
      items = await fetchPagedItems(integration, credential, withCompany);
    }
    const scopes = parseProtheusScopes(items);
    if (scopes.length) return expandCompanyBranches(integration, credential, scopes);
  }
  return [];
}

export async function resolveProtheusScopes(integration, credential, cadastroPath = "") {
  if (!isProtheusErp(integration.erpNome)) {
    return uniqueScopes([{ empresa: integration.empresa || "", filial: integration.filial || "" }]);
  }

  const fromEmpresas = await discoverFromLinkedEmpresas(integration, credential);
  if (fromEmpresas.length) return fromEmpresas;

  const fromSigamat = await discoverFromSigamat(integration, credential, cadastroPath);
  if (fromSigamat.length) return fromSigamat;

  return [{ empresa: "", filial: "" }];
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, () => worker()));
  return results;
}

async function fetchScopePayload(integration, credential, path, scope) {
  const scopedPath = applyProtheusContext(path, connectionContext(integration, scope));
  if (!/tabledata/i.test(scopedPath)) {
    const fetched = await fetchErpJson(requestParams(integration, credential, scopedPath, scope));
    return fetched;
  }

  const items = [];
  let last = { statusCode: 200, data: [] };
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const paged = setQueryParams(scopedPath, { pageSize: PAGE_SIZE, page: String(page) });
    const fetched = await fetchErpJson(requestParams(integration, credential, paged, scope));
    last = fetched;
    if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
      if (page === 1) return fetched;
      break;
    }
    const chunk = extractArray(fetched.data);
    items.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return { statusCode: last.statusCode, data: items };
}

export async function fetchCadastroAcrossGroup({
  integration,
  credential,
  path,
  parseItems,
  includeBranches = true,
}) {
  const discovered = await resolveProtheusScopes(integration, credential, path);
  const scopes = includeBranches ? discovered : uniqueCompanies(discovered);
  const merged = [];
  const failures = [];

  const results = await mapPool(scopes, SCOPE_CONCURRENCY, async (scope) => {
    try {
      const fetched = await fetchScopePayload(integration, credential, path, scope);
      if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
        return { ok: false, scope, error: `HTTP ${fetched.statusCode}` };
      }
      const items = parseItems(fetched.data, scope) || [];
      return { ok: true, scope, items };
    } catch (error) {
      return { ok: false, scope, error: error.message || "falha ao consultar o ERP" };
    }
  });

  for (const result of results) {
    if (!result?.ok) {
      failures.push(result);
      continue;
    }
    merged.push(...result.items);
  }

  if (!merged.length && failures.length) {
    const err = new Error(`O ERP não retornou o cadastro em nenhuma empresa/filial do grupo (${failures[0].error})`);
    err.status = 502;
    throw err;
  }

  return {
    items: merged,
    scopes,
    queried: scopes.length,
    failed: failures.length,
  };
}

export { scopeKey };

export function normalizeCnpjDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeFilialCode(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (!digits) return text;
  return digits.length <= 2 ? digits.padStart(2, "0") : digits;
}

export function parseSm0Records(payload) {
  const parsed = [];
  const seen = new Set();
  for (const item of extractArray(payload)) {
    const record = flattenItem(item);
    if (!record) continue;
    if (isErpDeletedRecord(record) || isErpBlockedRecord(record)) continue;

    const filial = normalizeFilialCode(lookupLoose(record, [
      "m0_codfil", "codfil", "cod_filial", "filial", "branch", "branchid", "branchId", "branchCode", "fil",
    ]) ?? "");
    let empresa = asTrimmedString(lookupLoose(record, [
      "m0_codigo", "codemp", "cod_empresa", "codigoempresa", "empresa", "company", "companyid", "companyId", "companyCode", "emp",
    ])) ?? "";
    const code = asTrimmedString(lookupLoose(record, ["code", "id", "codigo"])) ?? "";
    if (!empresa && code && code !== filial) empresa = code;
    empresa = normalizeFilialCode(empresa) || empresa;
    const cnpj = normalizeCnpjDigits(lookupLoose(record, [
      "m0_cgc", "cgc", "cnpj", "federalid", "federalId", "cgccpf", "m0_cgccpf", "taxid", "taxId",
    ]));
    const nome = asTrimmedString(lookupLoose(record, [
      "m0_filial", "m0_nome", "m0_nomecom", "nome", "name", "companyName", "branchName",
    ]));

    if (!empresa && !filial && !cnpj) continue;
    const key = `${empresa}::${filial}::${cnpj}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ empresa, filial, cnpj, nome });
  }
  return parsed;
}

export function matchSm0ByEntity(entity, records = []) {
  const cnpj = normalizeCnpjDigits(entity?.document_number);
  if (cnpj) {
    const hits = (records || []).filter((row) => row.cnpj && row.cnpj === cnpj);
    if (hits.length) {
      const empresa = String(entity?.codigo_empresa || "").replace(/\D/g, "");
      const empresaHits = empresa
        ? hits.filter((row) => String(row.empresa || "").replace(/\D/g, "").padStart(2, "0").slice(-2)
          === empresa.padStart(2, "0").slice(-2))
        : [];
      const pool = empresaHits.length ? empresaHits : hits;
      const filialCadastro = normalizeFilialCode(entity?.codigo_filial);
      if (filialCadastro) {
        const exact = pool.find((row) => {
          const sm0Filial = normalizeFilialCode(row.filial);
          return sm0Filial === filialCadastro || sm0Filial.endsWith(filialCadastro);
        });
        if (exact) return { match: exact, reason: "ok" };
      }
      const sorted = pool.slice().sort((a, b) => String(a.filial || "").localeCompare(String(b.filial || "")));
      return { match: sorted[0], reason: sorted.length > 1 ? "ok_ambiguo" : "ok" };
    }
    if ((records || []).some((row) => row.cnpj)) {
      return { match: null, reason: "cnpj_nao_encontrado" };
    }
  }

  const empresa = String(entity?.codigo_empresa || "").replace(/\D/g, "");
  const filialCadastro = normalizeFilialCode(entity?.codigo_filial);
  if (empresa) {
    const byEmp = (records || []).filter((row) => (
      String(row.empresa || "").replace(/\D/g, "").padStart(2, "0").slice(-2) === empresa.padStart(2, "0").slice(-2)
    ));
    if (filialCadastro) {
      const exact = byEmp.find((row) => normalizeFilialCode(row.filial) === filialCadastro);
      if (exact) return { match: exact, reason: "ok_codigo" };
    }
    if (byEmp.length === 1) return { match: byEmp[0], reason: "ok_empresa" };
  }

  if (!cnpj) return { match: null, reason: "cnpj_ausente" };
  return { match: null, reason: "cnpj_nao_encontrado" };
}

export function se2FilialFromSm0(match, entity) {
  const empresa = normalizeFilialCode(match?.empresa || entity?.codigo_empresa);
  let unidade = normalizeFilialCode(match?.filial || entity?.codigo_filial);
  if (!empresa || !unidade) return null;
  let filialOrigem;
  if (unidade.length >= 4 && unidade.startsWith(empresa)) {
    filialOrigem = unidade;
    unidade = unidade.slice(-2);
  } else {
    filialOrigem = `${empresa}${unidade}`;
  }
  return {
    empresa,
    unidade,
    filial: empresa,
    e2Filial: empresa,
    filialOrigem,
  };
}

function collectSm0CandidatePaths(integration, linkedEmpresas, cadastroPath, endpoints = []) {
  const candidates = [];
  const push = (path) => {
    const text = String(path || "").trim();
    if (text) candidates.push(text);
  };

  if (linkedEmpresas && (linkedEmpresas.integration.id === integration.id || linkedEmpresas.integration.baseUrl === integration.baseUrl)) {
    push(linkedEmpresas.endpoint.path);
  }
  push(cadastroPath);

  for (const endpoint of endpoints) {
    if (String(endpoint.metodo || "").toUpperCase() !== "GET") continue;
    push(replaceTableAlias(endpoint.path, "SM0"));
    push(replaceTableAlias(endpoint.path, "SIGAMAT"));
    const physical = protheusTableName("SM0", integration.grupoEmpresas);
    if (physical && physical !== "SM0") push(replaceTableAlias(endpoint.path, physical));
  }

  push("/api/fin/v1/tabledata/alias/SM0");
  push("/api/fin/v1/tabledata/alias/SIGAMAT");
  if (/tableName=/i.test(cadastroPath)) {
    push(replaceTableName(cadastroPath, "SM0"));
    push(replaceTableName(cadastroPath, "SIGAMAT"));
  }
  push("/api/framework/v1/genericAdapter/tabledata?tableName=SM0");
  push("/api/framework/v1/genericAdapter/tabledata?tableName=SIGAMAT");
  push("/api/framework/v1/companies");

  const seen = new Set();
  return candidates.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

export async function fetchSm0Records(integration, credential, cadastroPath = "") {
  const linked = await integrationStore.findLinkedCadastro("empresas", "GET");
  let endpoints = [];
  try {
    endpoints = await integrationStore.findEndpoints(integration.id);
  } catch {
    endpoints = [];
  }

  const candidates = collectSm0CandidatePaths(integration, linked, cadastroPath, endpoints);
  let fallback = [];
  for (const candidate of candidates) {
    const withTenant = applyProtheusContext(candidate, connectionContext(integration));
    let items = await fetchPagedItems(integration, credential, withTenant);
    if (!items.length && integration.empresa) {
      const withCompany = applyProtheusContext(candidate, connectionContext(integration, { empresa: integration.empresa }));
      items = await fetchPagedItems(integration, credential, withCompany);
    }
    const parsed = parseSm0Records(items);
    if (parsed.some((row) => row.cnpj)) {
      logger.info({ path: candidate, count: parsed.length }, "SM0 lido com CNPJ");
      return parsed;
    }
    if (parsed.length && !fallback.length) {
      logger.info({ path: candidate, count: parsed.length }, "SM0 lido sem CNPJ");
      fallback = parsed;
    }
  }
  return fallback;
}
