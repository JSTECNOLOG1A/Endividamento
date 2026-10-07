import { logger } from "../../logger.js";
import { createSupplierCheckSession } from "../payables/erpLookup.js";
import { resolveParameter } from "../parameters/service.js";
import { TAX_SUPPLIERS_PARAMETER, pickTaxSupplier } from "./taxSupplierConfig.js";

// Fornecedor dos títulos de tributo: resolução para um parcelamento e conferência no cadastro de fornecedores do
// Protheus (SA2) ao salvar a configuração.

// Prazo da conferência inteira (todos os fornecedores do salvamento), que acontece depois da gravação: no pior caso
// é uma leitura completa do SA2, compartilhada entre os fornecedores. Passou do prazo, a resposta volta com
// "não conferido" e a leitura em andamento termina sozinha (e alimenta o cache das telas de busca).
export const ERP_CHECK_BUDGET_MS = 30 * 1000;

/**
 * Fornecedor e loja do título de tributo de um parcelamento, pela configuração do cliente autenticado.
 * Sem configuração para a esfera/UF, lança erro 422 dizendo o que configurar e onde.
 * @param {{ esfera: string, uf?: string|null }} agreement
 */
export async function resolveTaxSupplier(agreement) {
  const config = await resolveParameter(TAX_SUPPLIERS_PARAMETER);
  return pickTaxSupplier(config, agreement);
}

function entriesOf(config) {
  const entries = [];
  if (config.federal) entries.push({ campo: "federal", rotulo: "tributos federais", ...config.federal });
  if (config.estadual) entries.push({ campo: "estadual", rotulo: "tributos estaduais", ...config.estadual });
  for (const [uf, entry] of Object.entries(config.por_uf || {})) {
    entries.push({ campo: `por_uf.${uf}`, rotulo: `tributos estaduais de ${uf}`, ...entry });
  }
  return entries;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`consulta ao Protheus passou de ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// "nao_conferido" quando a consulta falha, passa do prazo ou não é conclusiva — nunca afirma que existe nem que não
// existe sem a resposta do Protheus.
async function checkSupplier(fornecedor, loja, check, remainingMs) {
  if (fornecedor.length < 2) return "nao_conferido";
  try {
    const result = await withTimeout(Promise.resolve().then(() => check(fornecedor, loja)), remainingMs);
    return result?.situacao || "nao_conferido";
  } catch (error) {
    logger.warn({ err: error, fornecedor, loja }, "não foi possível conferir o fornecedor de tributos no Protheus");
    return "nao_conferido";
  }
}

function checkMessage(entry, situacao) {
  const who = `O fornecedor ${entry.fornecedor} loja ${entry.loja} (${entry.rotulo})`;
  if (situacao === "nao_encontrado") {
    return `${who} não apareceu no cadastro de fornecedores do Protheus (ou está bloqueado). A configuração foi salva. Confira o código e a loja no Protheus ou cadastre o fornecedor: sem ele, o Protheus não aceita o título de tributo.`;
  }
  return `Não foi possível conferir no Protheus se ${who.charAt(0).toLowerCase()}${who.slice(1)} existe. A configuração foi salva; confira o cadastro de fornecedores no Protheus.`;
}

/**
 * Confere no Protheus os fornecedores configurados. Só quando o cliente integra com ERP externo. Nunca bloqueia:
 * devolve a situação de cada fornecedor e os avisos para a tela.
 * @param {object} config configuração já normalizada
 * @param {{ erpEnabled: boolean, check?: Function, budgetMs?: number }} options `check` substitui a conferência
 *   no Protheus (padrão: uma sessão de conferência com leitura única do SA2)
 * @returns {Promise<{ conferido: boolean, fornecedores: object[], avisos: string[] }>}
 */
export async function checkTaxSuppliersInErp(config, { erpEnabled, check = null, budgetMs = ERP_CHECK_BUDGET_MS }) {
  const entries = entriesOf(config);
  if (!erpEnabled || !entries.length) return { conferido: false, fornecedores: [], avisos: [] };
  const checkOne = check || createSupplierCheckSession().check;
  // Fornecedores conferidos ao mesmo tempo, numa sessão só: a leitura completa do SA2, se precisar, é uma por
  // salvamento. O prazo vale para o conjunto.
  const byCode = new Map();
  for (const entry of entries) {
    const key = `${entry.fornecedor}::${entry.loja}`;
    if (!byCode.has(key)) byCode.set(key, checkSupplier(entry.fornecedor, entry.loja, checkOne, budgetMs));
  }
  const fornecedores = [];
  const avisos = [];
  for (const entry of entries) {
    const situacao = await byCode.get(`${entry.fornecedor}::${entry.loja}`);
    const mensagem = situacao === "encontrado" ? null : checkMessage(entry, situacao);
    fornecedores.push({ campo: entry.campo, fornecedor: entry.fornecedor, loja: entry.loja, situacao, mensagem });
    if (mensagem) avisos.push(mensagem);
  }
  return { conferido: true, fornecedores, avisos };
}
