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
const CLIENT_FIELDS = "A1_COD,A1_LOJA,A1_NREDUZ,A1_NOME,A1_CGC,A1_MSBLQL";
const CACHE_MS = 10 * 60 * 1000;

const supplierCache = new Map();
const clientCache = new Map();

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function lookupPathFromTitulos(path, resource, family = "pagar") {
  const raw = String(path || "").trim();
  const [pathname, query] = raw.split("?");
  const clean = String(pathname || "").replace(/\/+$/, "");
  const root = clean.replace(/\/(pagar|receber)(\/.*)?$/i, "") || "/FinRestTitulos";
  let next;
  if (family === "receber" && resource === "clientes") {
    next = `${root}/receber`;
  } else if (family === "receber") {
    next = `${root}/${resource === "tipos" ? "pagar/tipos" : resource}`;
  } else {
    const familyBase = /\/(pagar|receber)$/i.test(clean)
      ? clean.replace(/\/(pagar|receber)$/i, "/pagar")
      : `${root}/pagar`;
    next = `${familyBase}/${resource}`;
  }
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
      "a2_cod", "a1_cod", "codigo", "code", "fornecedor", "cliente", "codfor", "vendor", "supplier",
    ]), 6);
    if (!codigo) continue;
    const loja = padCode(lookupLoose(record, ["a2_loja", "a1_loja", "loja", "store", "branch"]) || "01", 2) || "01";
    const nome = asTrimmedString(lookupLoose(record, [
      "a2_nreduz", "a1_nreduz", "a2_nome", "a1_nome", "nome", "nomereduz", "razao", "descricao", "name",
    ])) || codigo;
    const razao = asTrimmedString(lookupLoose(record, ["a2_nome", "a1_nome", "razao", "nomerazao"])) || "";
    const cnpj = String(lookupLoose(record, ["a2_cgc", "a1_cgc", "cgc", "cnpj", "cpf"]) || "").replace(/\D/g, "");
    const key = `${codigo}::${loja}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ codigo, loja, nome, razao, cnpj });
  }
  return parsed;
}

// `raw`: devolve os registros como vieram do Protheus (para conferência de presença), sem o tratamento da busca
// das telas.
async function tryFinRestLookup(resource, search, limit, { raw = false } = {}) {
  const family = resource === "clientes" ? "receber" : "pagar";
  const cadastroKeys = resource === "clientes"
    ? ["titulos_receber", "titulos_pagar"]
    : ["titulos_pagar", "titulos_receber"];

  for (const cadastroKey of cadastroKeys) {
    const linked = await integrationStore.findLinkedCadastro(cadastroKey, "POST");
    if (!linked || linked.integration.status !== "ativo") continue;
    if (!isProtheusErp(linked.integration.erpNome)) continue;

    let credential;
    try {
      credential = await loadCredential(linked.integration);
    } catch {
      continue;
    }

    const nested = lookupPathFromTitulos(linked.endpoint.path, resource, family);
    const legacy = nested.replace(/\/(pagar|receber)\/([^/?]+)/i, "/$2");
    const paths = [...new Set([nested, legacy])];

    for (const path of paths) {
      try {
        const fetched = await fetchErpJson(requestParams(linked.integration, credential, path, {
          method: "POST",
          body: resource === "clientes"
            ? { busca: search, search, limit, acao: "clientes" }
            : { busca: search, search, limit },
        }));
        if (fetched.statusCode === 404 || fetched.statusCode === 405) continue;
        if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
          logger.warn({ path, statusCode: fetched.statusCode }, "FinRest lookup falhou neste caminho");
          continue;
        }
        if (raw) return { rows: supplierRowsOf(fetched.data), truncated: Boolean(fetched.data?.truncated) };
        const parsed = resource === "tipos"
          ? parseTitleTypesFromErp(fetched.data)
          : parseSuppliersFromErp(fetched.data);
        const kind = resource === "tipos" ? "tipos" : resource;
        return {
          kind,
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

/**
 * Lê o SA2 página a página e diz se a leitura foi completa.
 * Completa = chegou ao fim dos dados sem página com falha e sem parar no teto de páginas:
 * - com `total` informado: todas as páginas necessárias cabem no teto E vieram pelo menos `total` registros (se o
 *   servidor limitar a página abaixo do tamanho pedido, faltam registros e a leitura não é completa);
 * - sem `total`: a primeira página lida com `hasNext: false` (ou sem registros) marca o fim. Sem `hasNext` nenhum,
 *   não há como saber se acabou — só uma primeira página vazia é conclusiva.
 * Página que falha não derruba a leitura (as demais seguem), mas a marca como incompleta.
 * @param {(page: number) => Promise<object>} fetchPage devolve o corpo da página (lança se falhar)
 * @param {object} [options] `extract` tira a lista de registros do corpo (padrão: extractArray, o das telas); se
 *   lançar, a página conta como falha
 * @returns {Promise<{ items: object[], rows: object[], complete: boolean, failedPages: number[], limitReached: boolean, pages: number }>}
 *   `items` no formato da busca das telas; `rows` os registros como vieram do Protheus
 */
export async function readSupplierPages(fetchPage, { maxPages = TABLEDATA_MAX_PAGES, pageSize = TABLEDATA_PAGE_SIZE, extract = extractArray } = {}) {
  const first = await fetchPage(1);
  const firstItems = extract(first);
  const total = Number(first?.total) || 0;
  const neededPages = total ? Math.ceil(total / pageSize) : (first?.hasNext ? Infinity : 1);
  const pageCount = Math.min(maxPages, Math.max(1, neededPages));

  const pages = [];
  for (let page = 2; page <= pageCount; page += 1) pages.push(page);

  const failedPages = [];
  const rest = await mapPool(pages, TABLEDATA_CONCURRENCY, async (page) => {
    try {
      const body = await fetchPage(page);
      return { page, items: extract(body), hasNext: body?.hasNext };
    } catch (error) {
      logger.warn({ err: error, page }, "falha ao ler página SA2");
      failedPages.push(page);
      return { page, items: [], failed: true };
    }
  });

  const read = [{ page: 1, items: firstItems, hasNext: first?.hasNext }, ...rest];
  let reachedEnd;
  if (total) {
    const rowCount = read.reduce((sum, item) => sum + item.items.length, 0);
    reachedEnd = neededPages <= maxPages && rowCount >= total;
  } else {
    const endPage = read.find((item) => !item.failed && (item.hasNext === false || item.items.length === 0));
    // Sem página de fim entre as lidas, a leitura parou no teto (ou o servidor não diz se acabou).
    reachedEnd = Boolean(endPage);
  }
  const rows = read.flatMap((item) => item.items);
  return {
    items: parseSuppliersFromErp(rows),
    rows,
    complete: reachedEnd && failedPages.length === 0,
    failedPages: failedPages.sort((x, y) => x - y),
    limitReached: !reachedEnd,
    pages: pageCount,
  };
}

// Envelopes de lista que extractArray reconhece (integrations/erpJson.js), na mesma ordem.
const ROW_ENVELOPE_KEYS = [
  "items", "data", "value", "results", "content", "tables", "companies", "branches", "naturezas", "contas", "bancos",
  "sa6", "sa2", "sx5", "ct1", "plano", "planoContas", "fornecedores", "tipos",
];

function findRows(payload, depth) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object" || depth > 4) return null;
  for (const key of ROW_ENVELOPE_KEYS) {
    const entry = Object.entries(payload).find(([name]) => name.toLowerCase() === key.toLowerCase());
    if (!entry || entry[1] == null || entry[1] === "") continue;
    const found = findRows(entry[1], depth + 1);
    if (found) return found;
  }
  return null;
}

// Lista de registros da página para a conferência, sem desembrulhar lista de um item só (extractArray devolve []
// nesse caso) e aceitando envelope aninhado. Formato não reconhecido lança: a página conta como falha, nunca
// como vazia — vazia faria a conferência afirmar "não encontrado".
export function supplierRowsOf(payload) {
  const rows = findRows(payload, 0);
  if (!rows) throw new Error("formato de página SA2 não reconhecido");
  return rows;
}

function readSuppliersFromIntegration(linked, credential, { extract } = {}) {
  return readSupplierPages(async (page) => {
    const path = setQueryParams(linked.endpoint.path, {
      pageSize: String(TABLEDATA_PAGE_SIZE),
      page: String(page),
      fields: SUPPLIER_FIELDS,
    });
    const fetched = await fetchTabledataPage(linked.integration, credential, path);
    return fetched.data;
  }, { extract });
}

// Leitura do SA2 em andamento, por integração: quem pedir enquanto ela corre recebe a mesma promessa, em vez de
// disparar outra leitura completa no Protheus.
const inflightSupplierReads = new Map();

export function shareInflight(map, key, start) {
  const running = map.get(key);
  if (running) return running;
  const promise = Promise.resolve().then(start).finally(() => map.delete(key));
  map.set(key, promise);
  return promise;
}

async function readSuppliersFresh(linked, credential) {
  const read = await shareInflight(
    inflightSupplierReads,
    linked.integration.id,
    () => readSuppliersFromIntegration(linked, credential, { extract: supplierRowsOf })
  );
  // Leitura completa e recente também serve às telas de busca.
  if (read.complete) supplierCache.set(linked.integration.id, { at: Date.now(), items: read.items });
  return read;
}

// Busca das telas: usa o cache de até 10 min e aceita leitura parcial (lista de sugestões, não conferência).
async function loadAllSuppliersTabledata(linked, credential) {
  const cacheKey = linked.integration.id;
  const cached = supplierCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;

  const read = await readSuppliersFromIntegration(linked, credential);
  supplierCache.set(cacheKey, { at: Date.now(), items: read.items });
  logger.info({ total: read.items.length, pages: read.pages, connection: linked.integration.nome }, "SA2 carregado para lookup de fornecedores");
  return read.items;
}

function sa1PathFromSa2(path) {
  return String(path || "")
    .replace(/SA2(\d{3}0)?/gi, (_, group) => `SA1${group || ""}`)
    .replace(/A2_/g, "A1_");
}

async function loadLinkedClientsGet() {
  try {
    return await loadLinkedGet("clientes", "Clientes");
  } catch (error) {
    if (error.status !== 400) throw error;
  }
  const { linked, credential } = await loadLinkedGet("fornecedores", "Fornecedores");
  return {
    linked: {
      ...linked,
      endpoint: {
        ...linked.endpoint,
        path: sa1PathFromSa2(linked.endpoint.path),
      },
    },
    credential,
  };
}

async function loadAllClientsTabledata(linked, credential) {
  const cacheKey = `${linked.integration.id}:${linked.endpoint.path}`;
  const cached = clientCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;

  const basePath = setQueryParams(linked.endpoint.path, {
    pageSize: String(TABLEDATA_PAGE_SIZE),
    page: "1",
    fields: CLIENT_FIELDS,
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
        fields: CLIENT_FIELDS,
      });
      const fetched = await fetchTabledataPage(linked.integration, credential, path);
      return extractArray(fetched.data);
    } catch (error) {
      logger.warn({ err: error, page }, "falha ao ler página SA1");
      return [];
    }
  });

  const items = parseSuppliersFromErp([...firstItems, ...rest.flat()]);
  clientCache.set(cacheKey, { at: Date.now(), items });
  logger.info({ total: items.length, pages: pageCount, connection: linked.integration.nome }, "SA1 carregado para lookup de clientes");
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
  const isClientes = kind === "clientes" || kind === "cliente";

  if (kind !== "tipos" && kind !== "tipos_titulo" && kind !== "fornecedores" && !isClientes) {
    throw httpError(400, "Informe kind=tipos, kind=fornecedores ou kind=clientes");
  }
  if (!isTipos && search.length < 2) {
    return {
      kind: isClientes ? "clientes" : "fornecedores",
      search,
      total: 0,
      truncated: false,
      origem: "local",
      items: [],
    };
  }

  const resource = isTipos ? "tipos" : (isClientes ? "clientes" : "fornecedores");
  const indexed = await tryFinRestLookup(resource, search, limit);
  if (indexed && (indexed.items.length || indexed.origem === "indice")) {
    if (indexed.items.length || resource === "tipos") return indexed;
  }

  if (isTipos) {
    const { linked, credential } = await loadLinkedGet("tipos_titulo", "Tipos de título");
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

  const { linked, credential } = isClientes
    ? await loadLinkedClientsGet()
    : await loadLinkedGet("fornecedores", "Fornecedores");

  const all = isClientes
    ? await loadAllClientsTabledata(linked, credential)
    : await loadAllSuppliersTabledata(linked, credential);
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

/**
 * Localiza fornecedor SA2 pelo CNPJ (A2_CGC).
 * status: "encontrado" (supplier preenchido no formato de payable_titles),
 * "nao_cadastrado", "erro" (consulta ao ERP falhou) ou "invalido".
 */
export async function resolveSupplierByCnpj(cnpj) {
  const digits = String(cnpj || "").replace(/\D/g, "");
  if (digits.length !== 14) return { status: "invalido", supplier: null, cnpj: digits };

  let result;
  try {
    result = await lookupPayableErp({ kind: "fornecedores", search: digits, limit: 20 });
  } catch (error) {
    logger.warn({ err: error, cnpj: digits }, "lookup SA2 por CNPJ falhou");
    return { status: "erro", supplier: null, cnpj: digits, message: error.message || "Falha ao consultar o Protheus" };
  }

  const items = Array.isArray(result?.items) ? result.items : [];
  const exact = items.find((item) => String(item.cnpj || "").replace(/\D/g, "") === digits) || null;
  if (!exact?.codigo) return { status: "nao_cadastrado", supplier: null, cnpj: digits };

  return {
    status: "encontrado",
    cnpj: digits,
    supplier: {
      fornecedor: padCode(exact.codigo, 6),
      fornecedor_loja: padCode(exact.loja || "01", 2) || "01",
      fornecedor_nome: String(exact.nome || exact.razao || "").trim(),
      cnpj: digits,
      origem: result?.origem || "erp",
    },
  };
}

const RAW_CODE_KEYS = ["a2_cod", "codigo", "code", "fornecedor", "codfor", "vendor", "supplier"];
const RAW_STORE_KEYS = ["a2_loja", "loja", "store", "branch"];

/**
 * Código e loja do registro do SA2 exatamente como vieram do Protheus, só sem espaços nas pontas. A busca das telas
 * (parseSuppliersFromErp) completa com zeros o que tiver dígito — "F00010" vira "000010" —, então a conferência
 * não pode comparar com ela. Registro excluído ou bloqueado não conta.
 */
export function rawSupplierKey(row) {
  const values = rawSupplierValues(row);
  if (!values) return null;
  return { codigo: String(values.codigo).trim(), loja: String(values.loja ?? "").trim() };
}

// Código e loja com o tipo original (texto ou número JSON): o tipo decide se zeros à esquerda podem ter sumido.
function rawSupplierValues(row) {
  const record = flattenItem(row);
  if (!record || isErpDeletedRecord(record) || isErpBlockedRecord(record)) return null;
  const codigo = lookupLoose(record, RAW_CODE_KEYS);
  if (codigo == null || String(codigo).trim() === "") return null;
  const loja = lookupLoose(record, RAW_STORE_KEYS);
  return { codigo, loja: loja == null || String(loja).trim() === "" ? null : loja };
}

/**
 * Valor do Protheus contra o configurado:
 * - "igual": o mesmo texto (aparado) ou um NÚMERO JSON que, completado com zeros, dá o configurado numérico — o
 *   tipo número prova que os zeros se perderam na serialização;
 * - "incerto": TEXTO só com dígitos que só bate completando com zeros ("10" para 000010): pode ser outro registro;
 * - "diferente": o resto. Código com letras nunca é completado.
 */
function compareCodeValue(fromErp, configured, size) {
  if (typeof fromErp === "number") {
    const text = Number.isInteger(fromErp) && fromErp >= 0 ? String(fromErp) : "";
    return text && /^\d+$/.test(configured) && text.padStart(size, "0") === configured.padStart(size, "0") ? "igual" : "diferente";
  }
  const text = String(fromErp).trim();
  if (text === configured) return "igual";
  if (/^\d+$/.test(text) && /^\d+$/.test(configured) && text.padStart(size, "0") === configured.padStart(size, "0")) return "incerto";
  return "diferente";
}

/**
 * Presença do fornecedor+loja nos registros:
 * - "presente": algum registro com código e loja iguais (ver compareCodeValue);
 * - "sem_loja" / "sem_zeros": nenhum presente, mas há registro que pode ser ele — mesmo código sem loja, ou código
 *   ou loja em texto que só bate completando com zeros. Não prova presença nem ausência;
 * - "ausente": nenhum registro que possa ser ele.
 */
function supplierPresence(rows, codigo, loja) {
  let doubt = null;
  for (const row of rows || []) {
    const values = rawSupplierValues(row);
    if (!values) continue;
    const code = compareCodeValue(values.codigo, codigo, 6);
    if (code === "diferente") continue;
    if (values.loja === null) {
      doubt ??= "sem_loja";
      continue;
    }
    const store = compareCodeValue(values.loja, loja, 2);
    if (store === "diferente") continue;
    if (code === "igual" && store === "igual") return "presente";
    doubt ??= "sem_zeros";
  }
  return doubt || "ausente";
}

const DOUBT_REASONS = { sem_loja: "registro_sem_loja", sem_zeros: "codigo_sem_zeros" };

async function indexedSupplierSearch(codigo) {
  return tryFinRestLookup("fornecedores", codigo, RESULT_LIMIT * 2, { raw: true });
}

async function freshSupplierRead() {
  const { linked, credential } = await loadLinkedGet("fornecedores", "Fornecedores");
  return readSuppliersFresh(linked, credential);
}

/**
 * Confere se o fornecedor (código + loja) existe no SA2 do Protheus do cliente, com dado fresco.
 * - "encontrado": apareceu na busca indexada ou na leitura do SA2.
 * - "nao_encontrado": só pela leitura COMPLETA do SA2 (todas as páginas, sem falha, sem bater no teto) sem ele.
 * - "nao_conferido": qualquer outra coisa (sem conexão, falha, leitura parcial).
 * Fornecedor bloqueado ou excluído conta como não encontrado (as duas leituras os descartam).
 * @returns {Promise<{ situacao: "encontrado"|"nao_encontrado"|"nao_conferido", motivo: string }>}
 */
export async function checkSupplierInErp(codigo, loja, { indexLookup = indexedSupplierSearch, fullRead = freshSupplierRead } = {}) {
  const code = String(codigo || "").trim();
  const store = String(loja || "").trim();
  let indexed = null;
  try {
    indexed = await indexLookup(code);
  } catch (error) {
    logger.warn({ err: error, codigo: code }, "busca indexada de fornecedor falhou");
  }
  const viaIndex = supplierPresence(indexed?.rows, code, store);
  if (viaIndex === "presente") return { situacao: "encontrado", motivo: "indice" };
  // A busca indexada só prova presença: no FinRestTitulos ela procura por código apenas quando o termo é numérico
  // e, fora isso, pelo nome — um código como "UNIAO" pode não aparecer nela mesmo existindo. Ausência só se
  // afirma pela leitura completa do SA2.

  let read;
  try {
    read = await fullRead();
  } catch (error) {
    logger.warn({ err: error, codigo: code }, "leitura do SA2 para conferência falhou");
    return { situacao: "nao_conferido", motivo: "leitura_falhou" };
  }
  const viaRead = supplierPresence(read.rows, code, store);
  if (viaRead === "presente") return { situacao: "encontrado", motivo: "sa2" };
  // Registro que pode ser ele (sem loja, ou sem os zeros em texto): não dá para afirmar que aquela chave não existe.
  const doubt = DOUBT_REASONS[viaRead] || DOUBT_REASONS[viaIndex];
  if (doubt) return { situacao: "nao_conferido", motivo: doubt };
  if (!read.complete) {
    return { situacao: "nao_conferido", motivo: read.limitReached ? "limite_de_paginas" : "pagina_falhou" };
  }
  return { situacao: "nao_encontrado", motivo: "sa2" };
}

/**
 * Conferências de um mesmo salvamento: todas usam UMA leitura completa do SA2 (feita na primeira que precisar),
 * além de dividirem a leitura em andamento com outros salvamentos simultâneos da mesma integração.
 */
export function createSupplierCheckSession() {
  let read = null;
  const fullRead = () => {
    read ??= freshSupplierRead();
    return read;
  };
  return { check: (codigo, loja) => checkSupplierInErp(codigo, loja, { fullRead }) };
}
