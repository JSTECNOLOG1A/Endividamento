import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { MAX_SIGNED_FILE_BYTES } from "./service.js";
import { removeProposalFile, saveProposalFile } from "./storage.js";

function fail(message) {
  throw new Error(message);
}

const SIGNED_PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Assinado (sim) >>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
// PNG com nome e tipo de PDF: só a assinatura do conteúdo denuncia.
const PNG_AS_PDF = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const SAO_PAULO_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo",
});
function saoPauloDay(offsetDays = 0) {
  return SAO_PAULO_DAY.format(new Date(Date.now() + offsetDays * 86_400_000));
}

async function insertProposal(status = "elaborando") {
  const result = await pool.query(
    `INSERT INTO commercial_proposals (numero, status, client_name, contact_name, validity_days, tier, pricing_snapshot, created_date, created_by)
     VALUES ($1, $2, 'Empresa Y Ltda', 'Carlos Lima', '15', 'STARTER', '{}'::jsonb, now() - interval '60 days', 'teste')
     RETURNING id, numero`,
    [`PC-DESFECHO-${randomUUID().slice(0, 8)}`, status]
  );
  return result.rows[0];
}

async function rowOf(id) {
  const result = await pool.query("SELECT * FROM commercial_proposals WHERE id = $1", [id]);
  return result.rows[0];
}

function signedFilesOf(uploadDir, proposalId) {
  const dir = path.join(uploadDir, "commercial-proposals", proposalId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.startsWith("assinado-")).map((name) => path.join(dir, name));
}

function acceptFields(overrides = {}) {
  return {
    data_assinatura: saoPauloDay(-2),
    nome_assinante: "Ana Paula Rocha",
    cargo_assinante: "Diretora Financeira",
    canal_aceite: "whatsapp",
    observacao_aceite: "Cliente devolveu assinado pelo WhatsApp.",
    ...overrides,
  };
}

function multipart(fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, value);
  }
  if (file) form.append(file.field || "file", new Blob([file.buffer], { type: file.type || "application/pdf" }), file.name || "proposta-assinada.pdf");
  return form;
}

// Segura a linha da proposta numa transação aberta que a leva a `status`, até
// a requisição ficar esperando o lock; aí confirma. A requisição leu a
// proposta ainda aberta (a transação não estava confirmada) e só a troca
// atômica, com a condição de origem no UPDATE, pode recusá-la.
async function raceAgainstCommittedClose(proposalId, status, fire) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const extra = status === "aceita"
      ? "accepted_at = now(), data_assinatura = DATE '2026-09-01', nome_assinante = 'Concorrente', canal_aceite = 'email'"
      : "rejected_at = now(), motivo_recusa = 'Concorrente'";
    await client.query(`UPDATE commercial_proposals SET status = $2, ${extra} WHERE id = $1`, [proposalId, status]);
    const pending = fire();
    const deadline = Date.now() + 10_000;
    for (;;) {
      const waiting = await pool.query(
        `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE NOT l.granted AND a.datname = current_database()`
      );
      if (waiting.rows[0].n > 0) break;
      if (Date.now() > deadline) fail("a requisição nunca chegou a esperar o lock da proposta");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await client.query("COMMIT");
    return await pending;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const suffix = `${Date.now()}`;
  const masterId = randomUUID();
  const emailMaster = `cp-desfecho-master-${suffix}@test.local`;
  const adminId = randomUUID();
  const emailAdmin = `cp-desfecho-admin-${suffix}@test.local`;
  const hash = await bcrypt.hash("Endividamento!Test1", 4);
  const proposalIds = [];
  let supportSessionId = null;

  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, status, platform_admin, created_by)
     VALUES ($1,$2,$3,'Beatriz Comercial','admin','active', true,'teste'),
            ($4,$5,$3,'Admin Comum','admin','active', false,'teste')`,
    [masterId, emailMaster, hash, adminId, emailAdmin]
  );

  const previousUploadDir = config.uploadDir;
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-desfecho-"));
  config.uploadDir = uploadDir;

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/commercial-proposals`;
  const token = issueAuthResponse(
    { id: masterId, email: emailMaster, full_name: "Beatriz Comercial", role: "admin", platform_admin: true },
    null
  ).token;
  const adminToken = issueAuthResponse(
    { id: adminId, email: emailAdmin, full_name: "Admin Comum", role: "admin", platform_admin: false },
    null
  ).token;

  async function call(method, pathname, { body, form, auth = token, extraHeaders = {} } = {}) {
    const headers = { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...extraHeaders };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${pathname}`, { method, headers, body: payload });
    const raw = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = raw.length ? JSON.parse(raw.toString("utf8")) : null; } catch { json = null; }
    return { status: res.status, json, raw, headers: res.headers };
  }
  const accept = (id, opts) => call("POST", `/${id}/accept`, opts);
  const reject = (id, opts) => call("POST", `/${id}/reject`, opts);

  try {
    // --- Aceite sem arquivo (JSON), a partir de "elaborando", proposta vencida
    // (criada há 60 dias com validade de 15): vencimento não bloqueia.
    const plain = await insertProposal("elaborando");
    proposalIds.push(plain.id);
    const today = saoPauloDay(0);
    const plainRes = await accept(plain.id, { body: acceptFields({ data_assinatura: today, cargo_assinante: "", observacao_aceite: "   ", canal_aceite: "em_maos" }) });
    if (plainRes.status !== 200) fail(`aceite sem arquivo: ${plainRes.status} ${JSON.stringify(plainRes.json)}`);
    const plainBody = plainRes.json;
    if (plainBody.status !== "aceita") fail(`status devolvido: ${plainBody.status}`);
    if (plainBody.data_assinatura !== today) fail(`data de assinatura devolvida: ${plainBody.data_assinatura} (esperado ${today})`);
    if (plainBody.nome_assinante !== "Ana Paula Rocha" || plainBody.cargo_assinante !== null || plainBody.observacao_aceite !== null) {
      fail(`dados do aceite: ${JSON.stringify(plainBody)}`);
    }
    if (plainBody.canal_aceite !== "em_maos") fail(`canal: ${plainBody.canal_aceite}`);
    if (plainBody.accepted_by_email !== emailMaster || plainBody.accepted_by_name !== "Beatriz Comercial") {
      fail(`quem registrou: ${plainBody.accepted_by_email} / ${plainBody.accepted_by_name}`);
    }
    if (!plainBody.accepted_at || Math.abs(Date.now() - new Date(plainBody.accepted_at).getTime()) > 60_000) {
      fail(`quando registrou: ${plainBody.accepted_at}`);
    }
    if (plainBody.tem_arquivo_assinado !== false || "arquivo_assinado_chave" in plainBody) fail("aceite sem arquivo: tem_arquivo_assinado/caminho interno");
    if (signedFilesOf(uploadDir, plain.id).length !== 0) fail("aceite sem arquivo gravou arquivo");
    const plainGet = await call("GET", `/${plain.id}`);
    if (plainGet.json?.status !== "aceita" || plainGet.json?.data_assinatura !== today || plainGet.json?.tem_arquivo_assinado !== false
      || "arquivo_assinado_chave" in plainGet.json) {
      fail(`GET após aceite: ${JSON.stringify(plainGet.json)}`);
    }
    const noSignedFile = await call("GET", `/${plain.id}/signed-file`);
    if (noSignedFile.status !== 404 || noSignedFile.json?.error !== "Esta proposta não tem arquivo assinado") {
      fail(`download sem arquivo assinado: ${noSignedFile.status} ${JSON.stringify(noSignedFile.json)}`);
    }

    // Auditoria da transição, fora da auditoria de qualquer cliente.
    const audit = await pool.query(
      "SELECT action, rotina, registro, group_id, before_json, after_json, actor_email FROM audit_events WHERE resource_type = 'CommercialProposal' AND resource_id = $1",
      [plain.id]
    );
    const auditRow = audit.rows[0];
    if (audit.rows.length !== 1 || auditRow.action !== "COMMERCIAL_PROPOSAL_ACCEPTED" || auditRow.group_id !== null
      || auditRow.actor_email !== emailMaster || auditRow.before_json?.status !== "elaborando" || auditRow.after_json?.status !== "aceita"
      || auditRow.registro !== `${plain.numero} — Empresa Y Ltda`) {
      fail(`auditoria do aceite: ${JSON.stringify(audit.rows)}`);
    }

    // --- Aceite com arquivo (multipart), a partir de "enviada".
    const withFile = await insertProposal("enviada");
    proposalIds.push(withFile.id);
    const withFileRes = await accept(withFile.id, {
      form: multipart(acceptFields(), { buffer: SIGNED_PDF, name: "Proposta assinada — Empresa Y.pdf" }),
    });
    if (withFileRes.status !== 200) fail(`aceite com arquivo: ${withFileRes.status} ${JSON.stringify(withFileRes.json)}`);
    if (withFileRes.json.tem_arquivo_assinado !== true || withFileRes.json.arquivo_assinado_nome !== "Proposta assinada — Empresa Y.pdf"
      || withFileRes.json.arquivo_assinado_tamanho !== SIGNED_PDF.length || withFileRes.json.cargo_assinante !== "Diretora Financeira"
      || withFileRes.json.observacao_aceite !== "Cliente devolveu assinado pelo WhatsApp." || withFileRes.json.canal_aceite !== "whatsapp") {
      fail(`aceite com arquivo, resposta: ${JSON.stringify(withFileRes.json)}`);
    }
    const files = signedFilesOf(uploadDir, withFile.id);
    if (files.length !== 1 || !fs.readFileSync(files[0]).equals(SIGNED_PDF)) fail(`arquivo assinado no disco: ${files.length}`);
    const withFileRow = await rowOf(withFile.id);
    if (path.join(uploadDir, "commercial-proposals", withFileRow.arquivo_assinado_chave) !== files[0]) fail("linha não aponta para o arquivo gravado");

    const listed = await call("GET", "/?q=PC-DESFECHO");
    const listedRow = listed.json?.find((row) => row.id === withFile.id);
    if (!listedRow || listedRow.tem_arquivo_assinado !== true || listedRow.status !== "aceita" || "arquivo_assinado_chave" in listedRow) {
      fail(`listagem sem os campos do aceite: ${JSON.stringify(listedRow)}`);
    }

    // Download do assinado: só com o header Authorization. Token na URL
    // (?token=) NÃO autentica — ficaria em log e no histórico do navegador.
    const signedPath = `/${withFile.id}/signed-file`;
    const byHeader = await call("GET", signedPath);
    if (byHeader.status !== 200 || !byHeader.raw.equals(SIGNED_PDF)) fail(`download do assinado: ${byHeader.status}`);
    if (byHeader.headers.get("content-type") !== "application/pdf") fail(`content-type: ${byHeader.headers.get("content-type")}`);
    const disposition = byHeader.headers.get("content-disposition") || "";
    if (!disposition.startsWith("inline;") || !disposition.includes(`filename*=UTF-8''${encodeURIComponent("Proposta assinada — Empresa Y.pdf")}`)) {
      fail(`content-disposition: ${disposition}`);
    }
    const asAttachment = await call("GET", `${signedPath}?download=1`);
    if (asAttachment.status !== 200 || !(asAttachment.headers.get("content-disposition") || "").startsWith("attachment;")) {
      fail("?download=1 deveria baixar");
    }
    const byQuery = await call("GET", `${signedPath}?token=${encodeURIComponent(token)}`, { auth: null });
    if (byQuery.status !== 401 || byQuery.raw.equals(SIGNED_PDF)) fail(`?token= autenticou o download do assinado: ${byQuery.status}`);
    const noAuth = await call("GET", signedPath, { auth: null });
    if (noAuth.status !== 401) fail(`download sem token: ${noAuth.status}`);
    const forbidden = await call("GET", signedPath, { auth: adminToken });
    if (forbidden.status !== 403) fail(`download por não-admin da plataforma: ${forbidden.status}`);

    // Não-admin da plataforma não registra aceite.
    const acceptForbidden = await insertProposal("enviada");
    proposalIds.push(acceptForbidden.id);
    const forbiddenAccept = await accept(acceptForbidden.id, { body: acceptFields(), auth: adminToken });
    if (forbiddenAccept.status !== 403 || (await rowOf(acceptForbidden.id)).status !== "enviada") fail(`aceite por não-admin: ${forbiddenAccept.status}`);

    // --- Validação do aceite: nada muda, nada fica no disco.
    const target = await insertProposal("enviada");
    proposalIds.push(target.id);
    const invalidAccepts = [
      ["sem data", acceptFields({ data_assinatura: undefined }), "Informe a data em que o cliente assinou"],
      ["data vazia", acceptFields({ data_assinatura: "" }), "Informe a data em que o cliente assinou"],
      ["data futura (amanhã em São Paulo)", acceptFields({ data_assinatura: saoPauloDay(1) }), "A data de assinatura não pode ser uma data futura"],
      ["data inexistente", acceptFields({ data_assinatura: "2026-02-30" }), "Data de assinatura inválida"],
      ["data fora do formato", acceptFields({ data_assinatura: "29/09/2026" }), "Data de assinatura inválida"],
      ["sem nome", acceptFields({ nome_assinante: undefined }), "Informe o nome de quem assinou pelo cliente"],
      ["nome só com espaços", acceptFields({ nome_assinante: "   " }), "Informe o nome de quem assinou pelo cliente"],
      ["sem canal", acceptFields({ canal_aceite: undefined }), "Informe por onde o cliente devolveu a proposta: e-mail, WhatsApp ou em mãos"],
      ["canal desconhecido", acceptFields({ canal_aceite: "telefone" }), "Informe por onde o cliente devolveu a proposta: e-mail, WhatsApp ou em mãos"],
      ["observação longa", acceptFields({ observacao_aceite: "a".repeat(2001) }), "A observação pode ter no máximo 2000 caracteres"],
    ];
    for (const [label, fields, message] of invalidAccepts) {
      const res = await accept(target.id, { form: multipart(fields, { buffer: SIGNED_PDF }) });
      if (res.status !== 400 || res.json?.code !== "VALIDATION" || res.json?.error !== message) {
        fail(`${label}: ${res.status} ${JSON.stringify(res.json)}`);
      }
    }
    const notPdf = await accept(target.id, { form: multipart(acceptFields(), { buffer: PNG_AS_PDF, name: "assinada.pdf", type: "application/pdf" }) });
    if (notPdf.status !== 400 || notPdf.json?.code !== "INVALID_FILE" || notPdf.json?.error !== "O arquivo assinado precisa ser um PDF") {
      fail(`arquivo que não é PDF: ${notPdf.status} ${JSON.stringify(notPdf.json)}`);
    }
    const emptyFile = await accept(target.id, { form: multipart(acceptFields(), { buffer: Buffer.alloc(0) }) });
    if (emptyFile.status !== 400 || emptyFile.json?.error !== "O arquivo assinado está vazio") fail(`arquivo vazio: ${emptyFile.status} ${JSON.stringify(emptyFile.json)}`);
    const tooBig = await accept(target.id, {
      form: multipart(acceptFields(), { buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(MAX_SIGNED_FILE_BYTES)]) }),
    });
    if (tooBig.status !== 413 || tooBig.json?.error !== "O arquivo assinado passa do tamanho máximo de 20 MB."
      || tooBig.json?.details?.max_bytes !== MAX_SIGNED_FILE_BYTES) {
      fail(`arquivo acima do teto: ${tooBig.status} ${JSON.stringify(tooBig.json)}`);
    }
    const wrongField = await accept(target.id, { form: multipart(acceptFields(), { buffer: SIGNED_PDF, field: "arquivo" }) });
    if (wrongField.status !== 400) fail(`arquivo em campo inesperado: ${wrongField.status}`);
    const targetRow = await rowOf(target.id);
    if (targetRow.status !== "enviada" || targetRow.accepted_at !== null) fail("aceite inválido alterou a proposta");
    if (signedFilesOf(uploadDir, target.id).length !== 0) fail("aceite inválido deixou arquivo no disco");

    // Proposta inexistente / id fora do formato.
    if ((await accept(randomUUID(), { body: acceptFields() })).status !== 404) fail("aceite de proposta inexistente");
    if ((await accept("nao-e-uuid", { body: acceptFields() })).status !== 404) fail("aceite com id fora do formato");
    if ((await reject(randomUUID(), { body: { motivo_recusa: "x" } })).status !== 404) fail("recusa de proposta inexistente");

    // --- Recusa.
    const refused = await insertProposal("enviada");
    proposalIds.push(refused.id);
    for (const [label, body] of [["sem motivo", {}], ["motivo vazio", { motivo_recusa: "  " }], ["motivo longo", { motivo_recusa: "a".repeat(2001) }]]) {
      const res = await reject(refused.id, { body });
      if (res.status !== 400 || res.json?.code !== "VALIDATION") fail(`recusa ${label}: ${res.status}`);
    }
    if ((await rowOf(refused.id)).status !== "enviada") fail("recusa inválida alterou a proposta");
    const refusedRes = await reject(refused.id, { body: { motivo_recusa: "  Optou por outro fornecedor.  " } });
    if (refusedRes.status !== 200 || refusedRes.json?.status !== "recusada") fail(`recusa: ${refusedRes.status} ${JSON.stringify(refusedRes.json)}`);
    if (refusedRes.json.motivo_recusa !== "Optou por outro fornecedor." || refusedRes.json.rejected_by_email !== emailMaster
      || refusedRes.json.rejected_by_name !== "Beatriz Comercial" || !refusedRes.json.rejected_at || refusedRes.json.accepted_at !== null) {
      fail(`dados da recusa: ${JSON.stringify(refusedRes.json)}`);
    }
    const refusedAudit = await pool.query(
      "SELECT action, group_id FROM audit_events WHERE resource_type = 'CommercialProposal' AND resource_id = $1",
      [refused.id]
    );
    if (refusedAudit.rows.length !== 1 || refusedAudit.rows[0].action !== "COMMERCIAL_PROPOSAL_REJECTED" || refusedAudit.rows[0].group_id !== null) {
      fail(`auditoria da recusa: ${JSON.stringify(refusedAudit.rows)}`);
    }
    // Em sessão de suporte aberta num cliente, o desfecho continua fora da
    // auditoria desse cliente: proposta comercial é dado da plataforma.
    const demoTenant = await pool.query("SELECT id, group_id FROM tenants WHERE id = 'tnt_demo'");
    if (!demoTenant.rows[0]) fail("É preciso o tenant de demonstração (seed) para o teste de sessão de suporte");
    const support = await pool.query(
      `INSERT INTO support_sessions (master_user_id, tenant_id, group_id, reason, duration_minutes, expires_at)
       VALUES ($1, $2, $3, 'teste de proposta comercial', 15, now() + interval '15 minutes')
       RETURNING id`,
      [masterId, demoTenant.rows[0].id, demoTenant.rows[0].group_id]
    );
    supportSessionId = support.rows[0].id;
    const duringSupport = await insertProposal("enviada");
    proposalIds.push(duringSupport.id);
    const supportRes = await reject(duringSupport.id, {
      body: { motivo_recusa: "Recusada durante suporte" },
      extraHeaders: { "x-support-session-id": supportSessionId },
    });
    if (supportRes.status !== 200) fail(`recusa em sessão de suporte: ${supportRes.status} ${JSON.stringify(supportRes.json)}`);
    const supportAudit = await pool.query(
      "SELECT group_id FROM audit_events WHERE resource_type = 'CommercialProposal' AND resource_id = $1",
      [duringSupport.id]
    );
    if (supportAudit.rows.length !== 1 || supportAudit.rows[0].group_id !== null) {
      fail(`desfecho em sessão de suporte entrou na auditoria do cliente: ${JSON.stringify(supportAudit.rows)}`);
    }

    const fromElaborando = await insertProposal("elaborando");
    proposalIds.push(fromElaborando.id);
    if ((await reject(fromElaborando.id, { body: { motivo_recusa: "Sem orçamento" } })).json?.status !== "recusada") fail("recusa a partir de elaborando");

    // --- Transição inválida: desfecho registrado não muda de novo.
    const closedCases = [
      [withFile.id, "aceita", "Esta proposta já foi aceita pelo cliente. Não é possível registrar outro desfecho."],
      [refused.id, "recusada", "Esta proposta já foi recusada pelo cliente. Não é possível registrar outro desfecho."],
    ];
    for (const [id, status, message] of closedCases) {
      const before = await rowOf(id);
      const again = await accept(id, { form: multipart(acceptFields({ nome_assinante: "Outra Pessoa" }), { buffer: SIGNED_PDF }) });
      const flip = await reject(id, { body: { motivo_recusa: "Mudou de ideia" } });
      for (const [label, res] of [["aceite", again], ["recusa", flip]]) {
        if (res.status !== 409 || res.json?.code !== "PROPOSAL_CLOSED" || res.json?.error !== message) {
          fail(`${label} sobre proposta ${status}: ${res.status} ${JSON.stringify(res.json)}`);
        }
      }
      const after = await rowOf(id);
      if (after.status !== status || after.nome_assinante !== before.nome_assinante || after.motivo_recusa !== before.motivo_recusa
        || String(after.updated_date) !== String(before.updated_date)) {
        fail(`transição inválida alterou a proposta ${status}`);
      }
      if (signedFilesOf(uploadDir, id).length !== (status === "aceita" ? 1 : 0)) fail(`transição inválida deixou arquivo em proposta ${status}`);
    }

    // --- Trava de edição.
    const editable = await insertProposal("enviada");
    proposalIds.push(editable.id);
    const editOk = await call("PUT", `/${editable.id}`, { body: { tier: "STARTER", client_name: "Empresa Y Editada" } });
    if (editOk.status !== 200 || editOk.json?.client_name !== "Empresa Y Editada" || editOk.json?.status !== "enviada") {
      fail(`edição de proposta aberta: ${editOk.status}`);
    }
    for (const [id, status, message] of [
      [withFile.id, "aceita", "Esta proposta já foi aceita pelo cliente e não pode mais ser alterada."],
      [refused.id, "recusada", "Esta proposta foi recusada pelo cliente e não pode mais ser alterada."],
    ]) {
      const res = await call("PUT", `/${id}`, { body: { tier: "STARTER", client_name: "Nome Trocado" } });
      if (res.status !== 409 || res.json?.code !== "PROPOSAL_CLOSED" || res.json?.error !== message) {
        fail(`PUT em proposta ${status}: ${res.status} ${JSON.stringify(res.json)}`);
      }
      if ((await rowOf(id)).client_name !== "Empresa Y Ltda") fail(`PUT alterou proposta ${status}`);
    }

    // --- Concorrência: o desfecho confirmado por outra requisição enquanto
    // esta já tinha lido a proposta aberta.
    const raceAccept = await insertProposal("enviada");
    proposalIds.push(raceAccept.id);
    const raceAcceptRes = await raceAgainstCommittedClose(raceAccept.id, "recusada", () => accept(raceAccept.id, {
      form: multipart(acceptFields(), { buffer: SIGNED_PDF }),
    }));
    if (raceAcceptRes.status !== 409 || raceAcceptRes.json?.error !== "Esta proposta já foi recusada pelo cliente. Não é possível registrar outro desfecho.") {
      fail(`aceite que perdeu a corrida: ${raceAcceptRes.status} ${JSON.stringify(raceAcceptRes.json)}`);
    }
    const raceAcceptRow = await rowOf(raceAccept.id);
    if (raceAcceptRow.status !== "recusada" || raceAcceptRow.accepted_at !== null || raceAcceptRow.arquivo_assinado_chave !== null) {
      fail(`aceite que perdeu a corrida gravou algo: ${JSON.stringify(raceAcceptRow)}`);
    }
    if (signedFilesOf(uploadDir, raceAccept.id).length !== 0) fail("aceite que perdeu a corrida deixou o arquivo no disco");
    if (fs.existsSync(path.join(uploadDir, "commercial-proposals", raceAccept.id))) fail("aceite que perdeu a corrida deixou a pasta vazia no disco");

    const raceReject = await insertProposal("elaborando");
    proposalIds.push(raceReject.id);
    const raceRejectRes = await raceAgainstCommittedClose(raceReject.id, "aceita", () => reject(raceReject.id, {
      body: { motivo_recusa: "Perdeu a corrida" },
    }));
    if (raceRejectRes.status !== 409) fail(`recusa que perdeu a corrida: ${raceRejectRes.status}`);
    const raceRejectRow = await rowOf(raceReject.id);
    if (raceRejectRow.status !== "aceita" || raceRejectRow.motivo_recusa !== null) fail("recusa que perdeu a corrida gravou algo");

    const raceEdit = await insertProposal("enviada");
    proposalIds.push(raceEdit.id);
    const raceEditRes = await raceAgainstCommittedClose(raceEdit.id, "aceita", () => call("PUT", `/${raceEdit.id}`, {
      body: { tier: "STARTER", client_name: "Editada Tarde Demais" },
    }));
    if (raceEditRes.status !== 409 || raceEditRes.json?.error !== "Esta proposta já foi aceita pelo cliente e não pode mais ser alterada.") {
      fail(`edição que perdeu a corrida: ${raceEditRes.status} ${JSON.stringify(raceEditRes.json)}`);
    }
    if ((await rowOf(raceEdit.id)).client_name !== "Empresa Y Ltda") fail("edição que perdeu a corrida alterou a proposta aceita");

    // Duas requisições de aceite ao mesmo tempo: exatamente uma vence.
    const both = await insertProposal("enviada");
    proposalIds.push(both.id);
    const results = await Promise.all([1, 2].map((n) => accept(both.id, {
      form: multipart(acceptFields({ nome_assinante: `Assinante ${n}` }), { buffer: SIGNED_PDF }),
    })));
    const statuses = results.map((res) => res.status).sort();
    if (statuses.join(",") !== "200,409") fail(`aceites simultâneos: ${statuses.join(",")}`);
    const winner = results.find((res) => res.status === 200).json;
    if ((await rowOf(both.id)).nome_assinante !== winner.nome_assinante) fail("o aceite gravado não é o que venceu");
    if (signedFilesOf(uploadDir, both.id).length !== 1) fail(`aceites simultâneos deixaram ${signedFilesOf(uploadDir, both.id).length} arquivos`);

    // Pasta da proposta: sai quando fica vazia, fica enquanto houver outro
    // arquivo dentro, e erro na remoção não derruba quem chamou.
    const folderId = randomUUID();
    const folder = path.join(uploadDir, "commercial-proposals", folderId);
    const first = await saveProposalFile(folderId, "enviado", SIGNED_PDF);
    const second = await saveProposalFile(folderId, "assinado", SIGNED_PDF);
    await removeProposalFile(first.key);
    if (!fs.existsSync(folder) || fs.readdirSync(folder).length !== 1) fail("remover um arquivo apagou a pasta com outro arquivo dentro");
    if (!fs.readFileSync(path.join(uploadDir, "commercial-proposals", second.key)).equals(SIGNED_PDF)) fail("remover um arquivo afetou o outro");
    await removeProposalFile(second.key);
    if (fs.existsSync(folder)) fail("pasta vazia da proposta ficou no disco");
    await removeProposalFile(second.key);
    await removeProposalFile("../../fora-da-pasta.pdf");
    const third = await saveProposalFile(folderId, "enviado", SIGNED_PDF);
    if (!fs.existsSync(path.join(uploadDir, "commercial-proposals", third.key))) fail("gravar depois da pasta removida falhou");
    await removeProposalFile(third.key);

    // Banco recusa proposta aceita sem os dados do aceite, por qualquer caminho.
    let checkError = null;
    try {
      await pool.query("UPDATE commercial_proposals SET status = 'aceita' WHERE id = $1", [editable.id]);
    } catch (error) {
      checkError = error;
    }
    if (checkError?.code !== "23514") fail(`aceite incompleto deveria ser recusado pelo banco: ${checkError?.code || "aceito"}`);

    console.log("commercialProposals outcome ok: aceite com e sem arquivo, download, validação, PDF inválido, recusa, transição inválida, trava de edição, concorrência, CHECK");
  } finally {
    server.close();
    config.uploadDir = previousUploadDir;
    fs.rmSync(uploadDir, { recursive: true, force: true });
    try {
      if (supportSessionId) await pool.query("DELETE FROM support_sessions WHERE id = $1", [supportSessionId]);
      await pool.query("DELETE FROM commercial_proposal_history WHERE proposal_id = ANY($1::uuid[])", [proposalIds]);
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
