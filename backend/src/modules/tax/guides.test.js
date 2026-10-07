import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { request as httpRequest } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { lineFromBarcode, mod10, mod11, parseGuideLine } from "./guideLine.js";
import { findGuideBarcodes, readGuidePdf } from "./guidePdf.js";
import { amountToPay, guideExceptionReasons } from "./guideRules.js";
import { settleTaxTitleSyncs } from "./taxTitles.js";

// Guia da parcela (Gestão Tributária), de ponta a ponta: linha digitável, leitura do PDF, regras de exceção,
// substituição, envio por e-mail (SMTP de teste, nada sai para fora), isolamento, módulo e perfil.
// Rodar também com TZ positivo (ex.: TZ=Pacific/Kiritimati) para provar que data civil não desloca.

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

// ---------------------------------------------------------------------------
// Dublês e utilidades
// ---------------------------------------------------------------------------

function rawRequest(server, { method, path: requestPath, token, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method,
      headers: {
        ...(body ? { "content-length": body.length } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = raw.length ? JSON.parse(raw.toString("utf8")) : null; } catch { json = null; }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function jsonCall(server, token, method, requestPath, payload) {
  const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  return rawRequest(server, {
    method,
    path: requestPath,
    token,
    body,
    headers: body ? { "content-type": "application/json" } : {},
  });
}

function multipartCall(server, token, requestPath, { fields = {}, file = null }) {
  const boundary = `----guia${randomUUID()}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field || "file"}"; filename="${file.name}"\r\nContent-Type: ${file.type || "application/pdf"}\r\n\r\n`,
      "utf8"
    ));
    parts.push(file.buffer, Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return rawRequest(server, {
    method: "POST",
    path: requestPath,
    token,
    body: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
}

// PDF mínimo de uma página com texto em Helvetica (cada item vira uma linha da página).
function buildPdf(lines) {
  const escape = (text) => text.replace(/[()\\]/g, (c) => `\\${c}`);
  const content = lines.map((line, i) => `BT /F1 10 Tf 40 ${780 - i * 14} Td (${escape(line)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// Linha digitável válida de arrecadação montada para o teste (segmento 5 = órgão governamental, como o DARF).
function makeLine({ cents, tail, valueId = "8" }) {
  const rest = String(cents).padStart(11, "0") + String(tail).padEnd(29, "0").slice(0, 29);
  const head = `85${valueId}`;
  const dv = (valueId === "6" || valueId === "7" ? mod10 : mod11)(head + rest);
  return lineFromBarcode(`${head}${dv}${rest}`);
}

function spaced(line) {
  return [0, 1, 2, 3].map((i) => `${line.slice(i * 12, i * 12 + 11)}-${line[i * 12 + 11]}`).join(" ");
}

// Troca o dígito na posição (0-based) por outro.
function withDigit(text, index) {
  const digit = Number(text[index]);
  return text.slice(0, index) + String((digit + 1) % 10) + text.slice(index + 1);
}

// SMTP de teste: aceita tudo, exceto destinatários que `rejectRcpt` recusa. Guarda cada mensagem recebida.
function startFakeSmtp() {
  const state = { messages: [], rejectRcpt: () => false };
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let current = { to: [], data: "" };
    socket.write("220 smtp de teste\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          state.messages.push(current);
          current = { to: [], data: "" };
          socket.write("250 OK\r\n");
          continue;
        }
        const index = buffer.indexOf("\r\n");
        if (index < 0) return;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO" || command === "HELO") socket.write("250-teste\r\n250 8BITMIME\r\n");
        else if (command === "RCPT") {
          const address = /<([^>]*)>/.exec(line)?.[1] || "";
          if (state.rejectRcpt(address)) socket.write("550 caixa inexistente\r\n");
          else {
            current.to.push(address);
            socket.write("250 OK\r\n");
          }
        } else if (command === "DATA") {
          inData = true;
          socket.write("354 pode mandar\r\n");
        } else if (command === "QUIT") {
          socket.end("221 tchau\r\n");
        } else if (command === "RSET") {
          current = { to: [], data: "" };
          socket.write("250 OK\r\n");
        } else socket.write("250 OK\r\n");
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state })));
}

// Assunto em "encoded words" (=?UTF-8?Q?...?=) de volta a texto.
function decodedSubject(data) {
  const header = /^Subject: (.*(?:\r\n[ \t].*)*)/m.exec(data)?.[1] || "";
  return header.replace(/\r\n[ \t]/g, " ").replace(/=\?UTF-8\?Q\?([^?]*)\?=\s*/gi, (_, word) => {
    const bytes = word.replace(/_/g, " ").replace(/=([0-9A-F]{2})/g, (__, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }).trim();
}

// Conteúdo do anexo PDF (base64) da mensagem, ou null.
function pdfAttachment(data) {
  const match = /Content-Type: application\/pdf[^]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+)/i.exec(data);
  return match ? Buffer.from(match[1].replace(/\r\n/g, ""), "base64") : null;
}

// Corpo de e-mail em quoted-printable/base64 decodificado o bastante para procurar texto.
function decodedMail(data) {
  const qp = data.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(qp, "latin1").toString("utf8");
}

// ---------------------------------------------------------------------------
// Linha digitável (puro)
// ---------------------------------------------------------------------------

function lineTests() {
  // Exemplos publicados de linhas de arrecadação (módulo 10, identificador 6) — oráculo externo ao código.
  const energy = parseGuideLine("83640000001-1 33120138000-2 81288462711-6 08013618155-1");
  check(energy.ok && energy.value === 133.12 && energy.barcode === "83640000001331201380008128846271108013618155", `linha mod10 publicada: ${JSON.stringify(energy)}`);
  const other = parseGuideLine("846700000017435900240209024050002435842210108119");
  check(other.ok && other.value === 143.59, `segunda linha mod10 publicada: ${JSON.stringify(other)}`);
  // DARF (identificador 8, módulo 11).
  const darf = parseGuideLine("85890000460-9 52460179160-5 60759305086-5 83148300001-0");
  check(darf.ok && darf.value === 46052.46, `DARF mod11: ${JSON.stringify(darf)}`);
  // Código de barras (44) da mesma guia gera a mesma linha.
  const fromBarcode = parseGuideLine("83640000001331201380008128846271108013618155");
  check(fromBarcode.ok && fromBarcode.line === "836400000011331201380002812884627116080136181551", `código de barras → linha: ${JSON.stringify(fromBarcode)}`);
  const dotted = parseGuideLine("8364.0000001-1  3312.0138000-2\n81288462711.6 08013618155 1");
  check(dotted.ok && dotted.barcode === energy.barcode, "pontos, traços, espaços e quebras são aceitos");

  // Dígito de cada bloco, nos dois módulos: o bloco errado é apontado.
  // Literais (não a saída do parser): uma mutação no cálculo do DV precisa reprovar aqui, não derrubar o teste.
  const mod10Line = "836400000011331201380002812884627116080136181551";
  const mod11Line = "858900004609524601791605607593050865831483000010";
  for (const [label, line] of [["mod10", mod10Line], ["mod11", mod11Line]]) {
    for (let block = 0; block < 4; block += 1) {
      const broken = parseGuideLine(withDigit(line, block * 12 + 11));
      const ordinal = ["1º", "2º", "3º", "4º"][block];
      check(!broken.ok && broken.message.includes(`O ${ordinal} bloco da linha digitável não confere`), `${label} bloco ${ordinal} errado: ${JSON.stringify(broken)}`);
    }
    // Um dígito trocado no meio do bloco também derruba o bloco.
    const typo = parseGuideLine(withDigit(line, 14));
    check(!typo.ok && typo.message.includes("2º bloco"), `${label} número trocado no 2º bloco: ${JSON.stringify(typo)}`);
  }
  const twoBlocks = parseGuideLine(withDigit(withDigit(mod11Line, 11), 47));
  check(!twoBlocks.ok && twoBlocks.message.includes("Os blocos 1º e 4º"), `dois blocos errados: ${JSON.stringify(twoBlocks)}`);

  // DV geral: blocos coerentes, DV geral errado (linha refeita a partir de um código de barras com DV geral trocado).
  for (const [label, barcode] of [["mod10", "83640000001331201380008128846271108013618155"], ["mod11", "85890000460524601791606075930508683148300001"]]) {
    const wrongGeneral = withDigit(barcode, 3);
    const viaLine = parseGuideLine(lineFromBarcode(wrongGeneral));
    check(!viaLine.ok && viaLine.message.includes("dígito verificador geral"), `${label} DV geral errado na linha: ${JSON.stringify(viaLine)}`);
    const viaBarcode = parseGuideLine(wrongGeneral);
    check(!viaBarcode.ok && viaBarcode.message.includes("dígito verificador geral"), `${label} DV geral errado no código de barras: ${JSON.stringify(viaBarcode)}`);
  }

  const bankSlip = parseGuideLine("23790.12301 60000.000053 25000.456704 9 79870000010000");
  check(!bankSlip.ok && bankSlip.code === "BANK_SLIP" && bankSlip.message.includes("boleto bancário"), `boleto (47): ${JSON.stringify(bankSlip)}`);
  const bankBarcode = parseGuideLine("23799798700000100000123060000000052500045670");
  check(!bankBarcode.ok && bankBarcode.code === "BANK_SLIP", `código de barras de boleto (44, não começa com 8): ${JSON.stringify(bankBarcode)}`);
  const short = parseGuideLine("8589000046095246017916");
  check(!short.ok && short.message.includes("Você informou 22"), `tamanho errado: ${JSON.stringify(short)}`);
  const letters = parseGuideLine("85890000460-9 5246O179160-5");
  check(!letters.ok && letters.message.includes("só números"), `letra no meio: ${JSON.stringify(letters)}`);
  const badId = parseGuideLine("85590000460524601791606075930508683148300001");
  check(!badId.ok && badId.message.includes("terceiro número"), `identificador de valor inválido: ${JSON.stringify(badId)}`);
  const empty = parseGuideLine("  ");
  check(!empty.ok && empty.code === "LINE_REQUIRED", "linha vazia");

  // Valor só quando o identificador diz que é valor efetivo; zero = sem valor.
  const quantity = parseGuideLine(makeLine({ cents: 12345, tail: "1", valueId: "9" }));
  check(quantity.ok && quantity.value === null, `identificador 9 não traz valor: ${JSON.stringify(quantity)}`);
  const quantity7 = parseGuideLine(makeLine({ cents: 12345, tail: "1", valueId: "7" }));
  check(quantity7.ok && quantity7.value === null, `identificador 7 não traz valor: ${JSON.stringify(quantity7)}`);
  const effective6 = parseGuideLine(makeLine({ cents: 12345, tail: "1", valueId: "6" }));
  check(effective6.ok && effective6.value === 123.45, `identificador 6 traz valor: ${JSON.stringify(effective6)}`);
  const zero = parseGuideLine(makeLine({ cents: 0, tail: "1" }));
  check(zero.ok && zero.value === null, `valor zerado = sem valor: ${JSON.stringify(zero)}`);
}

function ruleTests() {
  const base = { barcode: "8".padEnd(44, "1"), readFailure: null, guideCnpj: null, companyCnpj: "11.222.333/0001-81", payBy: null, dueDate: "2026-03-31", peers: [] };
  const codes = (facts) => guideExceptionReasons({ ...base, ...facts }).map((item) => item.codigo);
  // CNPJ: os quatro quadrantes (guia conhecida/desconhecida × empresa conhecida/desconhecida) e o caso igual.
  check(codes({ guideCnpj: "99888777000166" }).join() === "CNPJ_DIFERENTE", "CNPJ da guia diferente do da empresa vira exceção");
  check(codes({ guideCnpj: "11222333000181" }).length === 0, "CNPJ igual (com e sem máscara) não é exceção");
  check(codes({ guideCnpj: null }).length === 0, "CNPJ da guia desconhecido não é exceção");
  check(codes({ guideCnpj: "99888777000166", companyCnpj: "" }).length === 0, "CNPJ da empresa desconhecido não é exceção");
  // "Pagar até": conhecido no mês, conhecido fora (antes e depois), desconhecido.
  check(codes({ payBy: "2026-03-01" }).length === 0, "pagar até no primeiro dia do mês do vencimento");
  check(codes({ payBy: "2026-03-31" }).length === 0, "pagar até no último dia do mês do vencimento");
  check(codes({ payBy: "2026-04-01" }).join() === "PAGAR_ATE_FORA_DO_MES", "pagar até no mês seguinte vira exceção");
  check(codes({ payBy: "2026-02-28" }).join() === "PAGAR_ATE_FORA_DO_MES", "pagar até no mês anterior vira exceção");
  check(codes({ payBy: "2025-03-15" }).join() === "PAGAR_ATE_FORA_DO_MES", "mesmo mês de outro ano vira exceção");
  check(codes({ payBy: null }).length === 0, "pagar até desconhecido não é exceção");
  // Leitura e duplicidade; mais de um motivo ao mesmo tempo.
  check(codes({ barcode: null, readFailure: "nao_encontrada" }).join() === "LINHA_NAO_LIDA", "sem linha: leitura");
  check(codes({ barcode: null, readFailure: "multiplas" }).join() === "VARIAS_LINHAS_NO_PDF", "várias linhas no PDF");
  const many = codes({ peers: [{ numero_parcela: 2, codigo_parcelamento: "X", orgao: "PGFN" }], payBy: "2026-05-10", guideCnpj: "99888777000166" });
  check(many.join() === "CNPJ_DIFERENTE,GUIA_EM_OUTRA_PARCELA,PAGAR_ATE_FORA_DO_MES", `vários motivos juntos: ${many.join()}`);
  // Valor a pagar: só guia vinculada com valor.
  check(amountToPay({ situacao: "vinculada", valor_guia: 10 }) === 10, "vinculada com valor: valor da guia");
  check(amountToPay({ situacao: "excecao", valor_guia: 10 }) === null, "em exceção: sem valor a pagar");
  check(amountToPay({ situacao: "vinculada", valor_guia: null }) === null, "vinculada sem valor: sem valor a pagar");
}

async function pdfTests() {
  const line = makeLine({ cents: 98765, tail: "4242" });
  const text = `DARF\nDocumento de Arrecadação de Receitas Federais\nValor total 987,65\n${spaced(line)}\nAutenticação 12345678901`;
  check(findGuideBarcodes(text).length === 1 && findGuideBarcodes(text)[0] === parseGuideLine(line).barcode, "linha encontrada no meio do texto");
  // Números soltos de 48 dígitos que não fecham DV não viram guia.
  check(findGuideBarcodes(`Processo ${"8".repeat(48)}`).length === 0, "sequência sem DV não é guia");

  const readable = await readGuidePdf(buildPdf(["DARF", "Linha digitável:", spaced(line), "Pague até o vencimento"]));
  check(readable.barcode === parseGuideLine(line).barcode && readable.failure === null, `PDF com linha: ${JSON.stringify(readable)}`);
  const twice = await readGuidePdf(buildPdf([spaced(line), "Via do contribuinte", spaced(line)]));
  check(twice.barcode === parseGuideLine(line).barcode, "a mesma linha impressa duas vezes é uma guia só");
  const scanned = await readGuidePdf(buildPdf([]));
  check(scanned.barcode === null && scanned.failure === "nao_encontrada", `PDF sem texto: ${JSON.stringify(scanned)}`);
  const otherLine = makeLine({ cents: 11111, tail: "999" });
  const two = await readGuidePdf(buildPdf([spaced(line), spaced(otherLine)]));
  check(two.barcode === null && two.failure === "multiplas", `PDF com duas guias: ${JSON.stringify(two)}`);
  const corrupt = await readGuidePdf(Buffer.from("%PDF-1.4 conteúdo quebrado", "latin1"));
  check(corrupt.barcode === null && corrupt.failure === "nao_encontrada", `PDF corrompido não derruba: ${JSON.stringify(corrupt)}`);
  const broken = withDigit(line, 20);
  const wrongDigits = await readGuidePdf(buildPdf([spaced(broken)]));
  // Leitura que estoura o tempo ou o teto de páginas: tratada como PDF não lido, sem derrubar nada.
  const readablePdf = buildPdf([spaced(line)]);
  const slow = await readGuidePdf(readablePdf, { timeoutMs: 1 });
  check(slow.barcode === null && slow.failure === "nao_encontrada", `leitura além do tempo: ${JSON.stringify(slow)}`);
  const tooManyPages = await readGuidePdf(readablePdf, { maxPages: 0 });
  check(tooManyPages.barcode === null && tooManyPages.failure === "nao_encontrada", `PDF acima do teto de páginas: ${JSON.stringify(tooManyPages)}`);
  const withinLimits = await readGuidePdf(readablePdf, { maxPages: 1 });
  check(withinLimits.barcode === parseGuideLine(line).barcode, "PDF no limite de páginas é lido");
  check(wrongDigits.barcode === null && wrongDigits.failure === "nao_encontrada", "PDF com dígitos que não batem: não lido");
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function main() {
  lineTests();
  ruleTests();
  await pdfTests();

  const previousUploadDir = config.uploadDir;
  const previousSmtp = { host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure, user: config.smtpUser };
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "tax-guias-"));
  config.uploadDir = uploadDir;
  config.smtpHost = "";
  const smtp = await startFakeSmtp();

  const suffix = `${Date.now()}`;
  const groupA = `grp_guia_a_${suffix}`;
  const groupB = `grp_guia_b_${suffix}`;
  const entityA = `ent_guia_a_${suffix}`;
  const entityB = `ent_guia_b_${suffix}`;
  const tenantA = `tnt_guia_a_${suffix}`;
  const tenantB = `tnt_guia_b_${suffix}`;
  const users = {
    ownerA: { id: randomUUID(), email: `owner-a-${suffix}@guia.test`, name: "Ana Financeiro", role: "admin", tenantRole: "OWNER", tenant: tenantA, group: groupA, tax: true },
    noTaxA: { id: randomUUID(), email: `notax-a-${suffix}@guia.test`, name: "Sem Módulo", role: "admin", tenantRole: "ADMIN", tenant: tenantA, group: groupA, tax: false },
    viewerA: { id: randomUUID(), email: `viewer-a-${suffix}@guia.test`, name: "Visualizador", role: "viewer", tenantRole: "VIEWER", tenant: tenantA, group: groupA, tax: true },
    ownerB: { id: randomUUID(), email: `owner-b-${suffix}@guia.test`, name: "Bruno", role: "admin", tenantRole: "OWNER", tenant: tenantB, group: groupB, tax: true },
  };
  const agreementA = randomUUID();
  const agreementA2 = randomUUID();
  const agreementB = randomUUID();
  const inst = { a1: randomUUID(), a2: randomUUID(), a3: randomUUID(), a4: randomUUID(), paid: randomUUID(), other: randomUUID(), b1: randomUUID() };

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Guia A','ativo','teste'), ($2,'Guia B','ativo','teste')`,
      [groupA, groupB]
    );
    await pool.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
       VALUES ($1,$2,'Agro Exemplo Ltda','11.222.333/0001-81','CNPJ','empresa','81','01','ativa','teste'),
              ($3,$4,'Empresa B','00.000.000/0001-91','CNPJ','empresa','91','01','ativa','teste')`,
      [entityA, groupA, entityB, groupB]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'Guia A','STARTER','trial',$5,'teste'), ($3,$4,'Guia B','STARTER','trial',$6,'teste')`,
      [tenantA, groupA, tenantB, groupB, users.ownerA.email, users.ownerB.email]
    );
    for (const user of Object.values(users)) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_by) VALUES ($1,$2,'hash',$3,$4,'active','teste')`,
        [user.id, user.email, user.name, user.role]
      );
      await pool.query(
        `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,$5,$6,'teste')`,
        [`tu_${user.id}`, user.tenant, user.group, user.email, user.tenantRole, user.tax ? { tax: true } : {}]
      );
    }
    await pool.query(
      `INSERT INTO tax_agreements (id, group_id, entity_id, esfera, orgao, modalidade, tributo, codigo_parcelamento, qtd_parcelas, created_by)
       VALUES ($1,$2,$3,'federal','Receita Federal','Simplificado','IRPJ','PARC-G1',60,'teste'),
              ($4,$2,$3,'estadual','SEFAZ','ICMS',NULL,'EST-G2',NULL,'teste'),
              ($5,$6,$7,'federal','PGFN','Transação',NULL,'PARC-B1',NULL,'teste')`,
      [agreementA, groupA, entityA, agreementA2, agreementB, groupB, entityB]
    );
    await pool.query(`UPDATE tax_agreements SET uf = 'SP' WHERE id = $1`, [agreementA2]);
    await pool.query(
      `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor, situacao, data_pagamento, created_by)
       VALUES ($1,$8,$9,1,'2026-03-31',500,'em_aberto',NULL,'teste'),
              ($2,$8,$9,2,'2026-04-30',500,'em_aberto',NULL,'teste'),
              ($3,$8,$9,3,'2026-05-29',500,'em_aberto',NULL,'teste'),
              ($4,$8,$9,4,'2026-06-30',500,'em_aberto',NULL,'teste'),
              ($5,$8,$9,5,'2026-01-30',500,'reconhecida','2026-01-30','teste'),
              ($6,$8,$10,1,'2026-03-31',800,'em_aberto',NULL,'teste'),
              ($7,$11,$12,1,'2026-03-31',300,'em_aberto',NULL,'teste')`,
      [inst.a1, inst.a2, inst.a3, inst.a4, inst.paid, inst.other, inst.b1, groupA, agreementA, agreementA2, groupB, agreementB]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  const token = (user) => issueAuthResponse(
    { id: user.id, email: user.email, full_name: user.name, role: user.role, platform_admin: false },
    { id: user.tenant, group_id: user.group, tenant_name: "Teste", tenant_role: user.tenantRole, billing_status: "trial", plan: "STARTER" }
  ).token;
  const tA = token(users.ownerA);
  const tNoTax = token(users.noTaxA);
  const tViewer = token(users.viewerA);
  const tB = token(users.ownerB);

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const guideUrl = (id) => `/api/tax/installments/${id}/guide`;
  const call = (t, method, p, body) => jsonCall(server, t, method, p, body);
  const guideCount = async (id) => (await pool.query(`SELECT count(*)::int AS n FROM tax_installment_guides WHERE installment_id = $1`, [id])).rows[0].n;
  const storedFiles = () => {
    const root = path.join(uploadDir, "tax-guides");
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).flatMap((dir) => fs.readdirSync(path.join(root, dir)).map((f) => path.join(root, dir, f)));
  };
  const lastAudit = async (action, guideId) => (await pool.query(
    `SELECT * FROM audit_events WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
    [action, guideId]
  )).rows[0];
  const expectError = (res, status, code, messagePart, label) => {
    const ok = res.status === status && (!code || res.json?.code === code) && typeof res.json?.error === "string" && res.json.error.includes(messagePart);
    check(ok, `${label}: esperado ${status} ${code || ""} com "${messagePart}", veio ${res.status} ${JSON.stringify(res.json)}`);
  };

  const lineA1 = makeLine({ cents: 99999, tail: "1001" }); // R$ 999,99 — diferente dos R$ 500,00 cadastrados
  const lineShared = makeLine({ cents: 50000, tail: "2002" });
  const lineA3 = makeLine({ cents: 50000, tail: "3003" });

  try {
    // ---- Linha digitada ----
    const invalidTyped = await call(tA, "POST", guideUrl(inst.a1), { linha_digitavel: withDigit(lineA1, 23) });
    expectError(invalidTyped, 400, "TAX_VALIDATION", "O 2º bloco da linha digitável não confere", "linha digitada com DV errado");
    check(invalidTyped.json?.details?.field === "linha_digitavel", "erro aponta o campo linha_digitavel");
    expectError(await call(tA, "POST", guideUrl(inst.a1), { linha_digitavel: "23790.12301 60000.000053 25000.456704 9 79870000010000" }), 400, "TAX_VALIDATION", "boleto bancário", "boleto digitado");
    expectError(await call(tA, "POST", guideUrl(inst.a1), {}), 400, "TAX_VALIDATION", "Anexe o PDF da guia ou informe a linha digitável", "sem PDF nem linha");
    expectError(await call(tA, "POST", guideUrl(inst.a1), { linha_digitavel: lineA1, pagar_ate: "2026-02-30" }), 400, "TAX_VALIDATION", "pagar até", "pagar até inexistente");
    check(await guideCount(inst.a1) === 0, "linha recusada não grava guia");

    const typed = await call(tA, "POST", guideUrl(inst.a1), { linha_digitavel: spaced(lineA1) });
    const g1 = typed.json?.guia;
    check(typed.status === 201 && g1?.situacao === "vinculada" && g1.motivos.length === 0, `guia digitada: ${typed.status} ${JSON.stringify(typed.json)}`);
    // Valor diferente do cadastrado NÃO é exceção; valor a pagar = valor da guia, estimado = cadastrado.
    check(g1?.valor_guia === 999.99 && g1?.valor_a_pagar === 999.99 && g1?.valor_estimado === 500, `valor a pagar e estimado: ${JSON.stringify(g1)}`);
    check(g1?.linha_digitavel === lineA1 && g1?.linha_digitavel_formatada === spaced(lineA1) && g1?.origem === "digitada" && g1?.tem_arquivo === false, "linha normalizada só com dígitos e formatada para exibir");
    check(g1?.agreement_id === agreementA && g1?.criada_por === users.ownerA.email, "guia traz parcelamento e autor");
    const attachedAudit = await lastAudit("TAX_GUIDE_ATTACHED", g1?.id);
    check(attachedAudit?.registro === "Guia da parcela 1 — vencimento 31/03/2026 — parcelamento PARC-G1" && attachedAudit?.rotina === "Gestão Tributária", `auditoria do anexo: ${JSON.stringify(attachedAudit?.registro)}`);
    check(attachedAudit?.after_json?.situacao === "Vinculada" && attachedAudit?.after_json?.origem === "Linha digitada", `auditoria compreensível: ${JSON.stringify(attachedAudit?.after_json)}`);
    // A guia nunca dá baixa na parcela.
    const afterAttach = await pool.query(`SELECT situacao, data_pagamento, valor_pago FROM tax_installments WHERE id = $1`, [inst.a1]);
    check(afterAttach.rows[0].situacao === "em_aberto" && afterAttach.rows[0].data_pagamento === null && afterAttach.rows[0].valor_pago === null, "anexar guia não muda a situação da parcela");

    // ---- Uma guia atual: segunda só com substituição ----
    expectError(await call(tA, "POST", guideUrl(inst.a1), { linha_digitavel: lineA1 }), 409, "TAX_GUIDE_EXISTS", "confirme a substituição", "segunda guia sem substituir");

    // ---- PDF ----
    const filesBefore = storedFiles().length;
    expectError(await multipartCall(server, tA, guideUrl(inst.a1), { fields: { substituir: "true" }, file: { name: "guia.png", buffer: Buffer.from("\x89PNG\r\n\x1a\n...", "latin1"), type: "image/png" } }), 400, "INVALID_FILE", "A guia precisa ser um arquivo PDF.", "arquivo que não é PDF");
    expectError(await multipartCall(server, tA, guideUrl(inst.a1), { fields: { substituir: "true" }, file: { name: "grande.pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024 + 10, 32)]) } }), 413, "FILE_TOO_LARGE", "A guia passa do tamanho máximo de 10 MB.", "PDF grande demais");
    expectError(await multipartCall(server, tA, guideUrl(inst.a1), { fields: { substituir: "true", linha_digitavel: lineA1 }, file: { name: "g.pdf", buffer: buildPdf([spaced(lineA1)]) } }), 400, "TAX_VALIDATION", "não os dois", "PDF e linha juntos");
    check(storedFiles().length === filesBefore, "upload recusado não deixa arquivo no disco");

    const pdfA1 = buildPdf(["DARF", spaced(lineA1)]);
    const replaced = await multipartCall(server, tA, guideUrl(inst.a1), { fields: { substituir: "true" }, file: { name: "DARF março — Agro.pdf", buffer: pdfA1 } });
    const g1b = replaced.json?.guia;
    check(replaced.status === 201 && g1b?.origem === "pdf" && g1b?.linha_fonte === "pdf" && g1b?.situacao === "vinculada" && g1b?.tem_arquivo, `substituição por PDF: ${replaced.status} ${JSON.stringify(replaced.json)}`);
    check(replaced.json?.substituida?.id === g1?.id && replaced.json?.substituida?.motivo_encerramento === "substituida", "resposta diz qual guia foi substituída");
    check(g1b?.arquivo_nome === "DARF março — Agro.pdf", `nome do arquivo com acento: ${g1b?.arquivo_nome}`);
    const history = await call(tA, "GET", guideUrl(inst.a1));
    check(history.json?.guia?.id === g1b?.id && history.json?.historico?.length === 1 && history.json.historico[0].id === g1?.id, `histórico mantém a guia anterior: ${JSON.stringify(history.json)}`);
    check((await lastAudit("TAX_GUIDE_REPLACED", g1b?.id))?.before_json?.origem === "Linha digitada", "auditoria da substituição mostra a guia anterior");
    const download = await rawRequest(server, { method: "GET", path: `/api/tax/guides/${g1b?.id}/file?download=1`, token: tA });
    check(download.status === 200 && download.raw.equals(pdfA1) && String(download.headers["content-disposition"]).startsWith("attachment"), `download do PDF: ${download.status}`);

    // ---- PDF sem linha legível → exceção, depois linha informada à mão ----
    const scanned = await multipartCall(server, tA, guideUrl(inst.a3), { file: { name: "escaneado.pdf", buffer: buildPdf([]) } });
    const g3 = scanned.json?.guia;
    check(scanned.status === 201 && g3?.situacao === "excecao" && g3?.linha_digitavel === null && g3?.valor_a_pagar === null, `PDF escaneado: ${JSON.stringify(scanned.json)}`);
    check(g3?.motivos?.[0]?.mensagem === "Não foi possível ler a linha digitável deste PDF. Informe a linha digitável à mão.", `motivo da leitura: ${JSON.stringify(g3?.motivos)}`);
    expectError(await call(tA, "PATCH", guideUrl(inst.a3), { linha_digitavel: "123" }), 400, "TAX_VALIDATION", "Você informou 3", "correção com linha inválida");
    const corrected = await call(tA, "PATCH", guideUrl(inst.a3), { linha_digitavel: lineA3, pagar_ate: "2026-05-29" });
    check(corrected.status === 200 && corrected.json?.guia?.situacao === "vinculada" && corrected.json.guia.linha_fonte === "digitada" && corrected.json.guia.tem_arquivo && corrected.json.guia.id === g3?.id, `linha informada à mão: ${JSON.stringify(corrected.json)}`);
    check((await lastAudit("TAX_GUIDE_CORRECTED", g3?.id))?.before_json?.situacao === "Em exceção", "auditoria da correção");
    // Linha lida do PDF não é trocada à mão (o PDF anexado seria de outra guia).
    expectError(await call(tA, "PATCH", guideUrl(inst.a1), { linha_digitavel: lineA3 }), 409, "TAX_GUIDE_LINE_FROM_PDF", "substitua o PDF", "trocar linha lida do PDF");

    // ---- "Pagar até" fora do mês ----
    const outOfMonth = await call(tA, "PATCH", guideUrl(inst.a3), { pagar_ate: "2026-06-01" });
    check(outOfMonth.json?.guia?.situacao === "excecao" && outOfMonth.json.guia.motivos.map((m) => m.codigo).join() === "PAGAR_ATE_FORA_DO_MES", `pagar até fora do mês: ${JSON.stringify(outOfMonth.json)}`);
    check(outOfMonth.json?.guia?.motivos?.[0]?.mensagem === "O \"pagar até\" da guia (01/06/2026) não é do mês de vencimento da parcela (maio de 2026).", `mensagem do pagar até: ${outOfMonth.json?.guia?.motivos?.[0]?.mensagem}`);
    const backInMonth = await call(tA, "PATCH", guideUrl(inst.a3), { pagar_ate: null });
    check(backInMonth.json?.guia?.situacao === "vinculada" && backInMonth.json.guia.pagar_ate === null, "pagar até apagado: volta a vinculada");
    // Mudar o vencimento da parcela pelo cadastro verifica a guia de novo.
    await call(tA, "PATCH", guideUrl(inst.a3), { pagar_ate: "2026-05-29" });
    const moved = await call(tA, "PATCH", `/api/entities/TaxInstallment/${inst.a3}`, { vencimento: "2026-06-30" });
    check(moved.status === 200, `mudar vencimento: ${moved.status}`);
    const afterMove = await call(tA, "GET", guideUrl(inst.a3));
    check(afterMove.json?.guia?.situacao === "excecao" && afterMove.json.guia.motivos[0]?.codigo === "PAGAR_ATE_FORA_DO_MES", `vencimento movido recalcula a guia: ${JSON.stringify(afterMove.json?.guia)}`);
    await call(tA, "PATCH", `/api/entities/TaxInstallment/${inst.a3}`, { vencimento: "2026-05-29" });
    check((await call(tA, "GET", guideUrl(inst.a3))).json?.guia?.situacao === "vinculada", "vencimento de volta: vinculada");

    // ---- Mesma guia em outra parcela → exceção nas duas; remover uma libera a outra ----
    const sharedA2 = await call(tA, "POST", guideUrl(inst.a2), { linha_digitavel: lineShared });
    check(sharedA2.json?.guia?.situacao === "vinculada", "primeira parcela com a guia: vinculada");
    // Outro cliente com a mesma linha não interfere.
    const sharedB = await call(tB, "POST", guideUrl(inst.b1), { linha_digitavel: lineShared });
    check(sharedB.status === 201 && sharedB.json?.guia?.situacao === "vinculada", `mesma linha em outro cliente não é duplicidade: ${JSON.stringify(sharedB.json)}`);
    check((await call(tA, "GET", guideUrl(inst.a2))).json?.guia?.situacao === "vinculada", "guia do cliente A não muda pela guia do cliente B");
    const sharedOther = await call(tA, "POST", guideUrl(inst.other), { linha_digitavel: lineShared });
    const dupMotive = sharedOther.json?.guia?.motivos?.[0];
    check(sharedOther.status === 201 && sharedOther.json?.guia?.situacao === "excecao" && dupMotive?.codigo === "GUIA_EM_OUTRA_PARCELA", `duplicidade: ${JSON.stringify(sharedOther.json)}`);
    check(dupMotive?.mensagem === "Esta mesma guia também está anexada à parcela 2 do parcelamento PARC-G1 — Receita Federal. Uma guia paga uma parcela só.", `mensagem da duplicidade: ${dupMotive?.mensagem}`);
    const firstNow = (await call(tA, "GET", guideUrl(inst.a2))).json?.guia;
    check(firstNow?.situacao === "excecao" && firstNow.motivos[0]?.mensagem.includes("parcela 1 do parcelamento EST-G2 — SEFAZ"), `a parcela que já tinha a guia também vira exceção: ${JSON.stringify(firstNow)}`);
    check(firstNow?.valor_a_pagar === null, "guia em exceção não define valor a pagar");
    const removed = await call(tA, "DELETE", guideUrl(inst.other));
    check(removed.status === 200 && removed.json?.removida?.id === sharedOther.json?.guia?.id, `remover guia: ${removed.status}`);
    check((await call(tA, "GET", guideUrl(inst.a2))).json?.guia?.situacao === "vinculada", "remover a duplicata libera a outra parcela");
    const removedState = await call(tA, "GET", guideUrl(inst.other));
    check(removedState.json?.guia === null && removedState.json?.historico?.[0]?.motivo_encerramento === "removida", "guia removida fica no histórico");
    check((await lastAudit("TAX_GUIDE_REMOVED", sharedOther.json?.guia?.id))?.before_json?.linha_digitavel === spaced(lineShared), "auditoria da remoção");
    expectError(await call(tA, "DELETE", guideUrl(inst.other)), 404, "TAX_GUIDE_NOT_FOUND", "não tem guia", "remover sem guia");

    // ---- Resumo para a lista e a Visão geral ----
    const summary = await call(tA, "GET", "/api/tax/guides");
    const ids = (summary.json || []).map((g) => g.installment_id).sort();
    check(summary.status === 200 && ids.join() === [inst.a1, inst.a2, inst.a3].sort().join(), `resumo traz só as guias atuais do cliente: ${JSON.stringify(ids)}`);
    const byAgreement = await call(tA, "GET", `/api/tax/guides?agreement_id=${agreementA2}`);
    check(Array.isArray(byAgreement.json) && byAgreement.json.length === 0, "filtro por parcelamento");
    expectError(await call(tB, "GET", `/api/tax/guides?agreement_id=${agreementA}`), 404, "NOT_FOUND", "Parcelamento não encontrado", "filtro com parcelamento de outro cliente");
    const summaryB = await call(tB, "GET", "/api/tax/guides");
    check((summaryB.json || []).every((g) => g.installment_id === inst.b1), "cliente B só vê a guia dele");

    // ---- Envio por e-mail ----
    const sendUrl = `${guideUrl(inst.a1)}/send-email`;
    expectError(await call(tA, "POST", sendUrl, { destinatarios: [] }), 400, "VALIDATION", "Informe ao menos um e-mail", "sem destinatário");
    expectError(await call(tA, "POST", sendUrl, { destinatarios: ["financeiro@empresa.com.br", "nao-e-email"] }), 400, "VALIDATION", "\"nao-e-email\" não é um e-mail válido", "destinatário inválido");
    expectError(await call(tA, "POST", sendUrl, { destinatarios: Array.from({ length: 11 }, (_, i) => `p${i}@empresa.com.br`) }), 400, "VALIDATION", "no máximo 10", "destinatários demais");

    // SMTP ainda não configurado: falha clara, nunca "enviado".
    const notConfigured = await call(tA, "POST", sendUrl, { destinatarios: ["financeiro@empresa.com.br"] });
    expectError(notConfigured, 503, "EMAIL_NOT_CONFIGURED", "a guia não foi enviada", "SMTP não configurado");
    config.smtpHost = "127.0.0.1";
    config.smtpPort = smtp.server.address().port;
    config.smtpSecure = false;
    config.smtpUser = "";

    const sent = await call(tA, "POST", sendUrl, { destinatarios: "financeiro@empresa.com.br; Contas@Empresa.com.br, financeiro@empresa.com.br", mensagem: "Pagar até sexta, por favor." });
    check(sent.status === 200 && sent.json?.envio?.resultado === "enviado", `envio: ${sent.status} ${JSON.stringify(sent.json)}`);
    check(sent.json?.envio?.destinatarios?.join() === "financeiro@empresa.com.br,Contas@Empresa.com.br", `destinatários sem repetição: ${sent.json?.envio?.destinatarios}`);
    const mail = smtp.state.messages[smtp.state.messages.length - 1];
    const mailText = mail ? decodedMail(mail.data) : "";
    check(mail?.to?.join().toLowerCase() === "financeiro@empresa.com.br,contas@empresa.com.br", `SMTP recebeu os dois destinatários: ${mail?.to}`);
    for (const piece of [
      "Agro Exemplo Ltda (CNPJ 11.222.333/0001-81)", "Receita Federal", "PARC-G1", "Parcela: 1 de 60", "31/03/2026",
      "Valor a pagar: R$", "999,99", spaced(lineA1), "Pagar até sexta, por favor.", "Ana Financeiro",
    ]) {
      check(mailText.includes(piece), `e-mail deveria conter "${piece}"`);
    }
    const attached = pdfAttachment(mail?.data || "");
    check(attached?.equals(pdfA1), `o PDF anexado é o da guia: ${attached?.length} bytes`);
    check(/Reply-To: .*owner-a-/i.test(mail?.data || ""), "resposta volta para quem enviou");
    const subject = decodedSubject(mail?.data || "");
    check(subject === "Guia para pagamento — Agro Exemplo Ltda — Receita Federal — parcelamento PARC-G1 — parcela 1 — vencimento 31/03/2026", `assunto: ${subject}`);

    // Envio parcial: um endereço recusado pelo servidor.
    smtp.state.rejectRcpt = (address) => address.startsWith("errado");
    const partial = await call(tA, "POST", sendUrl, { destinatarios: ["financeiro@empresa.com.br", "errado@empresa.com.br"] });
    expectError(partial, 502, "EMAIL_SEND_PARTIAL", "mas o servidor de e-mail recusou errado@empresa.com.br", "envio parcial");
    const allRejected = await call(tA, "POST", sendUrl, { destinatarios: ["errado@empresa.com.br"] });
    expectError(allRejected, 502, "EMAIL_SEND_FAILED", "A guia não foi enviada", "todos recusados");
    smtp.state.rejectRcpt = () => false;

    const sends = await call(tA, "GET", `${guideUrl(inst.a1)}/sends`);
    const results = (sends.json || []).map((s) => s.resultado);
    check(results.join() === "falhou,parcial,enviado,falhou", `histórico de envios (mais recente primeiro): ${results.join()}`);
    check(sends.json?.[2]?.enviado_por === users.ownerA.email && sends.json?.[2]?.com_anexo === true && sends.json?.[1]?.recusados?.join() === "errado@empresa.com.br", "histórico guarda quem, para quem, anexo e recusados");
    check(sends.json?.[3]?.mensagem_resultado === "Não enviado: o envio de e-mail não está configurado no sistema.", `falha por falta de SMTP: ${sends.json?.[3]?.mensagem_resultado}`);
    check(sends.json?.[1]?.mensagem_resultado === "E-mail enviado só para parte dos destinatários. O servidor de e-mail recusou errado@empresa.com.br.", `mensagem do parcial: ${sends.json?.[1]?.mensagem_resultado}`);
    check(sends.json?.[0]?.mensagem_resultado === "Não enviado: o servidor de e-mail recusou errado@empresa.com.br.", `mensagem da recusa total: ${sends.json?.[0]?.mensagem_resultado}`);
    check(sends.json?.[2]?.mensagem_resultado === "E-mail enviado.", "mensagem do enviado");
    check((sends.json || []).every((item) => !("erro" in item)), "texto bruto do servidor de e-mail não vai para a tela");
    check(!("erro" in (partial.json || {})) && !JSON.stringify(partial.json).includes("550"), "resposta do envio parcial sem texto do servidor");
    const rawStored = await pool.query(`SELECT erro FROM tax_guide_sends WHERE installment_id = $1 AND resultado = 'parcial'`, [inst.a1]);
    check(Boolean(rawStored.rows[0]?.erro), "detalhe técnico fica guardado no servidor");
    const sentAudit = await lastAudit("TAX_GUIDE_EMAIL_SENT", g1b?.id);
    check(sentAudit?.payload?.destinatarios?.length === 2 && sentAudit?.registro?.startsWith("Guia da parcela 1"), `auditoria do envio: ${JSON.stringify(sentAudit?.payload)}`);
    check(Boolean(await lastAudit("TAX_GUIDE_EMAIL_FAILED", g1b?.id)), "auditoria da falha de envio");

    // Guia digitada vai sem anexo, avisando.
    await call(tA, "POST", guideUrl(inst.a4), { linha_digitavel: makeLine({ cents: 12345, tail: "4004", valueId: "9" }) });
    const typedSend = await call(tA, "POST", `${guideUrl(inst.a4)}/send-email`, { destinatarios: ["financeiro@empresa.com.br"] });
    const typedMail = decodedMail(smtp.state.messages[smtp.state.messages.length - 1]?.data || "");
    check(typedSend.status === 200 && typedSend.json?.envio?.com_anexo === false && typedMail.includes("não há PDF anexo"), "guia digitada: e-mail sem anexo");
    check(typedMail.includes("Valor estimado: R$") && typedMail.includes("500,00"), "guia sem valor: e-mail mostra o valor estimado");

    // Guia em exceção: envio bloqueado, nada sai.
    const beforeBlocked = smtp.state.messages.length;
    const sendsBefore = (await pool.query(`SELECT count(*)::int AS n FROM tax_guide_sends`)).rows[0].n;
    await call(tA, "PATCH", guideUrl(inst.a3), { pagar_ate: "2026-07-10" });
    const blocked = await call(tA, "POST", `${guideUrl(inst.a3)}/send-email`, { destinatarios: ["financeiro@empresa.com.br"] });
    expectError(blocked, 409, "TAX_GUIDE_EXCEPTION", "Esta guia está em exceção e não pode ser enviada", "envio de guia em exceção");
    check(blocked.json?.details?.motivos?.[0]?.codigo === "PAGAR_ATE_FORA_DO_MES", "erro traz os motivos");
    // Exceção que só aparece na hora do envio (estado gravado desatualizado): a conferência é refeita sob lock.
    await pool.query(
      `INSERT INTO tax_installment_guides (id, group_id, installment_id, origem, linha_fonte, linha_digitavel, codigo_barras, valor_guia, situacao, motivos)
       VALUES ($1,$2,$3,'digitada','digitada',$4,$5,999.99,'vinculada','[]')`,
      [randomUUID(), groupA, inst.other, lineA1, parseGuideLine(lineA1).barcode]
    );
    const staleBlocked = await call(tA, "POST", sendUrl, { destinatarios: ["financeiro@empresa.com.br"] });
    expectError(staleBlocked, 409, "TAX_GUIDE_EXCEPTION", "também está anexada à parcela 1 do parcelamento EST-G2", "duplicidade descoberta no envio");
    check((await call(tA, "GET", guideUrl(inst.a1))).json?.guia?.situacao === "excecao", "conferência do envio fica gravada");
    check(smtp.state.messages.length === beforeBlocked, "nenhum e-mail sai de guia em exceção");
    check((await pool.query(`SELECT count(*)::int AS n FROM tax_guide_sends`)).rows[0].n === sendsBefore, "envio bloqueado não é registrado como envio");
    // Parcela paga: não se envia guia para pagar de novo.
    await call(tA, "POST", guideUrl(inst.paid), { linha_digitavel: makeLine({ cents: 50000, tail: "5005" }), pagar_ate: "2026-01-30" });
    expectError(await call(tA, "POST", `${guideUrl(inst.paid)}/send-email`, { destinatarios: ["financeiro@empresa.com.br"] }), 409, "TAX_INSTALLMENT_CLOSED", "já está paga", "envio de guia de parcela paga");

    // ---- Isolamento entre clientes ----
    expectError(await call(tB, "GET", guideUrl(inst.a1)), 404, "NOT_FOUND", "Parcela não encontrada", "ler guia de outro cliente");
    expectError(await call(tB, "POST", guideUrl(inst.a4), { linha_digitavel: lineA3, substituir: true }), 404, "NOT_FOUND", "Parcela não encontrada", "anexar em parcela de outro cliente");
    expectError(await call(tB, "PATCH", guideUrl(inst.a3), { pagar_ate: null }), 404, "NOT_FOUND", "Parcela não encontrada", "corrigir guia de outro cliente");
    expectError(await call(tB, "DELETE", guideUrl(inst.a3)), 404, "NOT_FOUND", "Parcela não encontrada", "remover guia de outro cliente");
    expectError(await call(tB, "POST", `${guideUrl(inst.a4)}/send-email`, { destinatarios: ["x@y.com"] }), 404, "NOT_FOUND", "Parcela não encontrada", "enviar guia de outro cliente");
    expectError(await call(tB, "GET", `${guideUrl(inst.a1)}/sends`), 404, "NOT_FOUND", "Parcela não encontrada", "histórico de outro cliente");
    expectError(await rawRequest(server, { method: "GET", path: `/api/tax/guides/${g1b?.id}/file`, token: tB }), 404, "NOT_FOUND", "Guia não encontrada", "PDF de outro cliente");
    check((await call(tA, "GET", guideUrl(inst.a4))).json?.guia?.origem === "digitada", "tentativa do outro cliente não mexeu na guia");

    // ---- Módulo e perfil ----
    const gate = [
      ["GET", "/api/tax/guides"], ["GET", guideUrl(inst.a1)], ["GET", `${guideUrl(inst.a1)}/sends`],
      ["GET", `/api/tax/guides/${g1b?.id}/file`], ["POST", guideUrl(inst.a2), { linha_digitavel: lineA3, substituir: true }],
      ["PATCH", guideUrl(inst.a3), { pagar_ate: null }], ["DELETE", guideUrl(inst.a3)],
      ["POST", `${guideUrl(inst.a4)}/send-email`, { destinatarios: ["x@y.com"] }],
    ];
    for (const [method, p, body] of gate) {
      const res = await call(tNoTax, method, p, body);
      check(res.status === 403 && res.json?.code === "MODULE_FORBIDDEN", `sem módulo ${method} ${p}: ${res.status} ${res.json?.code}`);
    }
    check((await call(tViewer, "GET", guideUrl(inst.a1))).status === 200, "visualizador lê a guia");
    for (const [method, p, body] of gate.filter(([m]) => m !== "GET")) {
      const res = await call(tViewer, method, p, body);
      check(res.status === 403 && res.json?.code === "READ_ONLY", `visualizador ${method} ${p}: ${res.status} ${res.json?.code}`);
    }
    const viewerUpload = await multipartCall(server, tViewer, guideUrl(inst.a2), { fields: { substituir: "true" }, file: { name: "g.pdf", buffer: pdfA1 } });
    check(viewerUpload.status === 403 && viewerUpload.json?.code === "READ_ONLY", "visualizador não envia PDF");
    check((await call(tA, "GET", guideUrl(inst.a3))).json?.guia?.situacao === "excecao", "tentativas barradas não mexeram na guia");

    // ---- Limite de envios por usuário ----
    const alreadySent = (await pool.query(
      `SELECT count(*)::int AS n FROM tax_guide_sends WHERE enviado_por = $1 AND created_date > now() - interval '1 hour'`,
      [users.ownerA.email]
    )).rows[0].n;
    const guideA4 = (await pool.query(`SELECT id FROM tax_installment_guides WHERE installment_id = $1 AND encerrada_em IS NULL`, [inst.a4])).rows[0].id;
    for (let i = alreadySent; i < 29; i += 1) {
      await pool.query(
        `INSERT INTO tax_guide_sends (id, group_id, guide_id, installment_id, destinatarios, assunto, com_anexo, resultado, enviado_por)
         VALUES ($1,$2,$3,$4,ARRAY['x@empresa.com.br'],'teste',false,'enviado',$5)`,
        [randomUUID(), groupA, guideA4, inst.a4, users.ownerA.email]
      );
    }
    const lastAllowed = await call(tA, "POST", `${guideUrl(inst.a4)}/send-email`, { destinatarios: ["financeiro@empresa.com.br"] });
    check(lastAllowed.status === 200, `30º envio da hora ainda sai: ${lastAllowed.status} ${JSON.stringify(lastAllowed.json)}`);
    const mailsBeforeLimit = smtp.state.messages.length;
    const limited = await call(tA, "POST", `${guideUrl(inst.a4)}/send-email`, { destinatarios: ["financeiro@empresa.com.br"] });
    expectError(limited, 429, "TAX_GUIDE_SEND_LIMIT", "limite de 30 envios de guia por e-mail em uma hora. Tente de novo a partir das", "31º envio da hora");
    check(Number(limited.headers["retry-after"]) > 0 && Number(limited.headers["retry-after"]) <= 3600 && limited.json?.details?.tentar_apos, `Retry-After: ${limited.headers["retry-after"]}`);
    check(smtp.state.messages.length === mailsBeforeLimit, "envio barrado pelo limite não sai");
    // O limite é de quem envia: outro usuário do mesmo cliente segue enviando.
    const otherSender = { id: randomUUID(), email: `owner2-a-${suffix}@guia.test`, name: "Outra Pessoa", role: "admin", tenantRole: "OWNER", tenant: tenantA, group: groupA, tax: true };
    users.ownerA2 = otherSender;
    await pool.query(`INSERT INTO users (id, email, password_hash, full_name, role, status, created_by) VALUES ($1,$2,'hash',$3,'admin','active','teste')`, [otherSender.id, otherSender.email, otherSender.name]);
    await pool.query(`INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,'OWNER',$5,'teste')`, [`tu_${otherSender.id}`, tenantA, groupA, otherSender.email, { tax: true }]);
    const otherSend = await call(token(otherSender), "POST", `${guideUrl(inst.a4)}/send-email`, { destinatarios: ["financeiro@empresa.com.br"] });
    check(otherSend.status === 200, `outro usuário não é barrado pelo limite do primeiro: ${otherSend.status}`);

    // ---- Excluir parcela leva as guias e os PDFs, e libera a duplicata ----
    const filesOfA1 = (await pool.query(`SELECT arquivo_chave FROM tax_installment_guides WHERE installment_id = $1 AND arquivo_chave IS NOT NULL`, [inst.a1])).rows.map((r) => r.arquivo_chave);
    check(filesOfA1.length === 1 && filesOfA1.every((key) => fs.existsSync(path.join(uploadDir, "tax-guides", key))), "PDF da guia gravado no disco");
    const deletedInstallment = await call(tA, "DELETE", `/api/entities/TaxInstallment/${inst.a1}`);
    check(deletedInstallment.status === 200, `excluir parcela com guia: ${deletedInstallment.status} ${JSON.stringify(deletedInstallment.json)}`);
    const deleteAuditRow = (await pool.query(
      `SELECT registro, payload FROM audit_events WHERE action = 'DELETE' AND resource_type = 'TaxInstallment' AND resource_id = $1`,
      [inst.a1]
    )).rows[0];
    check(deleteAuditRow?.registro === "Parcela 1 — vencimento 31/03/2026 (com guia anexada e 4 envios por e-mail)", `auditoria da exclusão da parcela: ${deleteAuditRow?.registro}`);
    check(deleteAuditRow?.payload?.guia_anexada === true && deleteAuditRow.payload.guias_excluidas === 2 && deleteAuditRow.payload.envios_excluidos === 4, `payload da exclusão: ${JSON.stringify(deleteAuditRow?.payload)}`);
    check(filesOfA1.every((key) => !fs.existsSync(path.join(uploadDir, "tax-guides", key))), "PDF sai do disco junto com a parcela");
    check((await call(tA, "GET", guideUrl(inst.other))).json?.guia?.situacao === "vinculada", "duplicata da parcela excluída é liberada");
    const scannedKey = (await pool.query(`SELECT arquivo_chave FROM tax_installment_guides WHERE installment_id = $1`, [inst.a3])).rows[0]?.arquivo_chave;
    const agreementGuides = (await pool.query(
      `SELECT (SELECT count(*)::int FROM tax_installment_guides g JOIN tax_installments i ON i.id = g.installment_id WHERE i.agreement_id = $1) AS guides,
              (SELECT count(*)::int FROM tax_guide_sends s JOIN tax_installments i ON i.id = s.installment_id WHERE i.agreement_id = $1) AS sends`,
      [agreementA]
    )).rows[0];
    check(agreementGuides.guides > 1 && agreementGuides.sends > 1, `cenário da exclusão do parcelamento tem guias e envios: ${JSON.stringify(agreementGuides)}`);
    const deletedAgreement = await call(tA, "DELETE", `/api/entities/TaxAgreement/${agreementA}`);
    const agreementAudit = (await pool.query(
      `SELECT registro, payload FROM audit_events WHERE action = 'DELETE' AND resource_type = 'TaxAgreement' AND resource_id = $1`,
      [agreementA]
    )).rows[0];
    check(
      agreementAudit?.registro === `Parcelamento PARC-G1 — Receita Federal — Simplificado (com 4 parcelas, ${agreementGuides.guides} guias e ${agreementGuides.sends} envios por e-mail)`,
      `auditoria da exclusão do parcelamento: ${agreementAudit?.registro}`
    );
    check(
      agreementAudit?.payload?.parcelas_excluidas === 4 && agreementAudit.payload.guias_excluidas === agreementGuides.guides && agreementAudit.payload.envios_excluidos === agreementGuides.sends,
      `payload da exclusão do parcelamento: ${JSON.stringify(agreementAudit?.payload)}`
    );
    check(deletedAgreement.status === 200 && scannedKey && !fs.existsSync(path.join(uploadDir, "tax-guides", scannedKey)), "excluir parcelamento apaga os PDFs das guias");
  } finally {
    server.close();
    smtp.server.close();
    config.uploadDir = previousUploadDir;
    Object.assign(config, { smtpHost: previousSmtp.host, smtpPort: previousSmtp.port, smtpSecure: previousSmtp.secure, smtpUser: previousSmtp.user });
    fs.rmSync(uploadDir, { recursive: true, force: true });
    // Guia vinculada faz nascer o título de tributo (pendente, sem ERP neste teste): sai antes das parcelas.
    await settleTaxTitleSyncs();
    await pool.query(`DELETE FROM tax_payable_titles WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM tax_agreements WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM tenant_users WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(users).map((u) => u.id)]);
    await pool.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [tenantA, tenantB]);
    await pool.query(`DELETE FROM company_entities WHERE id IN ($1,$2)`, [entityA, entityB]);
    // A auditoria é só-inclusão: o grupo com eventos auditados não pode ser apagado e fica como resíduo de teste.
    await pool.query(`DELETE FROM groups WHERE id IN ($1,$2)`, [groupA, groupB]).catch(() => {});
  }

  if (failures.length) {
    console.error(`guias da gestão tributária: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log(`guias da gestão tributária ok (TZ=${process.env.TZ || "padrão"})`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
