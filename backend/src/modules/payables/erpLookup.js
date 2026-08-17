import * as integrationStore from "../integrations/store.js";
import { decryptSecret } from "../integrations/crypto.js";
import { fetchErpJson } from "../integrations/erpConnection.js";
import {
  asTrimmedString,
  extractArray,
  flattenItem,
  isErpBlockedRecord,
  isErpDeletedRecord,
  lookupLoose,
} from "../integrations/erpJson.js";
import { applyProtheusContext, isProtheusErp, setQueryParams } from "../integrations/protheus.js";
import { logger } from "../../logger.js";

const RESULT_LIMIT = 40;
const LOOKUP_TIMEOUT_SECONDS = 20;
const TABLEDATA_PAGE_SIZE = 200;
const TABLEDATA_MAX_PAGES = 40;
const TABLEDATA_CONCURRENCY = 4;
const SUPPLIER_FIELDS = "A2_COD,A2_LOJA,A2_NREDUZ,A2_NOME,A2_CGC,A2_MSBLQL";
const CACHE_MS = 10 * 60 * 1000;

const supplierCache = new Map();

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function lookupPathFromTitulos(path, resource) {
  const raw = String(path || "").trim();
  const [pathname, query] = raw.split("?");
  const clean = String(pathname || "").replace(/\/+$/, "");
  const pagarBase = /\/pagar$/i.test(clean)
    ? clean
    : `${clean.replace(/\/pagar(\/.*)?$/i, "") || "/FinRestTitulos"}/pagar`;
  const next = `${pagarBase}/${resource}`;
  return query ? `${next}?${query}` : next;
}

function jobContext(integration) {
  return {
    erpNome: integration.erpNome,
    grupoEmpresas: integration.grupoEmpresas || "01",
    empresa: "",
    filial: "",
  };
}

function requestParams(integration, credential, path, extra = {}) {
  const ctx = jobContext(integration);
  return {
    baseUrl: integration.baseUrl,
    path: isProtheusErp(ctx.erpNome) ? applyProtheusContext(path, ctx) : path,
    authType: integration.authType,
    authHeader: integration.authHeader,
    username: integration.username,
    credential,
    timeoutSeconds: LOOKUP_TIMEOUT_SECONDS,
    ...ctx,
    ...extra,
  };
}

async function loadCredential(integration) {
  const credRow = await integrationStore.findCredential(integration.id);
  const credential = credRow?.credential_encrypted
    ? decryptSecret(credRow.credential_encrypted)
    : null;
  if (integration.authType !== "none" && !credential) {
    throw httpError(400, "A conexão vinculada não possui credencial cadastrada.");
  }
  return credential;
}

async function loadLinkedGet(cadastroKey, label) {
  const linked = await integrationStore.findLinkedCadastro(cadastroKey, "GET");
  if (!linked) {
    throw httpError(
      400,
      `Nenhum endpoint GET vinculado a ${label}. Configure o GET tabledata em Integrações.`
    );
  }
  if (linked.integration.status !== "ativo") {
    throw httpError(400, `A conexão "${linked.integration.nome}" está inativa. Ative-a em Integrações.`);
  }
  const credential = await loadCredential(linked.integration);
  return { linked, credential };
}

function padCode(value, size) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (digits && digits.length <= size) return digits.padStart(size, "0");
  return text.slice(0, size);
}

function compactText(value) {
  return String(value || "").toLowerCase().replace(/[\s./-]+/g, "");
}

function matchesSearch(fields, search) {
  const query = String(search || "").trim().toLowerCase();
  if (!query) return true;
  const compact = compactText(query);
  const digits = query.replace(/\D/g, "");
  return fields.some((field) => {
    const text = String(field || "").toLowerCase();
    if (!text) return false;
    if (text.includes(query)) return true;
    if (compact && compactText(text).includes(compact)) return true;
    if (digits.length >= 3 && text.replace(/\D/g, "").includes(digits)) return true;
    return false;
  });
}

export function parseTitleTypesFromErp(payload) {
  const parsed = [];
  const seen = new Set();

  for (const item of extractArray(payload)) {
    const record = flattenItem(item);
    if (!record) continue;
    if (isErpDeletedRecord(record) || isErpBlockedRecord(record)) continue;

    const tabela = asTrimmedString(lookupLoose(record, [
      "x5_tabela", "tabela", "table", "grupo", "x5tabela",
    ])) || "";
    if (tabela && tabela.replace(/^0+/g, "") !== "5") continue;

    const codigo = asTrimmedString(lookupLoose(record, [
      "x5_chave", "chave", "tipo", "code", "codigo", "e2_tipo", "tipotitulo",
    ]));
    const descricao = asTrimmedString(lookupLoose(record, [
      "x5_descri", "x5_descric", "descricao", "description", "desc", "nome",
    ])) || codigo;
    if (!codigo) continue;

    const typeCode = codigo.trim().toUpperCase();
    if (typeCode.length > 3) continue;
    if (seen.has(typeCode)) continue;
    seen.add(typeCode);
    parsed.push({ tabela, codigo: typeCode, descricao: descricao.trim() });
  }

  return parsed;
}

export function parseSuppliersFromErp(payload) {
  const parsed = [];
  const seen = new Set();

  for (const item of extractArray(payload)) {
    const record = flattenItem(item);
    if (!record) continue;
    if (isErpDeletedRecord(record) || isErpBlockedRecord(record)) continue;

    const codigo = padCode(lookupLoose(record, [
      "a2_cod", "codigo", "code", "fornecedor", "codfor", "vendor", "supplier",
    ]), 6);
    if (!codigo) continue;
    const loja = padCode(lookupLoose(record, ["a2_loja", "loja", "store", "branch"]) || "01", 2) || "01";
    const nome = asTrimmedString(lookupLoose(record, [
      "a2_nreduz", "a2_nome", "nome", "nomereduz", "razao", "descricao", "name",
    ])) || codigo;
    const razao = asTrimmedString(lookupLoose(record, ["a2_nome", "razao", "nomerazao"])) || "";
    const cnpj = String(lookupLoose(record, ["a2_cgc", "cgc", "cnpj", "cpf"]) || "").replace(/\D/g, "");
    const key = `${codigo}::${loja}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ codigo, loja, nome, razao, cnpj });
  }
  return parsed;
}

async function tryFinRestLookup(resource, search, limit) {
  const linked = await integrationStore.findLinkedCadastro("titulos_pagar", "POST");
  if (!linked || linked.integration.status !== "ativo") return null;
  if (!isProtheusErp(linked.integration.erpNome)) return null;

  let credential;
  try {
    credential = await loadCredential(linked.integration);
  } catch {
    return null;
  }

  const nested = lookupPathFromTitulos(linked.endpoint.path, resource);
  const legacy = nested.replace(/\/pagar\/([^/?]+)/i, "/$1");
  const paths = [...new Set([nested, legacy])];

  for (const path of paths) {
    try {
      const fetched = await fetchErpJson(requestParams(linked.integration, credential, path, {
        method: "POST",
        body: { busca: search, search, limit },
      }));
      if (fetched.statusCode === 404 || fetched.statusCode === 405) continue;
      if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
        logger.warn({ path, statusCode: fetched.statusCode }, "FinRest lookup falhou neste caminho");
        continue;
      }
      const parsed = resource === "tipos"
        ? parseTitleTypesFromErp(fetched.data)
        : parseSuppliersFromErp(fetched.data);
      return {
        kind: resource === "tipos" ? "tipos" : "fornecedores",
        search,
        total: parsed.length,
        truncated: Boolean(fetched.data?.truncated) || parsed.length > limit,
        origem: fetched.data?.origem || "indice",
        connection: linked.integration.nome,
        endpoint: path,
        items: parsed.filter((item) => (
          resource === "tipos"
            ? matchesSearch([item.codigo, item.descricao], search)
            : matchesSearch([item.codigo, item.loja, item.nome, item.razao, item.cnpj], search)
        )).slice(0, limit),
      };
    } catch (error) {
      logger.warn({ err: error, path }, "FinRest lookup indisponível neste caminho");
    }
  }
  return null;
}

async function fetchTabledataPage(integration, credential, path) {
  const fetched = await fetchErpJson(requestParams(integration, credential, path, { method: "GET" }));
  if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
    throw httpError(fetched.statusCode >= 400 ? fetched.statusCode : 502, `HTTP ${fetched.statusCode} ao consultar o Protheus`);
  }
  return fetched;
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

async function loadAllSuppliersTabledata(linked, credential) {
  const cacheKey = linked.integration.id;
  const cached = supplierCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;

  const basePath = setQueryParams(linked.endpoint.path, {
    pageSize: String(TABLEDATA_PAGE_SIZE),
    page: "1",
    fields: SUPPLIER_FIELDS,
  });
  const first = await fetchTabledataPage(linked.integration, credential, basePath);
  const firstItems = extractArray(first.data);
  const total = Number(first.data?.total) || 0;
  const pageCount = Math.min(
    TABLEDATA_MAX_PAGES,
    Math.max(1, total ? Math.ceil(total / TABLEDATA_PAGE_SIZE) : (first.data?.hasNext ? TABLEDATA_MAX_PAGES : 1))
  );

  const pages = [];
  for (let page = 2; page <= pageCount; page += 1) pages.push(page);

  const rest = await mapPool(pages, TABLEDATA_CONCURRENCY, async (page) => {
    try {
      const path = setQueryParams(linked.endpoint.path, {
        pageSize: String(TABLEDATA_PAGE_SIZE),
        page: String(page),
        fields: SUPPLIER_FIELDS,
      });
      const fetched = await fetchTabledataPage(linked.integration, credential, path);
      return extractArray(fetched.data);
    } catch (error) {
      logger.warn({ err: error, page }, "falha ao ler página SA2");
      return [];
    }
  });

  const items = parseSuppliersFromErp([...firstItems, ...rest.flat()]);
  supplierCache.set(cacheKey, { at: Date.now(), items });
  logger.info({ total: items.length, pages: pageCount, connection: linked.integration.nome }, "SA2 carregado para lookup de fornecedores");
  return items;
}

async function lookupTitleTypesTabledata(linked, credential, search) {
  const path = setQueryParams(linked.endpoint.path, {
    pageSize: "80",
    page: "1",
    X5_TABELA: "05",
    fields: "X5_TABELA,X5_CHAVE,X5_DESCRI",
  });
  const fetched = await fetchTabledataPage(linked.integration, credential, path);
  return parseTitleTypesFromErp(fetched.data).filter((item) => matchesSearch([item.codigo, item.descricao], search));
}

export async function lookupPayableErp(payload = {}) {
  const kind = String(payload.kind || payload.cadastro || "").trim().toLowerCase();
  const search = String(payload.search || "").trim();
  const limit = Math.min(Math.max(Number(payload.limit) || RESULT_LIMIT, 1), 80);
  const isTipos = kind === "tipos" || kind === "tipos_titulo";

  if (kind !== "tipos" && kind !== "tipos_titulo" && kind !== "fornecedores") {
    throw httpError(400, "Informe kind=tipos ou kind=fornecedores");
  }
  if (!isTipos && search.length < 2) {
    return {
      kind: "fornecedores",
      search,
      total: 0,
      truncated: false,
      origem: "local",
      items: [],
    };
  }

  const resource = isTipos ? "tipos" : "fornecedores";
  const indexed = await tryFinRestLookup(resource, search, limit);
  if (indexed && (indexed.items.length || indexed.origem === "indice")) {
    if (indexed.items.length || resource === "tipos") return indexed;
  }

  const { linked, credential } = await loadLinkedGet(
    isTipos ? "tipos_titulo" : "fornecedores",
    isTipos ? "Tipos de título" : "Fornecedores"
  );

  if (isTipos) {
    const items = await lookupTitleTypesTabledata(linked, credential, search);
    return {
      kind: resource,
      search,
      total: items.length,
      truncated: items.length > limit,
      origem: "tabledata",
      connection: linked.integration.nome,
      endpoint: linked.endpoint.path,
      items: items.slice(0, limit),
    };
  }

  const all = await loadAllSuppliersTabledata(linked, credential);
  const items = all.filter((item) => (
    matchesSearch([item.codigo, item.loja, item.nome, item.razao, item.cnpj], search)
  ));

  return {
    kind: resource,
    search,
    total: items.length,
    truncated: items.length > limit,
    origem: "tabledata",
    connection: linked.integration.nome,
    endpoint: linked.endpoint.path,
    items: items.slice(0, limit),
  };
}
