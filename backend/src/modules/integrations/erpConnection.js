import { protheusContextHeaders } from "./protheus.js";

function assertSafeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("A URL deve usar http ou https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("A URL não pode conter credenciais");
  }
  return parsed;
}

export function joinBaseAndPath(baseUrl, path) {
  const rawBase = String(baseUrl || "").trim();
  const trimmed = (path ?? "").trim();

  if (!trimmed || trimmed === "/") {
    return assertSafeUrl(rawBase).toString();
  }

  const base = assertSafeUrl(rawBase.replace(/\/+$/, ""));

  if (/^https?:\/\//i.test(trimmed)) {
    const absolute = assertSafeUrl(trimmed);
    if (absolute.host !== base.host) {
      throw new Error("O endpoint não pode apontar para outro host");
    }
    return absolute.toString();
  }

  if (trimmed.startsWith("//")) {
    throw new Error("Informe um caminho relativo à URL base");
  }

  const relative = (trimmed.startsWith("/") ? trimmed : `/${trimmed}`).replace(/\{[^}]+\}/g, "1");
  const joined = `${base.toString().replace(/\/+$/, "")}${relative}`;
  const resolved = assertSafeUrl(joined);
  if (resolved.host !== base.host) {
    throw new Error("O endpoint não pode apontar para outro host");
  }
  return resolved.toString();
}

function buildAuthHeaders({ authType, authHeader, username, credential }) {
  const headers = { Accept: "application/json, */*" };
  const secret = credential ?? "";

  if (authType === "bearer" && secret) {
    headers.Authorization = `Bearer ${secret}`;
  } else if (authType === "api_key" && secret) {
    const headerName = (authHeader || "X-API-Key").trim() || "X-API-Key";
    headers[headerName] = secret;
  } else if (authType === "basic" && secret) {
    const token = Buffer.from(`${username ?? ""}:${secret}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  return headers;
}

function isBasePath(path) {
  if (!path) return true;
  const pathname = String(path).split("?")[0];
  return pathname === "" || pathname === "/";
}

function prepareProbePath(path) {
  if (!path) return path;
  let next = path.trim();
  if (/tabledata/i.test(next) && !/[?&]pageSize=/i.test(next)) {
    next += next.includes("?") ? "&pageSize=1" : "?pageSize=1";
  }
  return next;
}

function messageFromErpBody(data) {
  if (data == null) return null;
  if (typeof data === "string") {
    const text = data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 180) : null;
  }
  if (typeof data === "object") {
    for (const key of ["detailedMessage", "errorMessage", "message", "error", "detail", "msg"]) {
      const value = data[key];
      if (typeof value !== "string") continue;
      const text = value.trim();
      if (!text) continue;
      if (/^(internal server error|erro interno|error)$/i.test(text)) continue;
      return text.slice(0, 180);
    }
  }
  return null;
}

function messageForStatus(statusCode, data, method, { isBaseProbe } = {}) {
  if (statusCode >= 200 && statusCode < 300) {
    if (method === "GET") {
      return { ok: true, message: `Conexão estabelecida (HTTP ${statusCode})` };
    }
    return {
      ok: true,
      message: `Caminho alcançado (HTTP ${statusCode}). O teste usou ${method} com corpo vazio e não envia a ficha do contrato.`,
    };
  }
  if (statusCode === 401 || statusCode === 403) {
    return { ok: false, message: `Servidor alcançado, mas a autenticação falhou (HTTP ${statusCode})` };
  }
  if (statusCode === 404) {
    if (isBaseProbe) {
      return {
        ok: true,
        message: "Servidor REST alcançado. A URL base não lista serviços (HTTP 404). Adicione um endpoint para testar um cadastro.",
      };
    }
    return { ok: false, message: "Servidor alcançado, mas o caminho não foi encontrado (HTTP 404)" };
  }
  if (statusCode === 405) {
    return { ok: false, message: `Servidor alcançado (HTTP 405). O caminho não aceita ${method}.` };
  }
  if (method !== "GET" && [400, 409, 412, 422, 500].includes(statusCode)) {
    return {
      ok: true,
      message: statusCode === 500
        ? "Caminho alcançado (HTTP 500). O serviço de títulos existe, mas o POST de teste usa corpo vazio e o ERP recusa. Nenhum título foi gravado."
        : `Caminho alcançado (HTTP ${statusCode}). O ERP recusou o corpo de teste — o endpoint existe e nenhum título foi gravado.`,
    };
  }
  const erpMessage = messageFromErpBody(data);
  if (erpMessage) {
    return { ok: false, message: `Servidor alcançado (HTTP ${statusCode}): ${erpMessage}` };
  }
  return { ok: false, message: `Servidor alcançado (HTTP ${statusCode})` };
}

function messageForNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  if (code === "ABORT_ERR" || error?.name === "TimeoutError" || error?.name === "AbortError") {
    return "Tempo esgotado ao conectar no ERP";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Host do ERP não encontrado. Verifique a URL base";
  }
  if (code === "ECONNRESET") {
    return "O ERP fechou a conexão. Confira se o serviço está publicado e se o método do endpoint (GET/POST) está correto.";
  }
  if (code === "ECONNREFUSED") {
    return "Conexão recusada pelo ERP";
  }
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "Certificado TLS inválido no ERP";
  }
  if (error instanceof Error && error.message) {
    return `Não foi possível conectar: ${error.message}`;
  }
  return "Não foi possível conectar no ERP";
}

async function readLimitedBody(response, maxBytes = 512 * 1024) {
  const text = await response.text();
  return text.slice(0, maxBytes);
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function probeErpConnection(params) {
  const method = params.method ?? "GET";
  const path = method === "GET" ? prepareProbePath(params.path) : params.path;
  const isBaseProbe = isBasePath(path);
  const url = joinBaseAndPath(params.baseUrl, path);
  const headers = {
    ...buildAuthHeaders(params),
    ...protheusContextHeaders(params),
  };
  const isWrite = method === "POST" || method === "PUT" || method === "PATCH";
  if (isWrite) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(params.timeoutSeconds, 5) * 1000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: isWrite ? "{}" : undefined,
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await readLimitedBody(response);
    const status = messageForStatus(response.status, parseBody(text), method, { isBaseProbe });
    return {
      ok: status.ok,
      reached: true,
      statusCode: response.status,
      message: status.message,
    };
  } catch (error) {
    return {
      ok: false,
      reached: false,
      statusCode: null,
      message: messageForNetworkError(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchErpJson(params) {
  const url = joinBaseAndPath(params.baseUrl, params.path);
  const method = params.method ?? "GET";
  const headers = {
    ...buildAuthHeaders(params),
    ...protheusContextHeaders(params),
  };
  if (params.body != null) headers["Content-Type"] = "application/json; charset=utf-8";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(params.timeoutSeconds || 30, 5) * 1000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: params.body != null ? JSON.stringify(params.body) : undefined,
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      statusCode: response.status,
      data: parseBody(text.slice(0, 10 * 1024 * 1024)),
    };
  } catch (error) {
    throw new Error(messageForNetworkError(error));
  } finally {
    clearTimeout(timer);
  }
}
