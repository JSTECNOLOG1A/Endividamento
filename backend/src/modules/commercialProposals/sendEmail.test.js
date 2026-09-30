import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { MAX_PDF_BYTES } from "./service.js";

function fail(message) {
  throw new Error(message);
}

function jsonRequest(server, { method, path: requestPath, body, token, headers = {} }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body == null ? null : JSON.stringify(body);
    const reqHeaders = {
      host: `127.0.0.1:${address.port}`,
      ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    };
    const req = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: requestPath,
      method,
      headers: reqHeaders,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = text; }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Dublê do emails-api: guarda cada chamada e responde o status configurado.
function startFakeEmailsApi() {
  const state = { calls: [], respondWith: 202 };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      state.calls.push({ path: req.url, apiKey: req.headers["x-api-key"], body: text ? JSON.parse(text) : null });
      res.writeHead(state.respondWith, { "content-type": "application/json" });
      res.end(JSON.stringify(state.respondWith < 400 ? { data: { sent: true } } : { error: { code: "X", message: "recusado pelo dublê" } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, state }));
  });
}

// Serialização com chaves ordenadas: compara conteúdo, não ordem de inserção.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const PDF_BASE64 = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1").toString("base64");

function validBody(overrides = {}) {
  return {
    to: "cliente@empresa.com.br",
    mensagem: "Segue a proposta conversada.",
    pdfBase64: PDF_BASE64,
    nomeArquivo: "Proposta-Comercial-empresa-x.pdf",
    ...overrides,
  };
}

// Proposta encerrada precisa do desfecho completo (CHECK da migração 079).
const CLOSED_FIELDS = {
  aceita: "accepted_at = now(), data_assinatura = DATE '2026-09-01', nome_assinante = 'Assinante', canal_aceite = 'email'",
  recusada: "rejected_at = now(), motivo_recusa = 'Preço acima do orçamento'",
};

async function insertProposal({ status = "elaborando", clientName = "Empresa X Ltda", contactName = "Maria Souza", validityDays = "30", createdDate }) {
  const result = await pool.query(
    `INSERT INTO commercial_proposals (numero, status, client_name, contact_name, validity_days, tier, pricing_snapshot, created_date, created_by)
     VALUES ($1, 'elaborando', $2, $3, $4, 'STARTER', '{}'::jsonb, $5::timestamptz, 'teste')
     RETURNING id, numero`,
    [`PC-TESTE-${randomUUID().slice(0, 8)}`, clientName, contactName, validityDays, createdDate]
  );
  const row = result.rows[0];
  if (status !== "elaborando") {
    const extra = CLOSED_FIELDS[status] ? `, ${CLOSED_FIELDS[status]}` : "";
    await pool.query(`UPDATE commercial_proposals SET status = $2${extra} WHERE id = $1`, [row.id, status]);
  }
  return row;
}

// PDFs guardados de uma proposta, pelo tipo ("enviado"/"assinado").
function storedFiles(uploadDir, proposalId, kind) {
  const dir = path.join(uploadDir, "commercial-proposals", proposalId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.startsWith(`${kind}-`)).map((name) => path.join(dir, name));
}

async function proposalStatus(id) {
  const result = await pool.query("SELECT status FROM commercial_proposals WHERE id = $1", [id]);
  return result.rows[0]?.status;
}

async function sendsOf(id) {
  const result = await pool.query(
    "SELECT * FROM commercial_proposal_sends WHERE proposal_id = $1 ORDER BY created_date, id",
    [id]
  );
  return result.rows;
}

// Falha real do banco, restrita a uma proposta de teste: um gatilho que
// recusa a escrita. Exercita o código de produção, sem dublê do repositório.
async function withFailingWrite({ table, when }, fn) {
  const name = `cp_test_fail_${randomUUID().replace(/-/g, "")}`;
  await pool.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'falha simulada pelo teste'; END $$`
  );
  const timing = table === "commercial_proposals" ? "BEFORE UPDATE" : "BEFORE INSERT";
  await pool.query(`CREATE TRIGGER ${name} ${timing} ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${name}()`);
  try {
    return await fn();
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
    await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
  }
}

async function main() {
  const suffix = `${Date.now()}`;
  const masterId = randomUUID();
  const emailMaster = `cp-master-${suffix}@test.local`;
  const adminId = randomUUID();
  const emailAdmin = `cp-admin-${suffix}@test.local`;
  const hash = await bcrypt.hash("Endividamento!Test1", 4);
  const proposalIds = [];

  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, status, platform_admin, created_by)
     VALUES ($1,$2,$3,'Fulana Comercial','admin','active', true,'teste'),
            ($4,$5,$3,'Admin Comum','admin','active', false,'teste')`,
    [masterId, emailMaster, hash, adminId, emailAdmin]
  );

  const fake = await startFakeEmailsApi();
  const previousUploadDir = config.uploadDir;
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-send-"));
  config.uploadDir = uploadDir;
  const previousUrl = config.emailServiceUrl;
  const previousKey = config.emailServiceApiKey;
  config.emailServiceUrl = `http://127.0.0.1:${fake.server.address().port}`;
  config.emailServiceApiKey = "service:chave-de-teste";

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const token = issueAuthResponse(
    { id: masterId, email: emailMaster, full_name: "Fulana Comercial", role: "admin", platform_admin: true },
    null
  ).token;
  const send = (id, body, tokenOverride = token) => jsonRequest(server, {
    method: "POST", path: `/api/commercial-proposals/${id}/send-email`, body, token: tokenOverride,
  });

  try {
    // 23h30 de 12/09 em São Paulo = 02h30 de 13/09 em UTC. Validade de 30 dias
    // contada pelo dia de São Paulo termina em 12/10; contada em UTC, em 13/10.
    const proposal = await insertProposal({ createdDate: "2026-09-13T02:30:00Z" });
    proposalIds.push(proposal.id);

    // Quem não é admin da plataforma não envia.
    const adminToken = issueAuthResponse(
      { id: adminId, email: emailAdmin, full_name: "Admin Comum", role: "admin", platform_admin: false },
      null
    ).token;
    const forbidden = await send(proposal.id, validBody(), adminToken);
    if (forbidden.status !== 403) fail(`não-admin deveria receber 403, recebeu ${forbidden.status}`);

    // Validação: nada chega ao emails-api, nada é registrado, status intacto.
    const invalidCases = [
      ["e-mail inválido", validBody({ to: "nao-e-email" })],
      ["e-mail ausente", validBody({ to: undefined })],
      ["mensagem longa", validBody({ mensagem: "a".repeat(2001) })],
      ["base64 inválido", validBody({ pdfBase64: "isto não é base64!" })],
      ["base64 que não é PDF", validBody({ pdfBase64: Buffer.from("<html>oi</html>").toString("base64") })],
      ["PDF acima do teto", validBody({ pdfBase64: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(MAX_PDF_BYTES)]).toString("base64") })],
      ["nome sem .pdf", validBody({ nomeArquivo: "proposta.exe" })],
      ["nome com caminho", validBody({ nomeArquivo: "../../etc/proposta.pdf" })],
      ["nome com barra invertida", validBody({ nomeArquivo: "C:\\temp\\proposta.pdf" })],
      ["destinatário longo", validBody({ nomeDestinatario: "a".repeat(121) })],
      ["destinatário com quebra de linha", validBody({ nomeDestinatario: "João\nPereira" })],
      ["destinatário com retorno de carro", validBody({ nomeDestinatario: "João\rPereira" })],
      ["destinatário não textual", validBody({ nomeDestinatario: 42 })],
    ];
    for (const [label, body] of invalidCases) {
      const res = await send(proposal.id, body);
      if (res.status !== 400) fail(`${label}: esperado 400, recebido ${res.status} ${JSON.stringify(res.json)}`);
      if (res.json?.code !== "VALIDATION") fail(`${label}: code ${res.json?.code}`);
    }
    const longMessage = await send(proposal.id, validBody({ mensagem: "a".repeat(2001) }));
    if (longMessage.json?.error !== "A mensagem pode ter no máximo 2000 caracteres") {
      fail(`mensagem de validação inesperada: ${longMessage.json?.error}`);
    }
    if (fake.state.calls.length !== 0) fail(`validação chamou o emails-api ${fake.state.calls.length}x`);
    if ((await sendsOf(proposal.id)).length !== 0) fail("validação registrou envio");
    if ((await proposalStatus(proposal.id)) !== "elaborando") fail("validação alterou status");

    // Proposta inexistente (e id fora do formato) → 404, sem chamar o emails-api.
    const missing = await send(randomUUID(), validBody());
    if (missing.status !== 404) fail(`proposta inexistente: ${missing.status}`);
    const malformed = await send("nao-e-uuid", validBody());
    if (malformed.status !== 404) fail(`id fora do formato: ${malformed.status}`);
    if (fake.state.calls.length !== 0) fail("404 chamou o emails-api");

    // Falha terminal do emails-api (4xx): erro claro, uma tentativa só,
    // status intacto, falha registrada com o detalhe técnico.
    fake.state.respondWith = 422;
    const rejected = await send(proposal.id, validBody());
    if (rejected.status !== 502) fail(`falha do emails-api: esperado 502, recebido ${rejected.status}`);
    if (rejected.json?.error !== "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.") {
      fail(`mensagem de falha inesperada: ${rejected.json?.error}`);
    }
    if (rejected.json?.code !== "EMAIL_SEND_FAILED") fail(`code de falha: ${rejected.json?.code}`);
    if (fake.state.calls.length !== 1) fail(`4xx deveria ser terminal, houve ${fake.state.calls.length} chamadas`);
    if ((await proposalStatus(proposal.id)) !== "elaborando") fail("falha de envio alterou o status da proposta");
    let history = await sendsOf(proposal.id);
    if (history.length !== 1 || history[0].result !== "falhou") fail(`histórico após falha: ${JSON.stringify(history)}`);
    if (!String(history[0].error_detail || "").includes("422")) fail(`erro técnico não registrado: ${history[0].error_detail}`);
    // Tentativa que não saiu não deixa cópia: nada chegou ao cliente.
    if (history[0].file_key !== null) fail(`falha de envio registrou PDF: ${history[0].file_key}`);
    if (storedFiles(uploadDir, proposal.id, "enviado").length !== 0) fail("falha de envio deixou PDF no disco");
    if (fs.existsSync(path.join(uploadDir, "commercial-proposals", proposal.id))) fail("falha de envio deixou a pasta vazia da proposta no disco");

    // Falha transitória (5xx): retenta e, esgotado, também não muda nada.
    fake.state.calls = [];
    fake.state.respondWith = 503;
    const unavailable = await send(proposal.id, validBody());
    if (unavailable.status !== 502) fail(`5xx do emails-api: ${unavailable.status}`);
    if (fake.state.calls.length !== 2) fail(`5xx deveria retentar 2x, houve ${fake.state.calls.length}`);
    if ((await proposalStatus(proposal.id)) !== "elaborando") fail("5xx alterou o status");

    // emails-api não configurado: mesmo erro para o usuário, status intacto.
    fake.state.calls = [];
    config.emailServiceUrl = "";
    const unconfigured = await send(proposal.id, validBody());
    config.emailServiceUrl = `http://127.0.0.1:${fake.server.address().port}`;
    if (unconfigured.status !== 502) fail(`sem emails-api: ${unconfigured.status}`);
    if (fake.state.calls.length !== 0) fail("sem configuração não deveria chamar nada");
    if ((await proposalStatus(proposal.id)) !== "elaborando") fail("sem emails-api alterou o status");
    history = await sendsOf(proposal.id);
    if (history.length !== 3 || history.some((row) => row.result !== "falhou")) fail(`histórico de falhas: ${history.length}`);

    // Sucesso: contrato exato, status → enviada, envio registrado.
    fake.state.calls = [];
    fake.state.respondWith = 202;
    const ok = await send(proposal.id, validBody({ to: "  cliente@empresa.com.br  " }));
    if (ok.status !== 200) fail(`sucesso: ${ok.status} ${JSON.stringify(ok.json)}`);
    if (ok.json?.proposal?.status !== "enviada") fail(`status devolvido: ${ok.json?.proposal?.status}`);
    if (ok.json?.send?.result !== "enviado") fail(`registro devolvido: ${JSON.stringify(ok.json?.send)}`);
    if (ok.json?.warning !== null) fail(`sucesso limpo não deveria ter aviso: ${JSON.stringify(ok.json?.warning)}`);
    if ((await proposalStatus(proposal.id)) !== "enviada") fail("sucesso não marcou a proposta como enviada");
    if (fake.state.calls.length !== 1) fail(`sucesso: ${fake.state.calls.length} chamadas`);
    const call = fake.state.calls[0];
    if (call.path !== "/send/commercial-proposal") fail(`rota do emails-api: ${call.path}`);
    if (call.apiKey !== "service:chave-de-teste") fail("x-api-key não enviada");
    const expectedBody = {
      to: "cliente@empresa.com.br",
      nomeDestinatario: "Maria Souza",
      clienteNome: "Empresa X Ltda",
      numeroProposta: proposal.numero,
      remetenteNome: "Fulana Comercial",
      replyTo: emailMaster,
      mensagem: "Segue a proposta conversada.",
      validadeAte: "12 de outubro de 2026",
      anexo: { nomeArquivo: "Proposta-Comercial-empresa-x.pdf", conteudoBase64: PDF_BASE64 },
    };
    if (canonical(call.body) !== canonical(expectedBody)) {
      fail(`contrato divergente:\n esperado ${JSON.stringify(expectedBody)}\n recebido ${JSON.stringify(call.body)}`);
    }

    // O PDF que foi anexado fica guardado, byte a byte, ligado a este envio.
    const sentPdf = Buffer.from(PDF_BASE64, "base64");
    const sentFiles = storedFiles(uploadDir, proposal.id, "enviado");
    if (sentFiles.length !== 1) fail(`envio com sucesso deveria guardar 1 PDF, guardou ${sentFiles.length}`);
    if (!fs.readFileSync(sentFiles[0]).equals(sentPdf)) fail("PDF guardado difere do anexado");
    const sentRow = (await sendsOf(proposal.id)).find((row) => row.id === ok.json.send.id);
    if (!sentRow?.file_key || sentFiles[0] !== path.join(uploadDir, "commercial-proposals", sentRow.file_key)) {
      fail(`registro do envio não aponta para o PDF guardado: ${sentRow?.file_key}`);
    }
    if (sentRow.file_size !== sentPdf.length) fail(`tamanho registrado: ${sentRow.file_size}`);
    if (ok.json.send.has_file !== true || "file_key" in ok.json.send) fail(`resposta do envio: ${JSON.stringify(ok.json.send)}`);
    if ("arquivo_assinado_chave" in ok.json.proposal || ok.json.proposal.tem_arquivo_assinado !== false) {
      fail(`proposta devolvida expõe caminho interno ou omite tem_arquivo_assinado: ${JSON.stringify(ok.json.proposal)}`);
    }

    // Download do PDF enviado, por envio: só com o header Authorization;
    // ?token= na URL NÃO autentica.
    const sentFilePath = `/api/commercial-proposals/${proposal.id}/sends/${ok.json.send.id}/file`;
    const sentDownload = await jsonRequest(server, { method: "GET", path: sentFilePath, token });
    if (sentDownload.status !== 200 || !sentDownload.raw.equals(sentPdf)) fail(`download do PDF enviado: ${sentDownload.status}`);
    if (sentDownload.headers["content-type"] !== "application/pdf") fail(`content-type: ${sentDownload.headers["content-type"]}`);
    if (!String(sentDownload.headers["content-disposition"]).startsWith("inline;")) fail(`disposition: ${sentDownload.headers["content-disposition"]}`);
    const sentAttachment = await jsonRequest(server, { method: "GET", path: `${sentFilePath}?download=1`, token });
    if (sentAttachment.status !== 200 || !String(sentAttachment.headers["content-disposition"]).startsWith("attachment;")) fail("?download=1 deveria baixar");
    const sentByQuery = await jsonRequest(server, { method: "GET", path: `${sentFilePath}?token=${encodeURIComponent(token)}` });
    if (sentByQuery.status !== 401 || sentByQuery.raw.equals(sentPdf)) fail(`?token= autenticou o download do PDF enviado: ${sentByQuery.status}`);
    const sentNoAuth = await jsonRequest(server, { method: "GET", path: sentFilePath });
    if (sentNoAuth.status !== 401) fail(`download sem token: ${sentNoAuth.status}`);
    const sentForbidden = await jsonRequest(server, { method: "GET", path: sentFilePath, token: adminToken });
    if (sentForbidden.status !== 403) fail(`download por não-admin da plataforma: ${sentForbidden.status}`);
    const failedSendId = history[0].id;
    const failedDownload = await jsonRequest(server, { method: "GET", path: `/api/commercial-proposals/${proposal.id}/sends/${failedSendId}/file`, token });
    if (failedDownload.status !== 404) fail(`download de envio que falhou: ${failedDownload.status}`);

    // Registro de cada tentativa, no banco: 3 falhas e o envio feito.
    const recorded = (await sendsOf(proposal.id)).reverse();
    if (recorded.length !== 4) fail(`envios registrados: ${recorded.length}`);
    const latest = recorded[0];
    if (latest.result !== "enviado" || latest.recipient_email !== "cliente@empresa.com.br"
      || latest.sent_by_name !== "Fulana Comercial" || latest.sent_by_email !== emailMaster
      || latest.file_name !== "Proposta-Comercial-empresa-x.pdf" || latest.message !== "Segue a proposta conversada."
      || latest.recipient_name !== "Maria Souza") {
      fail(`registro do envio feito: ${JSON.stringify(latest)}`);
    }
    if (latest.file_size !== sentPdf.length || !latest.file_key) fail(`registro sem o PDF guardado: ${JSON.stringify(latest)}`);
    if (recorded.slice(1).some((row) => row.file_key !== null || row.file_size !== null)) fail("tentativas que falharam registraram PDF");
    if (ok.json.send.file_size !== sentPdf.length) fail(`resposta do envio sem o tamanho do PDF: ${JSON.stringify(ok.json.send)}`);

    // O que a tela vê é a linha do tempo: um evento por tentativa, ligado ao
    // envio, dizendo se há PDF para baixar — sem PDF nem caminho no disco.
    const timeline = await jsonRequest(server, { method: "GET", path: `/api/commercial-proposals/${proposal.id}/history`, token });
    if (timeline.status !== 200 || !Array.isArray(timeline.json)) fail(`GET history: ${timeline.status}`);
    const sendEvents = timeline.json.filter((row) => row.send_id);
    if (sendEvents.length !== 4) fail(`eventos de envio na linha do tempo: ${sendEvents.length}`);
    const [latestEvent, ...failedEvents] = sendEvents;
    if (latestEvent.event_type !== "email_enviado" || latestEvent.send_id !== ok.json.send.id || latestEvent.send_has_file !== true
      || latestEvent.note !== "cliente@empresa.com.br") {
      fail(`evento do envio feito: ${JSON.stringify(latestEvent)}`);
    }
    if (failedEvents.some((row) => row.event_type !== "email_falhou" || row.send_has_file !== false)) {
      fail(`eventos das tentativas que falharam: ${JSON.stringify(failedEvents)}`);
    }
    for (const row of timeline.json) {
      if (["pdfBase64", "conteudoBase64", "file_key", "file_size"].some((key) => key in row)) {
        fail(`linha do tempo não pode carregar o PDF nem o caminho dele: ${JSON.stringify(row)}`);
      }
    }
    // A listagem de envios foi aposentada: a linha do tempo a substitui.
    const retired = await jsonRequest(server, { method: "GET", path: `/api/commercial-proposals/${proposal.id}/sends`, token });
    if (retired.status !== 404 || retired.json?.code !== "NOT_FOUND") fail(`GET /:id/sends deveria não existir: ${retired.status}`);

    // Reenvio para outro destinatário: nova linha, status continua enviada, e a
    // saudação é de quem recebe — não do contato da proposta ("Maria Souza").
    // Chave presente com valor: usa o valor, com as pontas aparadas.
    const resend = await send(proposal.id, validBody({ to: "outro@empresa.com.br", mensagem: "", nomeDestinatario: "  João Pereira  " }));
    if (resend.status !== 200) fail(`reenvio: ${resend.status}`);
    let resendHistory = await sendsOf(proposal.id);
    if (resendHistory.length !== 5) fail("reenvio não gerou nova linha");
    if ("mensagem" in fake.state.calls[1].body) fail("mensagem vazia não deveria ir ao emails-api");
    if (fake.state.calls[1].body.nomeDestinatario !== "João Pereira") {
      fail(`reenvio saudou outra pessoa: ${fake.state.calls[1].body.nomeDestinatario}`);
    }
    if (resendHistory[4].recipient_name !== "João Pereira") fail(`histórico com nome errado: ${resendHistory[4].recipient_name}`);

    // Chave presente e vazia (ou só espaços, ou null): vai sem nome — nunca cai
    // no contato da proposta.
    for (const [emptyName, index] of [["", 2], ["   ", 3], [null, 4]]) {
      const res = await send(proposal.id, validBody({ to: "terceiro@empresa.com.br", nomeDestinatario: emptyName }));
      if (res.status !== 200) fail(`destinatário vazio (${JSON.stringify(emptyName)}): ${res.status} ${JSON.stringify(res.json)}`);
      if ("nomeDestinatario" in fake.state.calls[index].body) {
        fail(`destinatário vazio (${JSON.stringify(emptyName)}) enviou nome: ${fake.state.calls[index].body.nomeDestinatario}`);
      }
      resendHistory = await sendsOf(proposal.id);
      if (resendHistory[resendHistory.length - 1].recipient_name !== null) {
        fail(`histórico deveria registrar envio sem nome: ${resendHistory[resendHistory.length - 1].recipient_name}`);
      }
    }

    // Opcionais vazios não vão no corpo (sem contato, sem mensagem).
    // Validade vazia NÃO é omitida: o PDF imprime 15 dias nesse caso
    // (Original: src/pages/CommercialProposal.jsx:463, 731, 801), e o e-mail
    // tem de anunciar a mesma data. 01/09 + 15 dias = 16/09.
    for (const emptyValidity of [null, ""]) {
      const bare = await insertProposal({ contactName: null, validityDays: emptyValidity, createdDate: "2026-09-01T12:00:00Z" });
      proposalIds.push(bare.id);
      fake.state.calls = [];
      const bareSend = await send(bare.id, validBody({ mensagem: undefined }));
      if (bareSend.status !== 200) fail(`proposta sem opcionais: ${bareSend.status}`);
      const bareBody = fake.state.calls[0].body;
      for (const key of ["nomeDestinatario", "mensagem"]) {
        if (key in bareBody) fail(`opcional vazio enviado: ${key}`);
      }
      if (bareBody.validadeAte !== "16 de setembro de 2026") {
        fail(`validade vazia (${JSON.stringify(emptyValidity)}) deveria seguir os 15 dias do PDF: ${bareBody.validadeAte}`);
      }
    }

    // Sem nome do cliente o emails-api recusaria: avisa antes de tentar.
    const noClient = await insertProposal({ clientName: null, createdDate: "2026-09-01T12:00:00Z" });
    proposalIds.push(noClient.id);
    fake.state.calls = [];
    const noClientSend = await send(noClient.id, validBody());
    if (noClientSend.status !== 422) fail(`proposta sem cliente: ${noClientSend.status}`);
    if (fake.state.calls.length !== 0) fail("proposta sem cliente chamou o emails-api");

    // Proposta aceita ou recusada não sai mais por e-mail: nada chega ao
    // emails-api, nada é registrado, nenhum PDF é guardado.
    for (const [status, message] of [
      ["aceita", "Esta proposta já foi aceita pelo cliente e não pode mais ser enviada por e-mail."],
      ["recusada", "Esta proposta foi recusada pelo cliente e não pode mais ser enviada por e-mail."],
    ]) {
      const closed = await insertProposal({ status, createdDate: "2026-09-01T12:00:00Z" });
      proposalIds.push(closed.id);
      fake.state.calls = [];
      const res = await send(closed.id, validBody());
      if (res.status !== 409 || res.json?.code !== "PROPOSAL_CLOSED") fail(`envio de proposta ${status}: ${res.status} ${JSON.stringify(res.json)}`);
      if (res.json?.error !== message) fail(`mensagem para proposta ${status}: ${res.json?.error}`);
      if (fake.state.calls.length !== 0) fail(`proposta ${status} chamou o emails-api`);
      if ((await sendsOf(closed.id)).length !== 0) fail(`proposta ${status} registrou envio`);
      if (storedFiles(uploadDir, closed.id, "enviado").length !== 0) fail(`proposta ${status} guardou PDF`);
      if ((await proposalStatus(closed.id)) !== status) fail(`envio mudou a proposta ${status}`);
    }

    // Sem onde guardar o PDF, o e-mail não sai: enviar sem a cópia deixaria o
    // histórico sem prova do que foi anexado.
    const noStorage = await insertProposal({ createdDate: "2026-09-01T12:00:00Z" });
    proposalIds.push(noStorage.id);
    const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-send-broken-"));
    fs.writeFileSync(path.join(brokenDir, "commercial-proposals"), "não é pasta");
    config.uploadDir = brokenDir;
    fake.state.calls = [];
    const noStorageRes = await send(noStorage.id, validBody());
    config.uploadDir = uploadDir;
    fs.rmSync(brokenDir, { recursive: true, force: true });
    if (noStorageRes.status !== 500 || noStorageRes.json?.code !== "PDF_NOT_STORED") {
      fail(`sem onde guardar o PDF: ${noStorageRes.status} ${JSON.stringify(noStorageRes.json)}`);
    }
    if (noStorageRes.json?.error !== "Não foi possível guardar o PDF da proposta, e por isso o e-mail não foi enviado. Tente novamente em alguns minutos.") {
      fail(`mensagem sem onde guardar: ${noStorageRes.json?.error}`);
    }
    if (fake.state.calls.length !== 0) fail("sem onde guardar o PDF, o e-mail saiu mesmo assim");
    if ((await proposalStatus(noStorage.id)) !== "elaborando") fail("sem onde guardar o PDF, o status mudou");

    // E-mail entregue, mas o status não grava: a prova de entrega fica no
    // histórico e a resposta é sucesso com aviso — nunca erro, que levaria a
    // pessoa a reenviar.
    const statusFails = await insertProposal({ createdDate: "2026-09-01T12:00:00Z" });
    proposalIds.push(statusFails.id);
    const statusFailRes = await withFailingWrite(
      { table: "commercial_proposals", when: `OLD.id = '${statusFails.id}'` },
      () => send(statusFails.id, validBody())
    );
    if (statusFailRes.status !== 200) fail(`status que não grava: esperado 200, recebido ${statusFailRes.status} ${JSON.stringify(statusFailRes.json)}`);
    if (statusFailRes.json?.warning?.code !== "STATUS_NOT_UPDATED") fail(`aviso ausente: ${JSON.stringify(statusFailRes.json?.warning)}`);
    if (statusFailRes.json?.warning?.message !== "O e-mail foi enviado e registrado, mas a situação da proposta não foi atualizada. Atualize a página para conferir.") {
      fail(`texto do aviso: ${statusFailRes.json?.warning?.message}`);
    }
    if (statusFailRes.json?.send?.result !== "enviado") fail("resposta sem o registro do envio");
    if (statusFailRes.json?.proposal?.status !== "elaborando") fail("resposta afirma status que não foi gravado");
    if ((await proposalStatus(statusFails.id)) !== "elaborando") fail("status mudou apesar da falha simulada");
    const statusFailHistory = await sendsOf(statusFails.id);
    if (statusFailHistory.length !== 1 || statusFailHistory[0].result !== "enviado") {
      fail(`falha no status apagou a prova de entrega: ${JSON.stringify(statusFailHistory)}`);
    }

    // E-mail entregue, mas o histórico não grava: erro próprio, que diz para
    // NÃO reenviar; o status ainda acompanha o envio real.
    const historyFails = await insertProposal({ createdDate: "2026-09-01T12:00:00Z" });
    proposalIds.push(historyFails.id);
    const historyFailRes = await withFailingWrite(
      { table: "commercial_proposal_sends", when: `NEW.proposal_id = '${historyFails.id}' AND NEW.result = 'enviado'` },
      () => send(historyFails.id, validBody())
    );
    if (historyFailRes.status !== 500 || historyFailRes.json?.code !== "EMAIL_SENT_NOT_RECORDED") {
      fail(`histórico que não grava: ${historyFailRes.status} ${JSON.stringify(historyFailRes.json)}`);
    }
    if (historyFailRes.json?.error !== "O e-mail foi enviado, mas não conseguimos registrar o envio no histórico. Não é preciso reenviar.") {
      fail(`mensagem de histórico não gravado: ${historyFailRes.json?.error}`);
    }
    if ((await proposalStatus(historyFails.id)) !== "enviada") fail("status não acompanhou o e-mail entregue");
    if ((await sendsOf(historyFails.id)).length !== 0) fail("histórico gravou apesar da falha simulada");
    // O PDF guardado fica: é a única cópia do que foi entregue.
    if (storedFiles(uploadDir, historyFails.id, "enviado").length !== 1) fail("histórico não gravado apagou a cópia do PDF entregue");

    // Excluir a proposta não apaga o histórico de envio em silêncio.
    let deleteError = null;
    try {
      await pool.query("DELETE FROM commercial_proposals WHERE id = $1", [proposal.id]);
    } catch (error) {
      deleteError = error;
    }
    if (deleteError?.code !== "23503") fail(`exclusão de proposta com histórico deveria ser recusada: ${deleteError?.code || "aceita"}`);
    if ((await sendsOf(proposal.id)).length === 0) fail("exclusão apagou o histórico de envio");

    console.log("commercialProposals sendEmail ok: validação, 404, falha sem mudar status, sucesso, PDF guardado e baixado, histórico, reenvio, bloqueio após desfecho, falha ao guardar, falha pós-envio, exclusão");
  } finally {
    server.close();
    fake.server.close();
    config.emailServiceUrl = previousUrl;
    config.emailServiceApiKey = previousKey;
    config.uploadDir = previousUploadDir;
    fs.rmSync(uploadDir, { recursive: true, force: true });
    try {
      // Linha do tempo e histórico primeiro: as FKs são RESTRICT de propósito.
      await pool.query("DELETE FROM commercial_proposal_history WHERE proposal_id = ANY($1::uuid[])", [proposalIds]);
      await pool.query("DELETE FROM commercial_proposal_sends WHERE proposal_id = ANY($1::uuid[])", [proposalIds]);
      await pool.query("DELETE FROM commercial_proposals WHERE id = ANY($1::uuid[])", [proposalIds]);
      await pool.query(
        `UPDATE users SET status = 'disabled', email = email || '.retired.' || id::text
         WHERE id = ANY($1::uuid[])`,
        [[masterId, adminId]]
      );
    } catch (cleanupError) {
      console.warn("cleanup:", cleanupError.message);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
