import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_080 = path.join(__dirname, "../../db/migrations/080_commercial_proposal_history.sql");

function fail(message) {
  throw new Error(message);
}

const PDF_BASE64 = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1").toString("base64");
const SIGNED_PDF = Buffer.from("%PDF-1.7\n%%EOF\n", "latin1");

function startFakeEmailsApi() {
  const state = { respondWith: 202 };
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(state.respondWith, { "content-type": "application/json" });
      res.end(JSON.stringify(state.respondWith < 400 ? { data: { sent: true } } : { error: { code: "X", message: "recusado" } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state })));
}

async function historyRows(proposalId) {
  const result = await pool.query(
    "SELECT * FROM commercial_proposal_history WHERE proposal_id = $1 ORDER BY occurred_at, id",
    [proposalId]
  );
  return result.rows;
}

const eventsOf = async (proposalId) => (await historyRows(proposalId)).map((row) => row.event_type);

// Falha real do banco numa tabela, restrita a uma proposta de teste.
async function withFailingInsert(table, when, fn) {
  const name = `cp_hist_fail_${randomUUID().replace(/-/g, "")}`;
  await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falha simulada pelo teste'; END $$`);
  await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${name}()`);
  try {
    return await fn();
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
    await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
  }
}

const SAO_PAULO_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo",
});

async function main() {
  const suffix = `${Date.now()}`;
  const tag = `PC-HIST-${suffix}`;
  const masterId = randomUUID();
  const emailMaster = `cp-hist-master-${suffix}@test.local`;
  const hash = await bcrypt.hash("Endividamento!Test1", 4);
  const proposalIds = [];

  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, status, platform_admin, created_by)
     VALUES ($1,$2,$3,'Helena Comercial','admin','active', true,'teste')`,
    [masterId, emailMaster, hash]
  );

  const previousUploadDir = config.uploadDir;
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-hist-"));
  config.uploadDir = uploadDir;
  const fake = await startFakeEmailsApi();
  const previousUrl = config.emailServiceUrl;
  const previousKey = config.emailServiceApiKey;
  config.emailServiceUrl = `http://127.0.0.1:${fake.server.address().port}`;
  config.emailServiceApiKey = "service:chave-de-teste";

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/commercial-proposals`;
  const token = issueAuthResponse(
    { id: masterId, email: emailMaster, full_name: "Helena Comercial", role: "admin", platform_admin: true },
    null
  ).token;

  async function call(method, pathname, { body, form } = {}) {
    const headers = { authorization: `Bearer ${token}` };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${pathname}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json };
  }

  // Proposta gravada direto no banco, sem passar pelo serviço — como as que
  // existiam antes da migração 080.
  async function rawProposal({ numero = `${tag}-${randomUUID().slice(0, 6)}`, clientName = "Cliente Raw", status = "elaborando", createdDate = "2026-01-10T12:00:00Z", mensalidade = 0, implantacao = 0 } = {}) {
    const result = await pool.query(
      `INSERT INTO commercial_proposals (numero, status, client_name, tier, pricing_snapshot, created_date, created_by, valor_mensalidade, valor_implantacao)
       VALUES ($1, 'elaborando', $2, 'STARTER', '{}'::jsonb, $3::timestamptz, 'antigo@clarity.local', $4, $5)
       RETURNING id, numero`,
      [numero, clientName, createdDate, mensalidade, implantacao]
    );
    const row = result.rows[0];
    proposalIds.push(row.id);
    if (status === "enviada") await pool.query("UPDATE commercial_proposals SET status = 'enviada' WHERE id = $1", [row.id]);
    return row;
  }
  async function rawAccept(id, acceptedAt, by = "aceitou@clarity.local") {
    await pool.query(
      `UPDATE commercial_proposals SET status = 'aceita', accepted_at = $2::timestamptz, accepted_by_email = $3, accepted_by_name = 'Quem Aceitou',
         data_assinatura = DATE '2026-01-01', nome_assinante = 'Assinante', canal_aceite = 'email' WHERE id = $1`,
      [id, acceptedAt, by]
    );
  }
  async function rawReject(id, rejectedAt) {
    await pool.query(
      `UPDATE commercial_proposals SET status = 'recusada', rejected_at = $2::timestamptz, rejected_by_email = 'recusou@clarity.local',
         rejected_by_name = 'Quem Recusou', motivo_recusa = 'Preço' WHERE id = $1`,
      [id, rejectedAt]
    );
  }

  const proposalBody = (overrides = {}) => ({
    tier: "STARTER", client_name: "Empresa Linha do Tempo", contact_name: "Rita", validity_days: "15",
    valor_mensalidade: 1500.5, valor_implantacao: 3000, pricing_snapshot: { base: 1 }, ...overrides,
  });

  try {
    // ------------------------------------------------------------------
    // Eventos gravados pelas operações
    // ------------------------------------------------------------------
    const created = await call("POST", "/", { body: proposalBody({ numero: `${tag}-VIVA` }) });
    if (created.status !== 201) fail(`criação: ${created.status} ${JSON.stringify(created.json)}`);
    const liveId = created.json.id;
    proposalIds.push(liveId);
    let rows = await historyRows(liveId);
    if (rows.length !== 1 || rows[0].event_type !== "criada" || rows[0].new_value !== "elaborando"
      || rows[0].actor !== emailMaster || rows[0].actor_name !== "Helena Comercial") {
      fail(`evento de criação: ${JSON.stringify(rows)}`);
    }

    // Salvar mudando algo: um evento, sem diff. Salvar de novo igual: nada.
    const edited = await call("PUT", `/${liveId}`, { body: proposalBody({ client_name: "Empresa Linha do Tempo S.A." }) });
    if (edited.status !== 200) fail(`edição: ${edited.status}`);
    const same = await call("PUT", `/${liveId}`, { body: proposalBody({ client_name: "Empresa Linha do Tempo S.A." }) });
    if (same.status !== 200) fail(`salvamento sem mudança: ${same.status}`);
    if ((await eventsOf(liveId)).join(",") !== "criada,editada") fail(`salvar sem mudar gerou evento: ${await eventsOf(liveId)}`);
    // Mudança só num valor numérico e só no JSON de preços também contam.
    await call("PUT", `/${liveId}`, { body: proposalBody({ client_name: "Empresa Linha do Tempo S.A.", valor_mensalidade: 1500.51 }) });
    await call("PUT", `/${liveId}`, { body: proposalBody({ client_name: "Empresa Linha do Tempo S.A.", valor_mensalidade: 1500.51, pricing_snapshot: { base: 2 } }) });
    rows = await historyRows(liveId);
    const edits = rows.filter((row) => row.event_type === "editada");
    if (edits.length !== 3) fail(`edições registradas: ${edits.length}, esperado 3`);
    if (edits.some((row) => row.previous_value !== null || row.new_value !== null || row.note !== null || row.actor !== emailMaster)) {
      fail(`evento de edição com diff ou sem autor: ${JSON.stringify(edits)}`);
    }

    // Envio que falhou e envio que saiu: um evento cada, ligado ao envio.
    fake.state.respondWith = 422;
    const failedSend = await call("POST", `/${liveId}/send-email`, {
      body: { to: "falha@cliente.com.br", pdfBase64: PDF_BASE64, nomeArquivo: "proposta.pdf" },
    });
    if (failedSend.status !== 502) fail(`envio que falhou: ${failedSend.status}`);
    fake.state.respondWith = 202;
    const sent = await call("POST", `/${liveId}/send-email`, {
      body: { to: "ok@cliente.com.br", pdfBase64: PDF_BASE64, nomeArquivo: "proposta.pdf" },
    });
    if (sent.status !== 200) fail(`envio: ${sent.status} ${JSON.stringify(sent.json)}`);

    // Aceite: evento com a situação de origem.
    const form = new FormData();
    for (const [key, value] of Object.entries({ data_assinatura: "2026-01-02", nome_assinante: "Rita Souza", canal_aceite: "email" })) form.append(key, value);
    form.append("file", new Blob([SIGNED_PDF], { type: "application/pdf" }), "assinada.pdf");
    const accepted = await call("POST", `/${liveId}/accept`, { form });
    if (accepted.status !== 200) fail(`aceite: ${accepted.status} ${JSON.stringify(accepted.json)}`);
    // Desfecho recusado (409) não vira evento.
    const secondOutcome = await call("POST", `/${liveId}/reject`, { body: { motivo_recusa: "tarde" } });
    if (secondOutcome.status !== 409) fail(`segundo desfecho: ${secondOutcome.status}`);

    const timeline = await call("GET", `/${liveId}/history`);
    if (timeline.status !== 200 || !Array.isArray(timeline.json)) fail(`GET history: ${timeline.status}`);
    const types = timeline.json.map((row) => row.event_type);
    if (types.join(",") !== "aceita,email_enviado,email_falhou,editada,editada,editada,criada") {
      fail(`linha do tempo (mais recente primeiro): ${types.join(",")}`);
    }
    const [acceptEvent, sentEvent, failedEvent] = timeline.json;
    if (acceptEvent.previous_value !== "enviada" || acceptEvent.new_value !== "aceita" || acceptEvent.actor_name !== "Helena Comercial") {
      fail(`evento de aceite: ${JSON.stringify(acceptEvent)}`);
    }
    if (sentEvent.send_id !== sent.json.send.id || sentEvent.note !== "ok@cliente.com.br" || sentEvent.send_has_file !== true) {
      fail(`evento de envio: ${JSON.stringify(sentEvent)}`);
    }
    if (failedEvent.note !== "falha@cliente.com.br" || failedEvent.send_has_file !== false || !failedEvent.send_id) {
      fail(`evento de envio que falhou: ${JSON.stringify(failedEvent)}`);
    }
    if (timeline.json[6].send_has_file !== null) fail("evento sem envio deveria ter send_has_file nulo");
    // Proposta inexistente (ou id fora do formato): 404 com código próprio,
    // igual em todas as rotas do módulo.
    for (const missingId of [randomUUID(), "nao-e-uuid"]) {
      const missing = await call("GET", `/${missingId}/history`);
      if (missing.status !== 404 || missing.json?.code !== "NOT_FOUND" || missing.json?.error !== "Proposta não encontrada") {
        fail(`history de proposta inexistente (${missingId}): ${missing.status} ${JSON.stringify(missing.json)}`);
      }
    }
    const ghost = randomUUID();
    for (const [method, pathname, body] of [
      ["GET", `/${ghost}`],
      ["PUT", `/${ghost}`, proposalBody()],
      ["POST", `/${ghost}/accept`, {}],
      ["POST", `/${ghost}/reject`, {}],
      ["POST", `/${ghost}/send-email`, { to: "x@cliente.com.br", pdfBase64: PDF_BASE64, nomeArquivo: "p.pdf" }],
      ["GET", `/${ghost}/signed-file`],
      ["GET", `/${ghost}/sends/${randomUUID()}/file`],
    ]) {
      const res = await call(method, pathname, { body });
      if (res.status !== 404 || res.json?.code !== "NOT_FOUND" || res.json?.error !== "Proposta não encontrada") {
        fail(`${method} ${pathname} de proposta inexistente: ${res.status} ${JSON.stringify(res.json)}`);
      }
    }
    for (const sendId of [randomUUID(), "nao-e-uuid"]) {
      const res = await call("GET", `/${liveId}/sends/${sendId}/file`);
      if (res.status !== 404 || res.json?.code !== "NOT_FOUND" || res.json?.error !== "Envio não encontrado") {
        fail(`envio inexistente (${sendId}): ${res.status} ${JSON.stringify(res.json)}`);
      }
    }

    // Recusa: evento com o motivo.
    const refusedRes = await call("POST", "/", { body: proposalBody({ numero: `${tag}-RECUSA` }) });
    proposalIds.push(refusedRes.json.id);
    const refused = await call("POST", `/${refusedRes.json.id}/reject`, { body: { motivo_recusa: "Orçamento cortado" } });
    if (refused.status !== 200) fail(`recusa: ${refused.status}`);
    const refusedRows = await historyRows(refusedRes.json.id);
    const refuseEvent = refusedRows.find((row) => row.event_type === "recusada");
    if (!refuseEvent || refuseEvent.previous_value !== "elaborando" || refuseEvent.new_value !== "recusada" || refuseEvent.note !== "Orçamento cortado") {
      fail(`evento de recusa: ${JSON.stringify(refusedRows)}`);
    }

    // Mesma transação: se o evento não grava, a operação não acontece.
    const atomic = await rawProposal({ status: "enviada" });
    const acceptFails = await withFailingInsert("commercial_proposal_history", `NEW.proposal_id = '${atomic.id}'`, () => {
      const f = new FormData();
      for (const [key, value] of Object.entries({ data_assinatura: "2026-01-02", nome_assinante: "X", canal_aceite: "email" })) f.append(key, value);
      return call("POST", `/${atomic.id}/accept`, { form: f });
    });
    if (acceptFails.status !== 500) fail(`aceite sem evento: ${acceptFails.status}`);
    const atomicRow = (await pool.query("SELECT status, accepted_at FROM commercial_proposals WHERE id = $1", [atomic.id])).rows[0];
    if (atomicRow.status !== "enviada" || atomicRow.accepted_at !== null) fail("aceite gravou sem o evento da linha do tempo");
    const editFails = await withFailingInsert("commercial_proposal_history", `NEW.proposal_id = '${atomic.id}'`, () => (
      call("PUT", `/${atomic.id}`, { body: proposalBody({ client_name: "Não deveria gravar" }) })
    ));
    if (editFails.status !== 500) fail(`edição sem evento: ${editFails.status}`);
    if ((await pool.query("SELECT client_name FROM commercial_proposals WHERE id = $1", [atomic.id])).rows[0].client_name !== "Cliente Raw") {
      fail("edição gravou sem o evento da linha do tempo");
    }
    const createFails = await withFailingInsert("commercial_proposal_history", "NEW.event_type = 'criada' AND NEW.actor = '" + emailMaster + "'", () => (
      call("POST", "/", { body: proposalBody({ numero: `${tag}-SEM-EVENTO` }) })
    ));
    if (createFails.status !== 500) fail(`criação sem evento: ${createFails.status}`);
    if ((await pool.query("SELECT 1 FROM commercial_proposals WHERE numero = $1", [`${tag}-SEM-EVENTO`])).rows.length) {
      fail("criação gravou sem o evento da linha do tempo");
    }
    // Envio entregue cujo evento não grava: nem registro nem evento, e a
    // resposta diz para não reenviar (mesmo tratamento do registro que falha).
    const sendFails = await withFailingInsert("commercial_proposal_history", `NEW.proposal_id = '${atomic.id}' AND NEW.event_type = 'email_enviado'`, () => (
      call("POST", `/${atomic.id}/send-email`, { body: { to: "x@cliente.com.br", pdfBase64: PDF_BASE64, nomeArquivo: "p.pdf" } })
    ));
    if (sendFails.status !== 500 || sendFails.json?.code !== "EMAIL_SENT_NOT_RECORDED") fail(`envio sem evento: ${sendFails.status} ${JSON.stringify(sendFails.json)}`);
    const orphanSends = await pool.query("SELECT count(*)::int AS n FROM commercial_proposal_sends WHERE proposal_id = $1", [atomic.id]);
    if (orphanSends.rows[0].n !== 0) fail("registro do envio ficou sem o evento da linha do tempo");

    // ------------------------------------------------------------------
    // Preenchimento das propostas antigas (080), idempotente
    // ------------------------------------------------------------------
    const oldOpen = await rawProposal({ createdDate: "2025-06-01T10:00:00Z" });
    const oldAccepted = await rawProposal({ createdDate: "2025-06-02T10:00:00Z", status: "enviada" });
    const oldSendOk = (await pool.query(
      `INSERT INTO commercial_proposal_sends (proposal_id, recipient_email, sent_by_email, sent_by_name, file_name, result, created_date)
       VALUES ($1, 'a@cliente.com.br', 'enviou@clarity.local', 'Quem Enviou', 'p.pdf', 'enviado', '2025-06-03T10:00:00Z') RETURNING id`,
      [oldAccepted.id]
    )).rows[0].id;
    await pool.query(
      `INSERT INTO commercial_proposal_sends (proposal_id, recipient_email, sent_by_email, file_name, result, error_detail, created_date)
       VALUES ($1, 'b@cliente.com.br', 'enviou@clarity.local', 'p.pdf', 'falhou', 'x', '2025-06-03T09:00:00Z')`,
      [oldAccepted.id]
    );
    await rawAccept(oldAccepted.id, "2025-06-04T10:00:00Z");
    const oldRefused = await rawProposal({ createdDate: "2025-06-05T10:00:00Z" });
    await rawReject(oldRefused.id, "2025-06-06T10:00:00Z");
    for (const old of [oldOpen, oldAccepted, oldRefused]) {
      if ((await historyRows(old.id)).length !== 0) fail("proposta antiga já nasceu com linha do tempo");
    }

    const migrationSql = fs.readFileSync(MIGRATION_080, "utf8");
    const expected = {
      [oldOpen.id]: "criada",
      [oldAccepted.id]: "criada,email_falhou,email_enviado,aceita",
      [oldRefused.id]: "criada,recusada",
      [liveId]: "criada,editada,editada,editada,email_falhou,email_enviado,aceita",
    };
    for (const round of [1, 2]) {
      await pool.query(migrationSql);
      for (const [id, events] of Object.entries(expected)) {
        const got = (await eventsOf(id)).join(",");
        if (got !== events) fail(`preenchimento (rodada ${round}) de ${id}: ${got} (esperado ${events})`);
      }
    }
    const backfilled = await historyRows(oldAccepted.id);
    const [bCreated, bFailed, bSent, bAccepted] = backfilled;
    if (bCreated.actor !== "antigo@clarity.local" || new Date(bCreated.occurred_at).toISOString() !== "2025-06-02T10:00:00.000Z" || bCreated.new_value !== "elaborando") {
      fail(`criação reconstruída: ${JSON.stringify(bCreated)}`);
    }
    if (bSent.send_id !== oldSendOk || bSent.actor !== "enviou@clarity.local" || bSent.actor_name !== "Quem Enviou" || bSent.note !== "a@cliente.com.br"
      || new Date(bSent.occurred_at).toISOString() !== "2025-06-03T10:00:00.000Z") {
      fail(`envio reconstruído: ${JSON.stringify(bSent)}`);
    }
    if (bFailed.note !== "b@cliente.com.br") fail(`falha reconstruída: ${JSON.stringify(bFailed)}`);
    if (bAccepted.actor !== "aceitou@clarity.local" || bAccepted.actor_name !== "Quem Aceitou" || bAccepted.previous_value !== null
      || new Date(bAccepted.occurred_at).toISOString() !== "2025-06-04T10:00:00.000Z") {
      fail(`aceite reconstruído: ${JSON.stringify(bAccepted)}`);
    }
    const bRefused = (await historyRows(oldRefused.id))[1];
    if (bRefused.note !== "Preço" || bRefused.actor !== "recusou@clarity.local") fail(`recusa reconstruída: ${JSON.stringify(bRefused)}`);

    // O banco recusa o evento duplicado por qualquer caminho.
    let duplicate = null;
    try {
      await pool.query("INSERT INTO commercial_proposal_history (proposal_id, event_type) VALUES ($1, 'criada')", [oldOpen.id]);
    } catch (error) {
      duplicate = error;
    }
    if (duplicate?.code !== "23505") fail(`segunda criação deveria ser recusada: ${duplicate?.code || "aceita"}`);

    // ------------------------------------------------------------------
    // Filtro por situação na listagem
    // ------------------------------------------------------------------
    const listOf = async (query) => {
      const res = await call("GET", `/?${query}`);
      if (res.status !== 200) fail(`listagem ${query}: ${res.status} ${JSON.stringify(res.json)}`);
      return res.json.map((row) => row.id).sort();
    };
    // "atomic" continua enviada: o aceite dela falhou de propósito.
    const byStatus = {
      elaborando: [oldOpen.id],
      enviada: [atomic.id],
      aceita: [liveId, oldAccepted.id],
      recusada: [refusedRes.json.id, oldRefused.id],
    };
    for (const [status, ids] of Object.entries(byStatus)) {
      const got = await listOf(`q=${encodeURIComponent(tag)}&status=${status}`);
      if (got.join() !== [...ids].sort().join()) fail(`filtro ${status}: ${got.length} propostas (esperado ${ids.length})`);
    }
    const open = await listOf(`q=${encodeURIComponent(tag)}&status=elaborando,enviada`);
    if (open.join() !== [oldOpen.id, atomic.id].sort().join()) fail(`filtro em aberto: ${open.length}`);
    const all = await listOf(`q=${encodeURIComponent(tag)}`);
    if (all.length !== 6) fail(`sem filtro de situação: ${all.length} propostas`);
    // A busca combina com o filtro (E), inclusive quando casa pelo cliente e
    // não pelo número.
    const byClient = await rawProposal({ numero: `OUTRO-${suffix}`, clientName: `Cliente ${tag}` });
    await rawReject(byClient.id, "2025-07-01T10:00:00Z");
    const acceptedWithQ = await listOf(`q=${encodeURIComponent(tag)}&status=aceita`);
    if (acceptedWithQ.includes(byClient.id)) fail("busca pelo cliente furou o filtro de situação");
    const refusedWithQ = await listOf(`q=${encodeURIComponent(tag)}&status=recusada`);
    if (!refusedWithQ.includes(byClient.id)) fail("busca pelo cliente não encontrou a proposta recusada");
    for (const bad of ["expirada", "aceita,expirada", "ACEITA", ","]) {
      const res = await call("GET", `/?status=${encodeURIComponent(bad)}`);
      if (res.status !== 400 || res.json?.error !== "Situação inválida. Use elaborando, enviada, aceita ou recusada.") {
        fail(`status inválido ${bad}: ${res.status} ${JSON.stringify(res.json)}`);
      }
    }

    // ------------------------------------------------------------------
    // Resumo para a diretoria
    // ------------------------------------------------------------------
    const summaryOf = async (query = "") => {
      const res = await call("GET", `/summary${query ? `?${query}` : ""}`);
      if (res.status !== 200) fail(`resumo ${query}: ${res.status} ${JSON.stringify(res.json)}`);
      return res.json;
    };
    const march = "de=2031-03-01&ate=2031-03-31";
    const before = await summaryOf(march);

    // Pontas do período em São Paulo (UTC-3): 00:00 de 01/03 entra, 23:59:59
    // de 28/02 não; 23:59:59 de 31/03 entra, 00:00 de 01/04 não.
    const accepts = [
      ["2031-03-01T03:00:00Z", "0.10", "1000.01"], // dentro
      ["2031-03-01T02:59:59Z", "500.00", "500.00"], // fora
      ["2031-04-01T02:59:59Z", "0.20", "999999999999.99"], // dentro
      ["2031-04-01T03:00:00Z", "700.00", "700.00"], // fora
    ];
    for (const [at, mensalidade, implantacao] of accepts) {
      const p = await rawProposal({ mensalidade, implantacao, status: "enviada" });
      await rawAccept(p.id, at);
    }
    // Só a primeira cai em março em São Paulo: 28/02 23:00 UTC é 20:00 de
    // 28/02, e 01/04 03:00 UTC é 00:00 de 01/04.
    for (const at of ["2031-03-15T12:00:00Z", "2031-02-28T23:00:00Z", "2031-04-01T03:00:00Z"]) {
      const p = await rawProposal();
      await rawReject(p.id, at);
    }
    await rawProposal();
    await rawProposal({ status: "enviada" });

    const after = await summaryOf(march);
    if (after.periodo.de !== "2031-03-01" || after.periodo.ate !== "2031-03-31" || after.periodo.fuso !== "America/Sao_Paulo") {
      fail(`período devolvido: ${JSON.stringify(after.periodo)}`);
    }
    if (after.aceitas - before.aceitas !== 2) fail(`aceitas no período: ${after.aceitas - before.aceitas} (esperado 2)`);
    if (after.recusadas - before.recusadas !== 1) fail(`recusadas no período: ${after.recusadas - before.recusadas} (esperado 1)`);
    if (after.em_aberto - before.em_aberto !== 2 || after.em_aberto_por_situacao.elaborando - before.em_aberto_por_situacao.elaborando !== 1
      || after.em_aberto_por_situacao.enviada - before.em_aberto_por_situacao.enviada !== 1) {
      fail(`em aberto (foto atual): ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    }
    if (before.aceitas !== 0 || before.valor_mensalidade_aceitas !== "0.00") fail(`período sem dados deveria vir zerado: ${JSON.stringify(before)}`);
    // Texto exato, sem float: 0,10 + 0,20 não vira 0,30000000000000004, e
    // 999.999.999.999,99 + 1.000,01 não perde centavo.
    if (after.valor_mensalidade_aceitas !== "0.30") fail(`soma das mensalidades: ${after.valor_mensalidade_aceitas}`);
    if (after.valor_implantacao_aceitas !== "1000000001000.00") fail(`soma das implantações: ${after.valor_implantacao_aceitas}`);

    const lastDay = await summaryOf("de=2031-03-31&ate=2031-03-31");
    if (lastDay.aceitas !== 1 || lastDay.valor_mensalidade_aceitas !== "0.20") fail(`um dia só (31/03): ${JSON.stringify(lastDay)}`);
    const firstDay = await summaryOf("de=2031-03-01&ate=2031-03-01");
    if (firstDay.aceitas !== 1 || firstDay.valor_implantacao_aceitas !== "1000.01") fail(`um dia só (01/03): ${JSON.stringify(firstDay)}`);

    // Padrão: mês corrente em São Paulo.
    const current = await summaryOf();
    const [year, month] = SAO_PAULO_DAY.format(new Date()).split("-").map(Number);
    const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    if (current.periodo.de !== `${year}-${pad(month)}-01` || current.periodo.ate !== `${year}-${pad(month)}-${pad(lastOfMonth)}`) {
      fail(`período padrão: ${JSON.stringify(current.periodo)}`);
    }
    for (const [query, message] of [
      ["de=2031-04-01&ate=2031-03-01", "A data inicial não pode ser depois da data final"],
      ["de=2031-02-30", "Data inicial inválida"],
      ["ate=31/03/2031", "Data final inválida. Use o formato AAAA-MM-DD"],
    ]) {
      const res = await call("GET", `/summary?${query}`);
      if (res.status !== 400 || res.json?.error !== message) fail(`resumo ${query}: ${res.status} ${JSON.stringify(res.json)}`);
    }

    console.log("commercialProposals history ok: eventos na mesma transação, edição sem ruído, preenchimento idempotente, filtro por situação, resumo por período em São Paulo");
  } finally {
    server.close();
    fake.server.close();
    config.uploadDir = previousUploadDir;
    config.emailServiceUrl = previousUrl;
    config.emailServiceApiKey = previousKey;
    fs.rmSync(uploadDir, { recursive: true, force: true });
    try {
      await pool.query("DELETE FROM commercial_proposal_history WHERE proposal_id = ANY($1::uuid[])", [proposalIds]);
      await pool.query("DELETE FROM commercial_proposal_sends WHERE proposal_id = ANY($1::uuid[])", [proposalIds]);
      await pool.query("DELETE FROM commercial_proposals WHERE id = ANY($1::uuid[])", [proposalIds]);
      await pool.query(
        `UPDATE users SET status = 'disabled', email = email || '.retired.' || id::text WHERE id = $1`,
        [masterId]
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
