import { fetchErpJson } from "../integrations/erpConnection.js";
import { applyProtheusContext, isProtheusErp } from "../integrations/protheus.js";
import {
  consultPathFromInclude,
  extornoPathFromInclude,
  loadLinkedPayableEndpoint,
  loadPayableActionEndpoint,
  restJobContext,
} from "../payables/erpIntegrate.js";

// Caminho rígido do título de tributo no FinRestTitulos (inclusão, consulta e estorno do SE2). Só conta como feito o
// que o Protheus confirmar no formato que o FinRestTitulos devolve em caso de sucesso — com a chave do título
// repetida na resposta. Resposta vazia, HTML, sem a chave ou com outra chave não confirma nada.
//
// Formatos (FinRestTitulos, RespOk/ConsultarPagar):
//   inclusão  → {"code":"201","message":"Titulo incluido com sucesso","tipoOperacao":"pagar","prefixo","numero",
//               "parcela","tipo","parceiro","loja","valor","empresa","filial"}
//   estorno   → {"code":"201","message":"Titulo estornado com sucesso","tipoOperacao":"extornar-pagar", ...mesma chave}
//   consulta  → {"code":"200","encontrado":1,"situacao":"aberto|parcial|baixado","prefixo","numero","parcela","tipo",
//               "fornecedor","loja","valor","saldo","baixa", ...}
//               {"code":"200","encontrado":0,"situacao":"nao_encontrado","prefixo","numero","parcela","tipo",
//               "fornecedor","loja"}
//   erro      → HTTP 400 {"code":"400","message":"..."}

function trimmed(value) {
  return String(value ?? "").trim();
}

function isObject(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data);
}

function sameKey(data, key, supplierField) {
  return trimmed(data.prefixo) === trimmed(key.prefixo)
    && trimmed(data.numero) === trimmed(key.numero)
    && trimmed(data.parcela) === trimmed(key.parcela)
    && trimmed(data.tipo) === trimmed(key.tipo)
    && trimmed(data[supplierField]) === trimmed(key.fornecedor)
    && trimmed(data.loja) === trimmed(key.loja);
}

function erpMessage(statusCode, data) {
  if (isObject(data)) {
    const text = trimmed(data.message || data.detailedMessage || data.errorMessage || data.erro);
    if (text) return text.slice(0, 300);
  }
  return `Resposta do Protheus sem confirmação (HTTP ${statusCode}).`;
}

// Recusa explícita do FinRestTitulos (RespErro + SetRestFault 400): HTTP 4xx com {"code":"400","message":"..."}.
// Diz que o Protheus respondeu e recusou — não que o título com certeza não entrou (há recusas depois do FINA050).
function explicitRejection(statusCode, data) {
  return statusCode >= 400 && statusCode < 500 && isObject(data) && trimmed(data.code) === "400" && Boolean(trimmed(data.message));
}

/** @returns {{ confirmed: boolean, rejected: boolean, message: string }} */
export function readIncludeResponse(statusCode, data, key) {
  const confirmed = statusCode >= 200 && statusCode < 300 && isObject(data)
    && trimmed(data.code) === "201"
    && trimmed(data.tipoOperacao).toLowerCase() === "pagar"
    && /incluido com sucesso/i.test(trimmed(data.message))
    && sameKey(data, key, "parceiro")
    && sameBranch(data, key);
  return {
    confirmed,
    rejected: !confirmed && explicitRejection(statusCode, data),
    message: confirmed ? "Título incluído no Protheus" : erpMessage(statusCode, data),
  };
}

// Filial da resposta, quando vier, igual à pedida: o FinRestTitulos procura o título em mais de uma filial.
function sameBranch(data, key) {
  return !trimmed(data.filial) || trimmed(data.filial) === trimmed(key.filial);
}

function sameCents(a, b) {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.round(x * 100) === Math.round(y * 100);
}

/** @returns {{ confirmed: boolean, message: string }} */
export function readReverseResponse(statusCode, data, key) {
  const confirmed = statusCode >= 200 && statusCode < 300 && isObject(data)
    && trimmed(data.code) === "201"
    && trimmed(data.tipoOperacao).toLowerCase() === "extornar-pagar"
    && /estornado com sucesso/i.test(trimmed(data.message))
    && sameKey(data, key, "parceiro")
    && sameBranch(data, key);
  return { confirmed, message: confirmed ? "Título estornado no Protheus" : erpMessage(statusCode, data) };
}

function flag(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

/**
 * "divergente": achou a chave, mas em outra filial ou com outro valor — não é o título que o AllDebt enviou.
 * @returns {{ result: "encontrado"|"nao_encontrado"|"inconclusivo"|"divergente", situacao?: string, valor?: number,
 *   saldo?: number, baixa?: string|null, message: string }}
 */
export function readConsultResponse(statusCode, data, key) {
  if (!(statusCode >= 200 && statusCode < 300) || !isObject(data) || trimmed(data.code) !== "200" || !sameKey(data, key, "fornecedor")) {
    return { result: "inconclusivo", message: erpMessage(statusCode, data) };
  }
  const found = flag(data.encontrado);
  const situacao = trimmed(data.situacao).toLowerCase();
  if (found === false && situacao === "nao_encontrado") {
    return { result: "nao_encontrado", message: "Título não encontrado no Protheus" };
  }
  const valor = Number(data.valor);
  const saldo = Number(data.saldo);
  if (found === true && ["aberto", "parcial", "baixado"].includes(situacao) && Number.isFinite(valor) && Number.isFinite(saldo)) {
    if (!sameBranch(data, key)) {
      return { result: "divergente", message: `O título no Protheus está em outra filial (${trimmed(data.filial)}), não na ${trimmed(key.filial)}.` };
    }
    if (key.valor !== undefined && key.valor !== null && !sameCents(valor, key.valor)) {
      return { result: "divergente", message: `O título no Protheus tem outro valor (${valor.toFixed(2).replace(".", ",")}) do que o enviado (${Number(key.valor).toFixed(2).replace(".", ",")}).` };
    }
    const baixa = /^\d{4}-\d{2}-\d{2}$/.test(trimmed(data.baixa)) ? trimmed(data.baixa) : null;
    return { result: "encontrado", situacao, valor, saldo, baixa, message: `Título ${situacao} no Protheus` };
  }
  return { result: "inconclusivo", message: erpMessage(statusCode, data) };
}

async function post(endpoint, body) {
  const { linked, credential } = endpoint;
  const ctx = restJobContext(linked);
  const path = isProtheusErp(ctx.erpNome) ? applyProtheusContext(linked.endpoint.path, ctx) : linked.endpoint.path;
  return fetchErpJson({
    baseUrl: linked.integration.baseUrl,
    path,
    method: "POST",
    authType: linked.integration.authType,
    authHeader: linked.integration.authHeader,
    username: linked.integration.username,
    credential,
    timeoutSeconds: Math.max(linked.integration.timeoutSeconds || 30, 30),
    body,
    ...ctx,
  });
}

/** Conexões do cliente para incluir, consultar e estornar (mesmos cadastros dos títulos a pagar). */
export async function loadTaxTitleEndpoints() {
  const include = await loadLinkedPayableEndpoint("titulos_pagar");
  const consult = await loadPayableActionEndpoint("titulos_pagar_consultar", consultPathFromInclude);
  const reverse = await loadPayableActionEndpoint("titulos_pagar_extornar", extornoPathFromInclude);
  return { include, consult, reverse };
}

// Erro de rede, tempo esgotado ou qualquer falha de transporte: o resultado é desconhecido.
async function call(endpoint, body, reader, key) {
  try {
    const response = await post(endpoint, body);
    return { ...reader(response.statusCode, response.data, key), transport: "ok" };
  } catch (error) {
    return { confirmed: false, result: "inconclusivo", message: `Sem resposta do Protheus: ${trimmed(error?.message) || "falha de rede"}`, transport: "falhou" };
  }
}

export function includeTitle(endpoints, payload) {
  return call(endpoints.include, payload, readIncludeResponse, payload);
}

export function consultTitle(endpoints, lookup) {
  return call(endpoints.consult, lookup, readConsultResponse, lookup);
}

export function reverseTitle(endpoints, lookup) {
  return call(endpoints.reverse, lookup, readReverseResponse, lookup);
}
