import { Worker } from "node:worker_threads";
import { logger } from "../../logger.js";
import { parseGuideLine } from "./guideLine.js";

// Leitura da guia em PDF. Só o texto do PDF é usado, e a linha digitável é procurada pelo formato, não pela
// posição na página — vale para qualquer modelo de guia. PDF escaneado (imagem, sem texto) não tem o que ler.

// Entre dois grupos de números da mesma linha só pode haver separador curto (espaço, quebra, ponto, traço).
const SEPARATOR = /^[\s.\-]{1,3}$/;
const LINE_LENGTH = 48;
/** Tempo máximo para ler o texto de uma guia. Estourou: a guia fica em exceção, como PDF não lido. */
export const PDF_READ_TIMEOUT_MS = 15 * 1000;
/** Guia de tributo tem uma ou duas páginas; acima disto o PDF não é lido (e a guia fica em exceção). */
export const PDF_MAX_PAGES = 20;
// Teto de memória da thread de leitura: PDF montado para estourar memória derruba só a thread.
const WORKER_MEMORY_MB = 256;
const BARCODE_LENGTH = 44;

export const READ_FAILURES = {
  nao_encontrada: "nao_encontrada",
  multiplas: "multiplas",
};

/**
 * Códigos de barras de guia de tributo válidos encontrados no texto. Procura primeiro linhas digitáveis (48);
 * só sem nenhuma, códigos de barras impressos em número (44).
 * @returns {string[]} códigos de barras (44) distintos, na ordem em que aparecem
 */
export function findGuideBarcodes(text) {
  const runs = [...String(text || "").matchAll(/\d+/g)].map((match) => ({
    digits: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  for (const length of [LINE_LENGTH, BARCODE_LENGTH]) {
    const found = [];
    for (let i = 0; i < runs.length; i += 1) {
      if (runs[i].digits[0] !== "8") continue;
      let digits = "";
      for (let j = i; j < runs.length; j += 1) {
        if (j > i && !SEPARATOR.test(text.slice(runs[j - 1].end, runs[j].start))) break;
        digits += runs[j].digits;
        if (digits.length >= length) break;
      }
      if (digits.length !== length) continue;
      const parsed = parseGuideLine(digits);
      if (parsed.ok && !found.includes(parsed.barcode)) found.push(parsed.barcode);
    }
    if (found.length) return found;
  }
  return [];
}

/**
 * Campos da guia além da linha digitável (CNPJ, "pagar até"). Ponto único para a extração estruturada por modelo
 * de guia: enquanto não houver exemplo real de cada modelo, nada é extraído — devolver um valor errado aqui
 * criaria exceção falsa (ou esconderia uma verdadeira).
 * @param {string} _text texto do PDF
 * @returns {{ cnpj: string|null, pagarAte: string|null }}
 */
export function extractGuideFields(_text) {
  return { cnpj: null, pagarAte: null };
}

class PdfReadError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "PdfReadError";
    this.reason = reason;
  }
}

// Texto do PDF lido numa thread separada, encerrada se passar do tempo — um PDF que trava o pdf.js não segura a
// requisição nem o processo.
function pdfText(buffer, { timeoutMs, maxPages }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./guidePdfWorker.js", import.meta.url), {
      workerData: { buffer, maxPages },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_MB },
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(value);
    };
    const timer = setTimeout(
      () => finish(reject, new PdfReadError(`leitura do PDF passou de ${timeoutMs} ms`, "tempo_esgotado")),
      timeoutMs
    );
    worker.once("message", (message) => {
      if (message?.error) return finish(reject, new PdfReadError(message.error.message, "pdf_invalido"));
      if (message?.tooManyPages) {
        return finish(reject, new PdfReadError(`PDF com ${message.pages} páginas (máximo ${maxPages})`, "paginas_demais"));
      }
      return finish(resolve, message?.text || "");
    });
    worker.once("error", (error) => finish(reject, new PdfReadError(error?.message || String(error), "falha_na_leitura")));
    worker.once("exit", (code) => finish(reject, new PdfReadError(`leitura do PDF encerrada (código ${code})`, "falha_na_leitura")));
  });
}

/**
 * Lê a guia em PDF. `timeoutMs` e `maxPages` existem para o teste; o padrão é o limite de produção.
 * @returns {Promise<{ barcode: string|null, failure: string|null, fields: { cnpj: string|null, pagarAte: string|null } }>}
 */
export async function readGuidePdf(buffer, { timeoutMs = PDF_READ_TIMEOUT_MS, maxPages = PDF_MAX_PAGES } = {}) {
  let text;
  try {
    text = await pdfText(buffer, { timeoutMs, maxPages });
  } catch (error) {
    // PDF corrompido, protegido por senha, grande demais ou lento demais: não há o que ler, e isso vira exceção
    // da guia, não erro do envio.
    logger.warn({ err: error, reason: error?.reason }, "não foi possível extrair o texto da guia em PDF");
    return { barcode: null, failure: READ_FAILURES.nao_encontrada, fields: extractGuideFields("") };
  }
  const fields = extractGuideFields(text);
  const barcodes = findGuideBarcodes(text);
  if (barcodes.length === 1) return { barcode: barcodes[0], failure: null, fields };
  return {
    barcode: null,
    failure: barcodes.length ? READ_FAILURES.multiplas : READ_FAILURES.nao_encontrada,
    fields,
  };
}
