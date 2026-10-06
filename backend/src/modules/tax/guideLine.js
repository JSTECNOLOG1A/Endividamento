// Linha digitável de guia de tributo (DARF, guias estaduais): padrão FEBRABAN de ARRECADAÇÃO.
//
// Código de barras (44 números):
//   1º    8 (arrecadação)
//   2º    segmento (5 = órgãos governamentais, caso do DARF)
//   3º    identificador de valor: 6 ou 7 → dígitos verificadores em módulo 10; 8 ou 9 → módulo 11.
//         6 e 8 = valor efetivo em reais; 7 e 9 = quantidade de moeda (o campo de valor não é o valor a pagar)
//   4º    dígito verificador geral, calculado sobre os outros 43 números
//   5º–15º valor (11 números, em centavos)
// Linha digitável (48 números): o código de barras em 4 blocos de 11, cada um seguido do seu dígito verificador.
//
// Aceita a linha digitável (48) ou o código de barras (44). Boleto bancário (47, ou 44 que não começa com 8)
// não é guia de tributo e é recusado com mensagem própria.

const LINE_LENGTH = 48;
const BARCODE_LENGTH = 44;
const BANK_SLIP_LINE_LENGTH = 47;
const BLOCK_SIZE = 11;
const BLOCK_COUNT = 4;
const ALLOWED_INPUT = /^[0-9\s.\-]*$/;

const BLOCK_ORDINALS = ["1º", "2º", "3º", "4º"];

export function mod10(digits) {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let product = Number(digits[i]) * weight;
    if (product > 9) product = Math.floor(product / 10) + (product % 10);
    sum += product;
    weight = weight === 2 ? 1 : 2;
  }
  const rest = sum % 10;
  return rest === 0 ? 0 : 10 - rest;
}

export function mod11(digits) {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  // Resto 0 ou 1 dá dígito 0; os demais, 11 − resto.
  return rest <= 1 ? 0 : 11 - rest;
}

function checkDigitFor(valueIdentifier) {
  return valueIdentifier === "6" || valueIdentifier === "7" ? mod10 : mod11;
}

function failure(message, code = "INVALID_LINE") {
  return { ok: false, code, message };
}

function joinOrdinals(indexes) {
  const names = indexes.map((index) => BLOCK_ORDINALS[index]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Linha digitável (48) a partir do código de barras (44), com os dígitos de cada bloco. */
export function lineFromBarcode(barcode) {
  const checkDigit = checkDigitFor(barcode[2]);
  let line = "";
  for (let i = 0; i < BLOCK_COUNT; i += 1) {
    const block = barcode.slice(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE);
    line += block + String(checkDigit(block));
  }
  return line;
}

/** "85800000001-2 34560328202-6 ..." — como a guia imprime. */
export function formatGuideLine(line) {
  if (!line || line.length !== LINE_LENGTH) return line || null;
  const blocks = [];
  for (let i = 0; i < BLOCK_COUNT; i += 1) {
    const start = i * (BLOCK_SIZE + 1);
    blocks.push(`${line.slice(start, start + BLOCK_SIZE)}-${line[start + BLOCK_SIZE]}`);
  }
  return blocks.join(" ");
}

function valueFromBarcode(barcode) {
  // 7 e 9: o campo traz quantidade de moeda, não o valor a pagar.
  if (barcode[2] !== "6" && barcode[2] !== "8") return null;
  const cents = Number(barcode.slice(4, 15));
  // Valor zerado = a guia não informa o valor (não existe guia de R$ 0,00 a pagar).
  return cents > 0 ? cents / 100 : null;
}

function checkGeneralDigit(barcode) {
  const expected = checkDigitFor(barcode[2])(barcode.slice(0, 3) + barcode.slice(4));
  return String(expected) === barcode[3];
}

function checkBlocks(line) {
  const checkDigit = checkDigitFor(line[2]);
  const wrong = [];
  let barcode = "";
  for (let i = 0; i < BLOCK_COUNT; i += 1) {
    const start = i * (BLOCK_SIZE + 1);
    const block = line.slice(start, start + BLOCK_SIZE);
    if (String(checkDigit(block)) !== line[start + BLOCK_SIZE]) wrong.push(i);
    barcode += block;
  }
  return { wrong, barcode };
}

/**
 * Lê uma linha digitável (ou código de barras) de guia de tributo.
 * @returns {{ ok: true, barcode: string, line: string, value: number|null } | { ok: false, code: string, message: string }}
 */
export function parseGuideLine(input) {
  if (input === undefined || input === null || (typeof input !== "string" && typeof input !== "number")) {
    return failure("Informe a linha digitável da guia.", "LINE_REQUIRED");
  }
  const raw = String(input).trim();
  if (!raw) return failure("Informe a linha digitável da guia.", "LINE_REQUIRED");
  if (!ALLOWED_INPUT.test(raw)) {
    return failure("A linha digitável deve ter só números. Espaços, pontos e traços podem ficar, mas letras e outros símbolos não.");
  }
  const digits = raw.replace(/\D/g, "");

  if (digits.length === BANK_SLIP_LINE_LENGTH || (digits.length === BARCODE_LENGTH && digits[0] !== "8")) {
    return failure(
      "Esta é a linha de um boleto bancário, não de uma guia de tributo. A guia de tributo (DARF ou guia estadual) tem 48 números e começa com 8.",
      "BANK_SLIP"
    );
  }
  if (digits.length !== LINE_LENGTH && digits.length !== BARCODE_LENGTH) {
    return failure(
      `A linha digitável da guia tem 48 números (ou 44, se você copiou o código de barras). Você informou ${digits.length}. Confira se faltou ou sobrou algum número.`
    );
  }
  if (digits[0] !== "8") {
    return failure("A linha digitável de guia de tributo começa com 8. Confira o primeiro número.");
  }
  if (!["6", "7", "8", "9"].includes(digits[2])) {
    return failure("O terceiro número da linha digitável deve ser 6, 7, 8 ou 9. Confira o início da linha.");
  }

  let barcode = digits;
  if (digits.length === LINE_LENGTH) {
    const blocks = checkBlocks(digits);
    if (blocks.wrong.length) {
      const which = joinOrdinals(blocks.wrong);
      return failure(
        blocks.wrong.length === 1
          ? `O ${which} bloco da linha digitável não confere (o último número do bloco não bate com os anteriores). Confira os números desse bloco.`
          : `Os blocos ${which} da linha digitável não conferem (o último número de cada bloco não bate com os anteriores). Confira os números desses blocos.`
      );
    }
    barcode = blocks.barcode;
  }
  if (!checkGeneralDigit(barcode)) {
    return failure("O dígito verificador geral da guia (o 4º número da linha) não confere. Confira a linha digitável.");
  }
  return { ok: true, barcode, line: lineFromBarcode(barcode), value: valueFromBarcode(barcode) };
}
