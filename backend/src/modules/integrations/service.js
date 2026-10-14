import { z } from "zod";
import * as store from "./store.js";
import { encryptSecret, decryptSecret, encryptWithPassphraseAsync, decryptWithPassphraseAsync, generateCode } from "./crypto.js";
import { probeErpConnection } from "./erpConnection.js";
import { applyProtheusContext, isProtheusErp } from "./protheus.js";
import { isValidHostEntry } from "./ssrfGuard.js";

export const CADASTRO_KEYS = [
  "naturezas",
  "empresas",
  "bancos",
  "contas",
  "plano_contas",
  "taxas",
  "contratos",
  "tipos_titulo",
  "fornecedores",
  "titulos_pagar",
  "titulos_pagar_extornar",
  "titulos_pagar_consultar",
  "titulos_receber",
  "titulos_receber_extornar",
  "titulos_receber_consultar",
  "clientes",
];

const AUTH_TYPES = ["none", "api_key", "bearer", "basic"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH"];

function optionalText(max) {
  return z.preprocess((val) => {
    if (typeof val !== "string") return val;
    const cleaned = val.trim();
    return cleaned === "" ? undefined : cleaned;
  }, z.string().max(max).optional());
}

function nullableText(max) {
  return z.preprocess((val) => {
    if (val === undefined) return undefined;
    if (typeof val !== "string") return val;
    const cleaned = val.trim();
    return cleaned === "" ? null : cleaned;
  }, z.string().max(max).nullable().optional());
}

const baseUrlField = z.preprocess(
  (val) => (typeof val === "string" ? val.trim() : val),
  z.string().url("Informe uma URL REST válida (http ou https)").max(2048)
    .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
      message: "A URL deve começar com http:// ou https://",
    })
);

const endpointPathField = z.preprocess(
  (val) => (typeof val === "string" ? val.trim() : val),
  z.string().min(1, "Informe o caminho do endpoint").max(1024)
    .refine((path) => path.startsWith("/"), { message: "O caminho deve começar com /" })
    .refine((path) => !path.startsWith("//"), { message: "Informe um caminho relativo à URL base" })
);

const cadastroKeyField = z.preprocess((val) => {
  if (val === undefined) return undefined;
  if (val === null || val === "") return null;
  if (typeof val === "string") return val.trim() === "" ? null : val.trim();
  return val;
}, z.enum(CADASTRO_KEYS).nullable().optional());

const endpointItemSchema = z.object({
  nome: z.string().trim().min(1).max(255),
  metodo: z.enum(HTTP_METHODS),
  path: endpointPathField,
  cadastroKey: cadastroKeyField,
});

export const createSchema = z.object({
  nome: z.string().trim().min(3).max(255),
  descricao: optionalText(2000),
  erpNome: optionalText(255),
  baseUrl: baseUrlField,
  authType: z.enum(AUTH_TYPES),
  authHeader: optionalText(255),
  username: optionalText(255),
  credential: optionalText(4096),
  timeoutSeconds: z.coerce.number().int().min(5).max(120).default(30),
  grupoEmpresas: optionalText(4),
  empresa: optionalText(10),
  filial: optionalText(10),
  endpoints: z.array(endpointItemSchema).default([]),
}).superRefine((data, ctx) => {
  if (data.authType === "basic" && !data.username) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["username"], message: "Usuário é obrigatório na autenticação Basic" });
  }
  if (data.authType !== "none" && !data.credential) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credential"], message: "Credencial é obrigatória para este tipo de autenticação" });
  }
});

export const updateSchema = z.object({
  nome: z.string().trim().min(3).max(255).optional(),
  descricao: nullableText(2000),
  erpNome: nullableText(255),
  baseUrl: baseUrlField.optional(),
  authType: z.enum(AUTH_TYPES).optional(),
  authHeader: nullableText(255),
  username: nullableText(255),
  credential: optionalText(4096),
  timeoutSeconds: z.coerce.number().int().min(5).max(120).optional(),
  grupoEmpresas: nullableText(4),
  empresa: nullableText(10),
  filial: nullableText(10),
  endpoints: z.array(endpointItemSchema).optional(),
}).superRefine((data, ctx) => {
  if (data.authType === "basic" && data.username === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["username"], message: "Usuário é obrigatório na autenticação Basic" });
  }
});

export const filtersSchema = z.object({
  search: optionalText(255),
  status: z.enum(["ativo", "inativo"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export const statusSchema = z.object({
  status: z.enum(["ativo", "inativo"]),
});

export const testConnectionSchema = z.object({
  code: optionalText(40),
  baseUrl: baseUrlField.optional(),
  authType: z.enum(AUTH_TYPES).optional(),
  authHeader: optionalText(255),
  username: optionalText(255),
  credential: optionalText(4096),
  timeoutSeconds: z.coerce.number().int().min(5).max(120).optional(),
  metodo: z.enum(HTTP_METHODS).optional(),
  path: z.preprocess((val) => {
    if (typeof val !== "string") return val;
    const cleaned = val.trim();
    return cleaned === "" ? undefined : cleaned;
  }, z.string().max(1024).optional()),
  erpNome: optionalText(255),
  grupoEmpresas: optionalText(4),
  empresa: optionalText(10),
  filial: optionalText(10),
}).superRefine((data, ctx) => {
  if (!data.code && !data.baseUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["baseUrl"], message: "Informe a URL base" });
  }
  if (data.path && !data.path.startsWith("/")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["path"], message: "O caminho deve começar com /" });
  }
});

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  err.details = details;
  return err;
}

function mapEndpoints(endpoints = []) {
  return endpoints.map((endpoint) => ({
    nome: endpoint.nome,
    metodo: endpoint.metodo,
    path: endpoint.path,
    cadastroKey: endpoint.cadastroKey ?? null,
  }));
}

async function assertUniqueCadastroKeys(endpoints = [], excludeIntegrationId) {
  const linked = endpoints.filter((endpoint) => Boolean(endpoint.cadastroKey));
  const seen = new Set();

  for (const endpoint of linked) {
    const key = `${endpoint.cadastroKey}::${endpoint.metodo}`;
    if (seen.has(key)) {
      throw httpError(400, `O cadastro já tem um endpoint ${endpoint.metodo}. Use outro método no segundo (GET para listar, POST para gravar).`, {
        endpoints: `O cadastro já tem um endpoint ${endpoint.metodo}.`,
      });
    }
    seen.add(key);
  }

  for (const endpoint of linked) {
    const existing = await store.findByCadastroKeyAndMetodo(
      endpoint.cadastroKey,
      endpoint.metodo,
      excludeIntegrationId
    );
    if (existing) {
      throw httpError(400, `O cadastro já está vinculado a outro endpoint ${endpoint.metodo} (${existing.nome})`, {
        endpoints: `O cadastro já está vinculado a outro endpoint ${endpoint.metodo} (${existing.nome})`,
      });
    }
  }
}

async function resolveByCode(code) {
  const row = await store.findByCode(code);
  if (!row) throw httpError(404, "Conexão não encontrada");
  return row;
}

export async function list(filters) {
  return store.list(filters);
}

export async function getByCode(code) {
  const row = await resolveByCode(code);
  const endpoints = await store.findEndpoints(row.id);
  return store.toPublic(row, endpoints);
}

const EXPORT_FORMAT = "alldebt.integrations";
const EXPORT_VERSION = 1;
// Marca que as credenciais do pacote estão cifradas com a passphrase do export.
const CREDENTIAL_ENCRYPTION = "passphrase-scrypt-aes-256-gcm";
// Teto de itens: cada credencial deriva uma chave scrypt (cara). Limita o custo
// de CPU por requisição e fecha o vetor de DoS no export/import.
const MAX_EXPORT_ITEMS = 200;
const MAX_IMPORT_ITEMS = 200;

export const exportSchema = z.object({
  passphrase: z.string().min(8, "A senha do arquivo deve ter ao menos 8 caracteres").max(256),
});

function normalizeImportBundle(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.connections)) return body.connections;
  if (Array.isArray(body?.data)) return body.data;
  return null;
}

function toExportItem(full, credential) {
  return {
    nome: full.nome,
    descricao: full.descricao || undefined,
    erpNome: full.erpNome || undefined,
    baseUrl: full.baseUrl,
    authType: full.authType || "none",
    authHeader: full.authHeader || undefined,
    username: full.username || undefined,
    credential: credential || undefined,
    timeoutSeconds: full.timeoutSeconds || 30,
    grupoEmpresas: full.grupoEmpresas || undefined,
    empresa: full.empresa || undefined,
    filial: full.filial || undefined,
    status: full.status === "inativo" ? "inativo" : "ativo",
    endpoints: (full.endpoints || []).map((endpoint) => ({
      nome: endpoint.nome,
      metodo: endpoint.metodo,
      path: endpoint.path,
      cadastroKey: endpoint.cadastroKey || null,
    })),
  };
}

export async function exportAll(passphrase) {
  if (!passphrase) {
    throw httpError(400, "Informe a senha do arquivo para exportar as credenciais", {
      passphrase: "Informe a senha do arquivo para exportar as credenciais",
    });
  }
  const listed = await store.list({ page: 1, limit: MAX_EXPORT_ITEMS + 1 });
  const items = listed.data || [];
  if (items.length > MAX_EXPORT_ITEMS) {
    throw httpError(400, `Muitas conexões para exportar de uma vez (limite de ${MAX_EXPORT_ITEMS}). Reduza antes de exportar.`);
  }
  const connections = [];
  for (const item of items) {
    const full = await getByCode(item.code);
    // A credencial é decifrada da chave-mestra e RE-CIFRADA com a passphrase —
    // nunca sai em texto puro no pacote de export. Falha de decifragem é erro
    // explícito: nunca exportamos uma conexão sem a credencial em silêncio.
    let credential;
    const credRow = await store.findCredential(full.id);
    if (credRow?.credential_encrypted) {
      try {
        credential = await encryptWithPassphraseAsync(decryptSecret(credRow.credential_encrypted), passphrase);
      } catch {
        throw httpError(500, `Não foi possível decifrar a credencial da conexão "${full.nome}". Verifique a chave de criptografia do servidor.`);
      }
    }
    connections.push(toExportItem(full, credential));
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    credentialEncryption: CREDENTIAL_ENCRYPTION,
    exportedAt: new Date().toISOString(),
    count: connections.length,
    connections,
  };
}

export async function importMany(body, createdBy, passphrase) {
  const rawItems = normalizeImportBundle(body);
  if (!rawItems?.length) {
    throw httpError(400, "Arquivo inválido: esperado { connections: [...] }");
  }
  if (rawItems.length > MAX_IMPORT_ITEMS) {
    throw httpError(400, `Arquivo com conexões demais (limite de ${MAX_IMPORT_ITEMS}). Divida em lotes menores.`);
  }

  // Pacotes novos trazem as credenciais cifradas com a passphrase do export.
  const encrypted = body?.credentialEncryption === CREDENTIAL_ENCRYPTION;
  if (encrypted && !passphrase) {
    throw httpError(400, "Informe a senha do arquivo para importar as credenciais", {
      passphrase: "Informe a senha do arquivo para importar as credenciais",
    });
  }

  const created = [];
  const errors = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const raw = rawItems[index] || {};
    const label = raw.nome || `item ${index + 1}`;
    try {
      let endpoints = Array.isArray(raw.endpoints) ? raw.endpoints : [];
      // Evita falhar o lote inteiro por cadastroKey já usado — remove vínculos conflitantes.
      const safeEndpoints = [];
      for (const endpoint of endpoints) {
        if (!endpoint?.cadastroKey) {
          safeEndpoints.push(endpoint);
          continue;
        }
        const clash = await store.findByCadastroKeyAndMetodo(endpoint.cadastroKey, endpoint.metodo);
        if (clash) {
          safeEndpoints.push({ ...endpoint, cadastroKey: null });
        } else {
          safeEndpoints.push(endpoint);
        }
      }

      let credentialPlain = raw.credential;
      if (encrypted && raw.credential) {
        try {
          credentialPlain = await decryptWithPassphraseAsync(raw.credential, passphrase);
        } catch {
          throw new Error("Senha do arquivo incorreta ou credencial corrompida");
        }
      }

      const parsed = createSchema.parse({
        nome: raw.nome,
        descricao: raw.descricao,
        erpNome: raw.erpNome,
        baseUrl: raw.baseUrl,
        authType: raw.authType || "none",
        authHeader: raw.authHeader,
        username: raw.username,
        credential: credentialPlain,
        timeoutSeconds: raw.timeoutSeconds ?? 30,
        grupoEmpresas: raw.grupoEmpresas,
        empresa: raw.empresa,
        filial: raw.filial,
        endpoints: safeEndpoints,
      });

      const row = await create(parsed, createdBy);
      if (raw.status === "inativo") {
        await updateStatusByCode(row.code, "inativo");
      }
      created.push({ code: row.code, nome: row.nome });
    } catch (error) {
      let message = error?.message || "Falha ao importar";
      if (error?.details && typeof error.details === "object") {
        message = Object.values(error.details)[0] || message;
      } else if (error?.name === "ZodError" && Array.isArray(error.issues)) {
        message = error.issues[0]?.message || message;
      }
      errors.push({ index, nome: label, message });
    }
  }

  if (!created.length) {
    throw httpError(400, errors[0]?.message || "Nenhuma conexão foi importada", { errors });
  }

  return {
    imported: created.length,
    failed: errors.length,
    created,
    errors,
  };
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function originChanged(oldUrl, newUrl) {
  const a = safeOrigin(oldUrl);
  const b = safeOrigin(newUrl);
  // Se não der para comparar as duas origens, trata como mudança (conservador).
  return a === null || b === null || a !== b;
}

export async function create(data, createdBy) {
  await assertUniqueCadastroKeys(data.endpoints);
  return store.create({
    code: generateCode("INT"),
    nome: data.nome,
    descricao: data.descricao ?? null,
    erpNome: data.erpNome ?? null,
    baseUrl: data.baseUrl.replace(/\/+$/, ""),
    authType: data.authType,
    authHeader: data.authHeader ?? (data.authType === "api_key" ? "X-API-Key" : null),
    username: data.username ?? null,
    credentialEncrypted: data.credential ? encryptSecret(data.credential) : null,
    timeoutSeconds: data.timeoutSeconds,
    grupoEmpresas: data.grupoEmpresas ?? "",
    empresa: data.empresa ?? "",
    filial: data.filial ?? "",
  }, mapEndpoints(data.endpoints), createdBy);
}

export async function updateByCode(code, data) {
  const existing = await resolveByCode(code);
  const patch = {};
  if (data.nome !== undefined) patch.nome = data.nome;
  if (data.descricao !== undefined) patch.descricao = data.descricao;
  if (data.erpNome !== undefined) patch.erpNome = data.erpNome;
  if (data.baseUrl !== undefined) patch.baseUrl = data.baseUrl.replace(/\/+$/, "");
  if (data.authType !== undefined) patch.authType = data.authType;
  if (data.authHeader !== undefined) patch.authHeader = data.authHeader;
  if (data.username !== undefined) patch.username = data.username;
  if (data.timeoutSeconds !== undefined) patch.timeoutSeconds = data.timeoutSeconds;
  if (data.grupoEmpresas !== undefined) patch.grupoEmpresas = data.grupoEmpresas ?? "";
  if (data.empresa !== undefined) patch.empresa = data.empresa ?? "";
  if (data.filial !== undefined) patch.filial = data.filial ?? "";
  if (data.credential) {
    patch.credentialEncrypted = encryptSecret(data.credential);
  } else if (data.baseUrl !== undefined && originChanged(existing.base_url, data.baseUrl)) {
    // Mudou o destino (esquema/host/porta) sem recredenciar: a credencial salva
    // foi confiada ao host antigo e NÃO pode seguir para o novo. Limpa — o OWNER
    // informa a credencial do novo host na próxima edição/teste.
    patch.credentialEncrypted = null;
  }
  if (data.endpoints) await assertUniqueCadastroKeys(data.endpoints, existing.id);
  return store.update(existing.id, patch, data.endpoints ? mapEndpoints(data.endpoints) : undefined);
}

export async function removeByCode(code) {
  const existing = await resolveByCode(code);
  return store.remove(existing.id);
}

export async function updateStatusByCode(code, status) {
  const existing = await resolveByCode(code);
  return store.update(existing.id, { status });
}

export const allowedHostSchema = z.object({
  host: z.preprocess(
    (val) => (typeof val === "string" ? val.trim() : val),
    z.string().min(1, "Informe o endereço").max(253)
  ).refine(isValidHostEntry, {
    message: "Informe um hostname válido (ex.: erp.cliente.com.br) ou uma faixa CIDR (ex.: 10.0.0.0/24)",
  }),
  descricao: optionalText(255),
});

export async function listAllowedHosts() {
  return store.listAllowedHosts();
}

export async function addAllowedHost(data, createdBy) {
  return store.createAllowedHost({
    host: data.host.toLowerCase(),
    descricao: data.descricao ?? null,
    createdBy,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function removeAllowedHost(id) {
  if (!UUID_RE.test(String(id || ""))) {
    throw httpError(404, "Endereço permitido não encontrado");
  }
  return store.removeAllowedHost(id);
}

export async function testConnection(data, { probe = probeErpConnection } = {}) {
  let baseUrl = data.baseUrl;
  let authType = data.authType ?? "none";
  let authHeader = data.authHeader ?? null;
  let username = data.username ?? null;
  let credential = data.credential ?? null;
  let timeoutSeconds = data.timeoutSeconds ?? 30;
  let erpNome = data.erpNome ?? null;
  let grupoEmpresas = data.grupoEmpresas ?? "";
  let empresa = data.empresa ?? "";
  let filial = data.filial ?? "";

  if (data.code) {
    const saved = await resolveByCode(data.code);
    const credRow = await store.findCredential(saved.id);
    // Segurança: numa conexão salva, o host é SEMPRE o salvo — qualquer baseUrl
    // vindo do corpo é ignorado. Senão, enviar `code` + um baseUrl próprio faria
    // a credencial salva ser decifrada e mandada ao host do atacante. Só o
    // `path` do corpo é aproveitado (mais abaixo).
    baseUrl = saved.base_url;
    authType = data.authType ?? saved.auth_type;
    authHeader = data.authHeader ?? saved.auth_header;
    username = data.username ?? saved.username;
    timeoutSeconds = data.timeoutSeconds ?? saved.timeout_seconds;
    erpNome = data.erpNome ?? saved.erp_nome;
    grupoEmpresas = data.grupoEmpresas ?? saved.grupo_empresas;
    empresa = data.empresa ?? saved.empresa;
    filial = data.filial ?? saved.filial;
    if (!credential && credRow?.credential_encrypted) {
      credential = decryptSecret(credRow.credential_encrypted);
    }
  }

  if (!baseUrl) throw httpError(400, "Informe a URL base", { baseUrl: "Informe a URL base" });
  if (authType !== "none" && !credential) {
    throw httpError(400, "Informe a credencial para testar a conexão", { credential: "Informe a credencial para testar a conexão" });
  }
  if (authType === "basic" && !username) {
    throw httpError(400, "Usuário é obrigatório na autenticação Basic", { username: "Usuário é obrigatório na autenticação Basic" });
  }

  const ctx = { erpNome, grupoEmpresas, empresa, filial };
  return probe({
    baseUrl,
    path: data.path
      ? applyProtheusContext(data.path, ctx)
      : isProtheusErp(erpNome)
        ? applyProtheusContext("/", ctx)
        : data.path,
    method: data.metodo ?? "GET",
    authType,
    authHeader,
    username,
    credential,
    timeoutSeconds,
    ...ctx,
  });
}
