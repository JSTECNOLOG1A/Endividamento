import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { runWithTenant } from "../tenants/access.js";
import { lineFromBarcode, mod11 } from "./guideLine.js";
import { readConsultResponse, readIncludeResponse, readReverseResponse } from "./taxTitleErp.js";
import {
  confirmTaxTitleAbsence,
  consultTaxTitle,
  consultTaxTitles,
  processTaxTitle,
  settleTaxTitleSyncs,
  syncTaxTitles,
} from "./taxTitles.js";
import { deleteInstallmentWithGuides } from "./rules.js";
import { setParameter } from "../parameters/service.js";
import { cleanupOrphanedPayableTitles, syncPayableTitlesFromApprovedContracts } from "../payables/generate.js";
import { listReadyPayableTitles, autoIntegratePayableTitles } from "../payables/autoIntegrate.js";
import { refreshPayableTitlesFromErp } from "../payables/erpIntegrate.js";
import { convertPayablePrToTx } from "../payables/convertPrToTx.js";
import { classifyPayableTitles } from "../payables/classify.js";

// Título a pagar de tributo no Protheus, de ponta a ponta contra um FinRestTitulos de teste (HTTP local):
// nascimento com a guia vinculada, troca/remoção de guia antes e depois da baixa, exclusão com estorno confirmado,
// respostas ambíguas, envio sem confirmação → consulta, concorrência, isolamento e a prova de que as rotinas dos
// títulos de empréstimo não alcançam o título de tributo.

process.exitCode = 1;
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

// ---------------------------------------------------------------------------
// FinRestTitulos de teste
// ---------------------------------------------------------------------------

function startFakeProtheus() {
  const state = {
    se2: new Map(),
    calls: [],
    include: "ok",
    consult: "ok",
    reverse: "ok",
    includeDelayMs: 0,
    consultDelayMs: 0,
    consultPatch: null,
    gets: 0,
  };
  const keyOf = (b) => [b.filial, b.prefixo, b.numero, b.parcela, b.tipo, b.fornecedor, b.loja].map((v) => String(v ?? "").trim()).join("|");
  const reply = (res, status, body) => {
    res.writeHead(status, { "content-type": typeof body === "string" ? "text/html" : "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const url = new URL(req.url, "http://x");
      if (req.method !== "POST") {
        state.gets += 1;
        return reply(res, 200, { items: [] });
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const path = url.pathname;
      const op = path.endsWith("/consultar") ? "consultar" : path.endsWith("/extornar") ? "extornar" : path.endsWith("/pagar") ? "incluir" : "outro";
      state.calls.push({ op, body });
      const key = keyOf(body);
      const echo = { prefixo: body.prefixo, numero: body.numero, parcela: body.parcela, tipo: body.tipo, loja: body.loja };
      if (op === "incluir") {
        if (state.includeDelayMs) await new Promise((resolve) => setTimeout(resolve, state.includeDelayMs));
        const mode = state.include;
        if (mode === "drop_before") return req.socket.destroy();
        if (mode === "error400") return reply(res, 400, { code: "400", message: "FINA050 recusou o titulo a pagar. Natureza bloqueada" });
        state.se2.set(key, { ...body, saldo: body.valor, situacao: "aberto" });
        if (mode === "error400_after") return reply(res, 400, { code: "400", message: "Titulo ja existe no SE2 com E2_FILIAL=02. Esperado 01." });
        if (mode === "error500_html") return reply(res, 500, "<html>Internal Server Error</html>");
        if (mode === "drop_after") return req.socket.destroy();
        if (mode === "html") return reply(res, 200, "<html><body>Internal Server Error</body></html>");
        if (mode === "sem_chave") return reply(res, 201, { code: "201", message: "Titulo incluido com sucesso", tipoOperacao: "pagar" });
        return reply(res, 201, { code: "201", message: "Titulo incluido com sucesso", tipoOperacao: "pagar", ...echo, parceiro: body.fornecedor, valor: body.valor, filial: body.filial });
      }
      if (op === "consultar") {
        if (state.consultDelayMs) await new Promise((resolve) => setTimeout(resolve, state.consultDelayMs));
        if (state.consult === "html") return reply(res, 200, "<html>erro</html>");
        if (state.consult === "drop") return req.socket.destroy();
        const found = state.se2.get(key);
        if (!found) return reply(res, 200, { code: "200", message: "Titulo nao encontrado no SE2", encontrado: 0, situacao: "nao_encontrado", ...echo, fornecedor: body.fornecedor });
        return reply(res, 200, { code: "200", encontrado: 1, situacao: found.situacao, ...echo, fornecedor: body.fornecedor, valor: found.valor, saldo: found.saldo, baixa: found.situacao === "aberto" ? "" : "2026-10-07", filial: body.filial, ...(state.consultPatch || {}) });
      }
      if (op === "extornar") {
        const found = state.se2.get(key);
        if (state.reverse === "error400") return reply(res, 400, { code: "400", message: "Titulo possui movimentacao e nao pode ser estornado." });
        if (!found) return reply(res, 400, { code: "400", message: "Titulo a pagar nao encontrado no SE2." });
        state.se2.delete(key);
        if (state.reverse === "drop_after") return req.socket.destroy();
        return reply(res, 201, { code: "201", message: "Titulo estornado com sucesso", tipoOperacao: "extornar-pagar", ...echo, parceiro: body.fornecedor, valor: found.valor, filial: body.filial });
      }
      return reply(res, 404, { message: "?" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state })));
}

function jsonRequest(server, { method, path, body, token }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const payload = body == null ? null : JSON.stringify(body);
    const req = httpRequest({
      hostname: "127.0.0.1", port, path, method,
      headers: {
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = text; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function makeLine(cents, tail) {
  const rest = String(cents).padStart(11, "0") + String(tail).padEnd(29, "0").slice(0, 29);
  return lineFromBarcode(`858${mod11(`858${rest}`)}${rest}`);
}

// ---------------------------------------------------------------------------
// Leitura das respostas (puro)
// ---------------------------------------------------------------------------

function responseTests() {
  const key = { filial: "01", prefixo: "TRB", numero: "000000001", parcela: "01", tipo: "TX", fornecedor: "UNIAO", loja: "00" };
  const okInclude = { code: "201", message: "Titulo incluido com sucesso", tipoOperacao: "pagar", prefixo: "TRB", numero: "000000001", parcela: "01", tipo: "TX", parceiro: "UNIAO", loja: "00", filial: "01" };
  check(readIncludeResponse(201, okInclude, key).confirmed, "inclusão no formato do FinRestTitulos confirma");
  for (const [label, status, data] of [
    ["HTML", 200, "<html>ok</html>"],
    ["vazia", 200, null],
    ["sem chave", 201, { code: "201", message: "Titulo incluido com sucesso", tipoOperacao: "pagar" }],
    ["outra chave", 201, { ...okInclude, numero: "000000002" }],
    ["outro fornecedor", 201, { ...okInclude, parceiro: "000000" }],
    ["outra filial", 201, { ...okInclude, filial: "02" }],
    ["erro 400", 400, { code: "400", message: "FINA050 recusou" }],
    ["code 200", 201, { ...okInclude, code: "200" }],
    ["estorno no lugar de inclusão", 201, { ...okInclude, tipoOperacao: "extornar-pagar", message: "Titulo estornado com sucesso" }],
    ["HTTP 500 com corpo de sucesso", 500, okInclude],
  ]) {
    check(!readIncludeResponse(status, data, key).confirmed, `inclusão ${label} não confirma`);
  }
  const okReverse = { ...okInclude, tipoOperacao: "extornar-pagar", message: "Titulo estornado com sucesso" };
  check(readReverseResponse(201, okReverse, key).confirmed, "estorno no formato do FinRestTitulos confirma");
  check(!readReverseResponse(201, okInclude, key).confirmed, "resposta de inclusão não confirma estorno");
  check(!readReverseResponse(201, { ...okReverse, tipoOperacao: "pagar" }, key).confirmed, "estorno com operação de inclusão não confirma");
  check(!readReverseResponse(201, { ...okReverse, message: "Titulo incluido com sucesso" }, key).confirmed, "estorno com mensagem de inclusão não confirma");
  check(!readReverseResponse(201, { ...okReverse, numero: "000000009" }, key).confirmed, "estorno de outra chave não confirma");
  const found = { code: "200", encontrado: 1, situacao: "aberto", prefixo: "TRB", numero: "000000001", parcela: "01", tipo: "TX", fornecedor: "UNIAO", loja: "00", valor: 10, saldo: 10 };
  check(readConsultResponse(200, found, key).result === "encontrado", "consulta achou");
  check(readConsultResponse(200, { ...found, encontrado: 0, situacao: "nao_encontrado" }, key).result === "nao_encontrado", "consulta não achou");
  check(readConsultResponse(200, { ...found, encontrado: 0, situacao: "nao_encontrado", numero: "000000002" }, key).result === "inconclusivo", "não achou OUTRA chave = inconclusivo");
  check(readConsultResponse(200, { ...found, encontrado: 0 }, key).result === "inconclusivo", "encontrado 0 com situação aberto = inconclusivo");
  check(readConsultResponse(200, "<html/>", key).result === "inconclusivo", "consulta HTML = inconclusiva");
  check(readConsultResponse(200, { ...found, saldo: "x" }, key).result === "inconclusivo", "consulta sem saldo numérico = inconclusiva");
  // O FinRestTitulos procura em mais de uma filial: achado em outra filial ou com outro valor não é o enviado.
  const keyed = { ...key, filial: "0101", valor: 100 };
  check(readConsultResponse(200, { ...found, filial: "03", valor: 100, saldo: 100 }, keyed).result === "divergente", "consulta em outra filial = divergente");
  check(readConsultResponse(200, { ...found, filial: "0101", valor: 55.5, saldo: 55.5 }, keyed).result === "divergente", "consulta com outro valor = divergente");
  check(readConsultResponse(200, { ...found, filial: "0101", valor: 100.001, saldo: 100 }, keyed).result === "encontrado", "mesmo valor em centavos = encontrado");
  check(readConsultResponse(200, { ...found, valor: 100, saldo: 100 }, keyed).result === "encontrado", "sem filial na resposta, valor igual = encontrado");
  check(!readReverseResponse(201, { ...okReverse, filial: "03" }, { ...key, filial: "0101" }).confirmed, "estorno em outra filial não confirma");
}

// ---------------------------------------------------------------------------
// Ponta a ponta
// ---------------------------------------------------------------------------

async function main() {
  responseTests();
  const fake = await startFakeProtheus();
  const suffix = `${Date.now()}`;
  const groupA = `grp_tt_a_${suffix}`;
  const groupB = `grp_tt_b_${suffix}`;
  const entityA = `ent_tt_a_${suffix}`;
  const entityB = `ent_tt_b_${suffix}`;
  const tenantA = `tnt_tt_a_${suffix}`;
  const tenantB = `tnt_tt_b_${suffix}`;
  const contractA = `ctr_tt_a_${suffix}`;
  const loanTitle = `ttl_tt_a_${suffix}`;
  const integrationA = randomUUID();
  const users = {
    ownerA: { id: randomUUID(), email: `tt-owner-a-${suffix}@test.local`, role: "admin", tenantRole: "OWNER", tenant: tenantA, group: groupA },
    viewerA: { id: randomUUID(), email: `tt-viewer-a-${suffix}@test.local`, role: "viewer", tenantRole: "VIEWER", tenant: tenantA, group: groupA },
    noTaxA: { id: randomUUID(), email: `tt-notax-a-${suffix}@test.local`, role: "admin", tenantRole: "ADMIN", tenant: tenantA, group: groupA, noTax: true },
    adminA: { id: randomUUID(), email: `tt-admin-a-${suffix}@test.local`, role: "user", tenantRole: "ADMIN", tenant: tenantA, group: groupA },
    ownerB: { id: randomUUID(), email: `tt-owner-b-${suffix}@test.local`, role: "admin", tenantRole: "OWNER", tenant: tenantB, group: groupB },
  };
  const agreementA = randomUUID();
  const agreementA2 = randomUUID();
  const agreementB = randomUUID();
  const inst = Object.fromEntries(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12", "a13", "a14", "a15", "r1", "b1"].map((k) => [k, randomUUID()]));

  await pool.query("BEGIN");
  try {
    await pool.query(`INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'TT A','ativo','teste'), ($2,'TT B','ativo','teste')`, [groupA, groupB]);
    await pool.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
       VALUES ($1,$2,'Agro TT','11.222.333/0001-81','CNPJ','empresa','01','01','ativa','teste'),
              ($3,$4,'Empresa B','00.000.000/0001-91','CNPJ','empresa','02','01','ativa','teste')`,
      [entityA, groupA, entityB, groupB]
    );
    await pool.query(`UPDATE company_entities SET implantacao_pendente = false WHERE id IN ($1,$2)`, [entityA, entityB]);
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'TT A','STARTER','active',$5,'teste'), ($3,$4,'TT B','STARTER','active',$6,'teste')`,
      [tenantA, groupA, tenantB, groupB, users.ownerA.email, users.ownerB.email]
    );
    for (const user of Object.values(users)) {
      await pool.query(`INSERT INTO users (id, email, password_hash, full_name, role, status, created_by) VALUES ($1,$2,'x',$2,$3,'active','teste')`, [user.id, user.email, user.role]);
      await pool.query(
        `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,$5,$6,'teste')`,
        [`tu_${user.id}`, user.tenant, user.group, user.email, user.tenantRole, user.noTax ? {} : { tax: true }]
      );
    }
    await pool.query(
      `INSERT INTO natures (id, group_id, entity_id, codigo, descricao, status, created_by)
       VALUES ($1,$2,$3,'2201','Tributos parcelados','ativo','teste')`,
      [randomUUID(), groupA, entityA]
    );
    await pool.query(
      `INSERT INTO integrations (id, code, nome, erp_nome, base_url, auth_type, status, group_id, created_by)
       VALUES ($1,$2,'Protheus de teste','Protheus',$3,'none','ativo',$4,'teste')`,
      [integrationA, `tt_${suffix}`, `http://127.0.0.1:${fake.server.address().port}`, groupA]
    );
    await pool.query(
      `INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key)
       VALUES ($1,'Títulos a pagar','POST','/FinRestTitulos/pagar','titulos_pagar'), ($1,'Empresas','GET','/sm0','empresas')`,
      [integrationA]
    );
    await pool.query(
      `INSERT INTO tax_agreements (id, group_id, entity_id, esfera, orgao, modalidade, codigo_parcelamento, created_by)
       VALUES ($1,$2,$3,'federal','Receita Federal','Simplificado','PARC-TT1','teste'),
              ($4,$2,$3,'federal','PGFN','Transação','PARC-TT2','teste'),
              ($5,$6,$7,'federal','PGFN','Transação','PARC-B','teste')`,
      [agreementA, groupA, entityA, agreementA2, agreementB, groupB, entityB]
    );
    const rows = [
      [inst.a1, agreementA, 1, "2026-03-31"], [inst.a2, agreementA, 2, "2026-04-30"], [inst.a3, agreementA, 3, "2026-05-29"],
      [inst.a4, agreementA, 4, "2026-06-30"], [inst.a5, agreementA, 5, "2026-07-31"], [inst.a6, agreementA, 6, "2026-08-31"],
      [inst.a7, agreementA, 7, "2026-09-30"], [inst.a8, agreementA, 8, "2026-10-30"], [inst.a9, agreementA, 9, "2026-11-30"], [inst.a10, agreementA, 10, "2026-12-30"],
      [inst.a11, agreementA, 11, "2027-01-29"], [inst.a12, agreementA, 12, "2027-02-26"], [inst.a13, agreementA, 13, "2027-03-31"], [inst.a14, agreementA, 14, "2027-04-30"], [inst.a15, agreementA, 15, "2027-05-31"],
      [inst.r1, agreementA2, 1, "2026-03-31"],
    ];
    for (const [id, agreement, n, due] of rows) {
      await pool.query(
        `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor, created_by) VALUES ($1,$2,$3,$4,$5,500,'teste')`,
        [id, groupA, agreement, n, due]
      );
    }
    await pool.query(
      `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor, created_by) VALUES ($1,$2,$3,1,'2026-03-31',300,'teste')`,
      [inst.b1, groupB, agreementB]
    );
    // Título de empréstimo do mesmo cliente (prefixo EMP): as rotinas dos empréstimos rodam ao lado dele.
    const bank = await pool.query(`SELECT id FROM banks ORDER BY created_date ASC LIMIT 1`);
    await pool.query(
      `INSERT INTO loan_contracts (id, group_id, entity_id, bank_id, contract_number, status, created_by) VALUES ($1,$2,$3,$4,'TT1','rascunho','teste')`,
      [contractA, groupA, entityA, bank.rows[0].id]
    );
    await pool.query(
      `INSERT INTO payable_titles (id, group_id, entity_id, contract_id, parcela, titulo_numero, valor, saldo, status, created_by)
       VALUES ($1,$2,$3,$4,'001','000000077',10,10,'aberto','teste')`,
      [loanTitle, groupA, entityA, contractA]
    );
    // Prefixo próprio já usado num título de empréstimo do cliente (além dos fixos EMP/FIN/JUR/IOF).
    await pool.query(
      `INSERT INTO payable_titles (id, group_id, entity_id, contract_id, parcela, titulo_numero, valor, saldo, status, prefixo, created_by)
       VALUES ($1,$2,$3,$4,'002','000000078',10,10,'aberto','XPT','teste')`,
      [`${loanTitle}_x`, groupA, entityA, contractA]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  const token = (user) => issueAuthResponse(
    { id: user.id, email: user.email, full_name: user.email, role: user.role, platform_admin: false },
    { id: user.tenant, group_id: user.group, tenant_name: "Teste", tenant_role: user.tenantRole, billing_status: "active", plan: "STARTER" }
  ).token;
  const tA = token(users.ownerA);
  const tB = token(users.ownerB);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const call = (t, method, path, body) => jsonRequest(server, { method, path, body, token: t });
  const scopeA = { userId: users.ownerA.id, groupId: groupA, tenantId: tenantA, email: users.ownerA.email, role: "admin", tenantRole: "OWNER", permissions: { tax: true } };
  const asA = (fn) => runWithTenant(scopeA, fn);
  const titleOf = async (installmentId) => (await pool.query(`SELECT *, valor::float8 AS valor_n, vencimento::text AS venc FROM tax_payable_titles WHERE installment_id = $1`, [installmentId])).rows[0] || null;
  const callsOf = (op) => fake.state.calls.filter((c) => c.op === op);
  const resetCalls = () => { fake.state.calls = []; };
  const attach = async (installmentId, line, extra = {}) => {
    const res = await call(tA, "POST", `/api/tax/installments/${installmentId}/guide`, { linha_digitavel: line, ...extra });
    await settleTaxTitleSyncs();
    return res;
  };
  const setParam = (key, value) => call(tA, "PATCH", `/api/parameters/${key}`, { value });


  try {
    // ---- Sem configuração: o título nasce pendente com o motivo, nada vai ao Protheus ----
    const line1 = makeLine(123456, "1001"); // R$ 1.234,56 (diferente dos R$ 500 da parcela)
    check((await attach(inst.a1, line1, { pagar_ate: "2026-03-25" })).status === 201, "anexar guia da parcela 1");
    let t1 = await titleOf(inst.a1);
    check(t1?.situacao === "pendente" && t1.motivo === "Informe o fornecedor dos tributos federais em Configurações > Lógica Contábil.", `sem fornecedor: ${t1?.situacao} ${t1?.motivo}`);
    check(callsOf("incluir").length === 0, "sem configuração nada é enviado");
    check(/^\d{9}$/.test(t1?.numero_e2 || "") && t1.parcela_e2 === "01", `chave do SE2: ${t1?.numero_e2}/${t1?.parcela_e2}`);
    // Pendente: dados previstos pela guia vinculada (sem configuração, o que falta vem vazio).
    const pend = (await call(tA, "GET", `/api/tax/payable-titles?installment_id=${inst.a1}`)).json[0];
    check(pend.previsto === true && pend.dados_enviados === false && pend.situacao_label === "Pendente", `pendente marcado como previsto: ${pend.previsto} ${pend.dados_enviados}`);
    check(pend.valor === 1234.56 && pend.vencimento === "2026-03-25" && pend.codigo_barras?.length === 44 && pend.linha_digitavel === line1, `previsto pela guia: ${pend.valor} ${pend.vencimento}`);
    check(pend.historico === "Tributo PARC-TT1 parcela 1" && pend.fornecedor === null && pend.tipo === null && pend.prefixo === null && pend.natureza === null && pend.filial === null && pend.emissao === null, `previsto sem configuração: ${JSON.stringify(pend).slice(0, 200)}`);
    // Pendente sem guia vinculada: nada previsto.
    await attach(inst.a10, makeLine(50000, "1010"));
    await call(tA, "DELETE", `/api/tax/installments/${inst.a10}/guide`);
    await settleTaxTitleSyncs();
    const noGuide = (await call(tA, "GET", `/api/tax/payable-titles?installment_id=${inst.a10}`)).json[0];
    check(noGuide.situacao === "pendente" && noGuide.previsto === true && noGuide.valor === null && noGuide.vencimento === null && noGuide.codigo_barras === null && noGuide.historico === null, `pendente sem guia não inventa dados: ${JSON.stringify(noGuide).slice(0, 200)}`);

    await setParam("finance.tax_suppliers", { federal: { fornecedor: "UNIAO", loja: "00" } });
    await asA(() => processTaxTitle(inst.a1));
    t1 = await titleOf(inst.a1);
    check(t1.situacao === "pendente" && t1.motivo === "Informe o tipo do título de tributo em Configurações > Lógica Contábil.", `sem tipo: ${t1.motivo}`);
    await setParam("finance.tax_title_type", "tx");
    // Prefixo dos empréstimos é barrado ao salvar.
    for (const prefix of ["EMP", "fin", "JUR", "IOF", "XPT"]) {
      const saved = await setParam("finance.tax_title_prefix", prefix);
      check(saved.status === 400 && saved.json?.details?.field === "finance.tax_title_prefix" && saved.json.error.includes("já é usado pelos títulos de empréstimo"), `prefixo ${prefix} barrado ao salvar: ${saved.status} ${JSON.stringify(saved.json)}`);
    }
    const badFormat = await setParam("finance.tax_title_prefix", "TR-B");
    check(badFormat.status === 400 && badFormat.json?.details?.field === "finance.tax_title_prefix", `formato do prefixo: ${badFormat.status}`);
    // A checagem no envio continua (ex.: prefixo gravado antes de existir o título de empréstimo).
    await asA(() => setParameter("finance.tax_title_prefix", "EMP", { scope: "TENANT" }));
    await asA(() => processTaxTitle(inst.a1));
    t1 = await titleOf(inst.a1);
    check(t1.motivo?.startsWith("O prefixo EMP já é usado pelos títulos de empréstimo."), `prefixo dos empréstimos recusado: ${t1.motivo}`);
    await setParam("finance.tax_title_prefix", "TRB");
    await setParam("finance.tax_title_nature", "9999");
    await asA(() => processTaxTitle(inst.a1));
    t1 = await titleOf(inst.a1);
    check(t1.motivo?.startsWith("A natureza 9999 não está no cadastro de naturezas da empresa"), `natureza inexistente: ${t1.motivo}`);
    check(callsOf("incluir").length === 0, "configuração incompleta nunca envia");

    // ---- Nasce com a guia vinculada: valor e código de barras da guia ----
    await setParam("finance.tax_title_nature", "2201");
    await asA(() => processTaxTitle(inst.a1));
    t1 = await titleOf(inst.a1);
    const sent = callsOf("incluir")[0]?.body;
    check(t1.situacao === "enviado" && callsOf("incluir").length === 1, `enviado com confirmação: ${t1.situacao} ${t1.erp_mensagem}`);
    const erpOps = fake.state.calls.filter((c) => ["consultar", "incluir", "extornar"].includes(c.op)).map((c) => c.op).join(",");
    check(erpOps === "consultar,incluir", `primeiro envio consulta a chave antes: ${erpOps}`);
    check(sent?.fornecedor === "UNIAO" && sent.loja === "00", `fornecedor e loja exatos, sem zeros: ${sent?.fornecedor}/${sent?.loja}`);
    check(sent?.prefixo === "TRB" && sent.tipo === "TX" && sent.natureza === "2201" && sent.numero === t1.numero_e2 && sent.parcela === "01", `chave e classificação: ${JSON.stringify(sent)}`);
    check(sent?.valor === 1234.56 && sent.vencimento === "2026-03-25", `valor da guia e pagar até: ${sent?.valor} ${sent?.vencimento}`);
    check(sent?.codBarras?.length === 44 && sent.linhaDigitavel === line1, "código de barras e linha da guia");
    check(sent?.filial === "01" && sent.filOrig === "0101", `filial da empresa: ${sent?.filial} ${sent?.filOrig}`);
    const sentKeys = Object.keys(sent || {}).join(",");
    check(sentKeys === "filial,filOrig,prefixo,numero,parcela,tipo,natureza,fornecedor,loja,emissao,vencimento,valor,historico,moeda,codBarras,linhaDigitavel", `campos do corpo: ${sentKeys}`);
    const parcel1 = (await pool.query(`SELECT situacao, data_pagamento, valor_pago FROM tax_installments WHERE id = $1`, [inst.a1])).rows[0];
    check(parcel1.situacao === "em_aberto" && parcel1.data_pagamento === null && parcel1.valor_pago === null, "a parcela não muda com o título");
    const integrateAudit = await pool.query(`SELECT after_json FROM audit_events WHERE action = 'INTEGRATE' AND resource_type = 'TaxPayableTitle' AND resource_id = $1`, [t1.id]);
    check(integrateAudit.rows.some((r) => r.after_json?.resultado === "confirmado"), "auditoria do envio confirmado");

    // Sem "pagar até": vencimento da parcela.
    resetCalls();
    await attach(inst.a2, makeLine(50000, "2002"));
    check(callsOf("incluir")[0]?.body?.vencimento === "2026-04-30", `sem pagar até usa o vencimento da parcela: ${callsOf("incluir")[0]?.body?.vencimento}`);

    // Chaves únicas: números diferentes por parcela, mesmo prefixo/parcela.
    const numbers = (await pool.query(`SELECT numero_e2 FROM tax_payable_titles WHERE group_id = $1`, [groupA])).rows.map((r) => r.numero_e2);
    check(new Set(numbers).size === numbers.length, `números do SE2 únicos: ${numbers}`);

    // ---- Guia em exceção não gera título ----
    resetCalls();
    await attach(inst.a3, makeLine(50000, "3003"), { pagar_ate: "2026-07-10" }); // fora do mês → exceção
    check((await titleOf(inst.a3)) === null && callsOf("incluir").length === 0, "guia em exceção não gera título");

    // ---- Troca de guia antes do pagamento: estorna (com consulta antes) e envia a nova ----
    resetCalls();
    const line1b = makeLine(130000, "1002");
    await attach(inst.a1, line1b, { substituir: "true", pagar_ate: "2026-03-26" });
    const order = fake.state.calls.map((c) => c.op).join(",");
    check(order === "consultar,extornar,consultar,incluir", `troca de guia: consulta, estorno, consulta antes do reenvio, inclusão: ${order}`);
    t1 = await titleOf(inst.a1);
    check(t1.situacao === "enviado" && t1.valor_n === 1300 && t1.codigo_barras.length === 44, `título com a guia nova: ${t1.situacao} ${t1.valor_n}`);
    check([...fake.state.se2.values()].filter((r) => r.numero === t1.numero_e2).length === 1, "só a guia nova está no SE2");

    // ---- Remoção da guia: estorna ----
    resetCalls();
    await call(tA, "DELETE", `/api/tax/installments/${inst.a2}/guide`);
    await settleTaxTitleSyncs();
    const t2 = await titleOf(inst.a2);
    check(t2.situacao === "estornado" && callsOf("extornar").length === 1 && callsOf("consultar").length === 1, `guia removida: ${t2.situacao}`);

    // ---- Depois de pago no Protheus, trocar ou remover a guia não mexe no título ----
    const keyA1 = [...fake.state.se2.entries()].find(([, r]) => r.numero === t1.numero_e2)[0];
    fake.state.se2.get(keyA1).situacao = "baixado";
    fake.state.se2.get(keyA1).saldo = 0;
    const consulted = await asA(() => consultTaxTitle(t1.id));
    check(consulted.situacao === "baixado" && consulted.saldo === 0, `consulta da baixa: ${consulted.situacao}`);
    const parcelAfterPay = (await pool.query(`SELECT situacao FROM tax_installments WHERE id = $1`, [inst.a1])).rows[0];
    check(parcelAfterPay.situacao === "em_aberto", "baixa no Protheus não muda a parcela");
    resetCalls();
    await attach(inst.a1, makeLine(140000, "1003"), { substituir: "true" });
    await call(tA, "DELETE", `/api/tax/installments/${inst.a1}/guide`);
    await settleTaxTitleSyncs();
    check(callsOf("extornar").length === 0 && callsOf("incluir").length === 0 && (await titleOf(inst.a1)).situacao === "baixado", "título pago não muda com troca/remoção da guia");

    // ---- Respostas ambíguas na inclusão: incerto; antes de reenviar, consulta ----
    for (const mode of ["html", "sem_chave"]) {
      fake.state.se2.clear();
      resetCalls();
      fake.state.include = mode;
      const installment = mode === "html" ? inst.a4 : inst.a5;
      await attach(installment, makeLine(50000, mode === "html" ? "4004" : "5005"));
      const uncertain = await titleOf(installment);
      check(uncertain.situacao === "incerto", `inclusão ${mode}: incerto, veio ${uncertain.situacao}`);
      fake.state.include = "ok";
      resetCalls();
      await asA(() => processTaxTitle(installment));
      // O fake gravou o título antes de responder mal: a consulta acha e não há segundo envio.
      check(callsOf("consultar").length === 1 && callsOf("incluir").length === 0 && (await titleOf(installment)).situacao === "enviado", `${mode}: consulta achou, sem reenviar`);
    }

    // ---- Recusa explícita do Protheus: "recusado", sem reenvio pelo agendador ----
    fake.state.include = "error400";
    resetCalls();
    await attach(inst.a8, makeLine(50000, "8001"));
    let t8 = await titleOf(inst.a8);
    check(t8.situacao === "recusado" && t8.erp_mensagem === "FINA050 recusou o titulo a pagar. Natureza bloqueada", `recusa explícita: ${t8.situacao} ${t8.erp_mensagem}`);
    resetCalls();
    await asA(() => syncTaxTitles());
    await asA(() => consultTaxTitles());
    await asA(() => processTaxTitle(inst.a8));
    check(!fake.state.calls.some((c) => c.body?.numero === t8.numero_e2), "agendador e processamento comum não reenviam o recusado");
    check((await titleOf(inst.a8)).situacao === "recusado", "continua recusado");
    // Botão "Integrar": consulta antes e tenta de novo; recusado de novo, um envio só.
    const view8 = (await call(tA, "GET", `/api/tax/payable-titles?installment_id=${inst.a8}`)).json[0];
    check(view8.situacao_label === "Recusado pelo Protheus" && view8.pode_integrar === true && view8.pode_consultar === true, `recusado na tela: ${view8.situacao_label} ${view8.pode_integrar}`);
    resetCalls();
    const retry = await call(tA, "POST", `/api/tax/payable-titles/${t8.id}/integrate`);
    check(retry.status === 200 && retry.json.situacao === "recusado" && fake.state.calls.map((c) => c.op).join(",") === "consultar,incluir", `botão tenta de novo com consulta antes: ${fake.state.calls.map((c) => c.op)}`);
    // Mudança de parâmetro do envio: tenta de novo em segundo plano.
    fake.state.include = "ok";
    resetCalls();
    await setParam("finance.tax_title_nature", "2201");
    await settleTaxTitleSyncs();
    t8 = await titleOf(inst.a8);
    check(t8.situacao === "enviado" && fake.state.calls.map((c) => c.op).join(",") === "consultar,incluir", `parâmetro mudou: reenviou com consulta antes: ${t8.situacao} ${fake.state.calls.map((c) => c.op)}`);
    // Recusa que veio depois de o título entrar (o FinRestTitulos responde erro mesmo com o título no SE2):
    // ao tentar de novo, a consulta acha e não há segundo envio.
    fake.state.include = "error400_after";
    resetCalls();
    await attach(inst.a9, makeLine(50000, "9001"));
    const t9 = await titleOf(inst.a9);
    check(t9.situacao === "recusado", `recusa com título gravado: ${t9.situacao}`);
    fake.state.include = "ok";
    resetCalls();
    await call(tA, "POST", `/api/tax/payable-titles/${t9.id}/integrate`);
    check(callsOf("incluir").length === 0 && (await titleOf(inst.a9)).situacao === "enviado", "recusado que entrou: consulta acha, sem reenviar");
    // Erro sem o formato do FinRestTitulos (HTTP 500 com HTML) não é recusa: é falta de confirmação.
    await call(tA, "DELETE", `/api/tax/installments/${inst.a9}/guide`);
    await settleTaxTitleSyncs();
    fake.state.include = "error500_html";
    await attach(inst.a9, makeLine(50000, "9002"));
    check((await titleOf(inst.a9)).situacao === "incerto", `HTTP 500 sem formato de recusa: incerto, veio ${(await titleOf(inst.a9)).situacao}`);
    fake.state.include = "ok";
    await asA(() => processTaxTitle(inst.a9));

    // ---- Sem resposta (rede caiu depois de gravar) → incerto → consulta acha → não reenvia ----
    fake.state.include = "drop_after";
    resetCalls();
    await attach(inst.a6, makeLine(50000, "6006"));
    check((await titleOf(inst.a6)).situacao === "incerto", "rede caiu depois de gravar: incerto");
    fake.state.include = "ok";
    resetCalls();
    await asA(() => processTaxTitle(inst.a6));
    check(callsOf("incluir").length === 0 && (await titleOf(inst.a6)).situacao === "enviado", "não reenvia no escuro: a consulta achou");

    // ---- Sem resposta (rede caiu antes de gravar) → incerto → consulta prova ausência → reenvia ----
    fake.state.include = "drop_before";
    resetCalls();
    await attach(inst.a7, makeLine(50000, "7007"));
    check((await titleOf(inst.a7)).situacao === "incerto", "rede caiu antes de gravar: incerto");
    fake.state.include = "ok";
    fake.state.consult = "html";
    resetCalls();
    await asA(() => processTaxTitle(inst.a7));
    check(callsOf("incluir").length === 0 && (await titleOf(inst.a7)).situacao === "incerto", "consulta inconclusiva: continua incerto, sem reenviar");
    fake.state.consult = "ok";
    resetCalls();
    await asA(() => processTaxTitle(inst.a7));
    check(fake.state.calls.map((c) => c.op).join(",") === "consultar,incluir" && (await titleOf(inst.a7)).situacao === "enviado", `consulta provou ausência e reenviou: ${fake.state.calls.map((c) => c.op)}`);

    // ---- Consulta "não encontrado" de título integrado: conferência, nunca apaga ----
    const t6 = await titleOf(inst.a6);
    fake.state.se2.delete([...fake.state.se2.entries()].find(([, r]) => r.numero === t6.numero_e2)[0]);
    const summary = await asA(() => consultTaxTitles());
    const t6b = await titleOf(inst.a6);
    check(t6b && t6b.situacao === "conferencia" && summary.conferencia >= 1, `não encontrado vira conferência: ${t6b?.situacao}`);
    resetCalls();
    await asA(() => processTaxTitle(inst.a6));
    check(fake.state.calls.length === 0, "título em conferência não é mexido pelo processamento");
    // Troca de guia com título em conferência: nada vai ao Protheus até alguém conferir.
    await attach(inst.a6, makeLine(60000, "6007"), { substituir: "true" });
    check(callsOf("incluir").length === 0 && (await titleOf(inst.a6)).situacao === "conferencia", "conferência segura a troca de guia");
    await asA(() => confirmTaxTitleAbsence(t6.id));
    await settleTaxTitleSyncs();
    const t6c = await titleOf(inst.a6);
    check(t6c.situacao === "enviado" && t6c.valor_n === 600, `ausência confirmada: reenvia com a guia atual: ${t6c.situacao} ${t6c.valor_n}`);

    // ---- Estorno exige consulta conclusiva antes ----
    fake.state.consult = "html";
    resetCalls();
    await call(tA, "DELETE", `/api/tax/installments/${inst.a7}/guide`);
    await settleTaxTitleSyncs();
    check(callsOf("extornar").length === 0 && (await titleOf(inst.a7)).situacao === "enviado", "sem consulta conclusiva, não estorna");
    fake.state.consult = "ok";
    // Estorno sem resposta: continua "enviado"; a consulta seguinte não acha → conferência (não vira estornado sozinho).
    fake.state.reverse = "drop_after";
    resetCalls();
    await asA(() => processTaxTitle(inst.a7));
    check((await titleOf(inst.a7)).situacao === "enviado", "estorno sem resposta não vira estornado");
    fake.state.reverse = "ok";
    await asA(() => processTaxTitle(inst.a7));
    check((await titleOf(inst.a7)).situacao === "conferencia", "consulta prévia sem o título: conferência, nunca estornado automático");

    // ---- Concorrência: duas sincronizações ao mesmo tempo, um envio só ----
    fake.state.includeDelayMs = 300;
    resetCalls();
    await call(tA, "POST", `/api/tax/installments/${inst.a2}/guide`, { linha_digitavel: makeLine(70000, "2003"), substituir: "true" });
    await Promise.all([asA(() => processTaxTitle(inst.a2)), asA(() => processTaxTitle(inst.a2)), settleTaxTitleSyncs()]);
    await settleTaxTitleSyncs();
    fake.state.includeDelayMs = 0;
    check(callsOf("incluir").length === 1 && (await titleOf(inst.a2)).situacao === "enviado", `um envio por vez: ${callsOf("incluir").length}`);
    const busyTitle = await titleOf(inst.a2);
    await pool.query(`UPDATE tax_payable_titles SET trava_ate = now() + interval '1 minute', trava_por = 'teste' WHERE id = $1`, [busyTitle.id]);
    const busy = await call(tA, "POST", `/api/tax/payable-titles/${busyTitle.id}/integrate`);
    check(busy.status === 409 && busy.json?.code === "TAX_TITLE_BUSY", `botão com título ocupado: ${busy.status} ${busy.json?.code}`);
    await pool.query(`UPDATE tax_payable_titles SET trava_ate = NULL, trava_por = NULL WHERE id = $1`, [busyTitle.id]);

    // ---- Exclusão: estorno confirmado antes; sem confirmação, barrada ----
    fake.state.reverse = "error400";
    resetCalls();
    const blocked = await call(tA, "DELETE", `/api/entities/TaxInstallment/${inst.a2}`);
    check(blocked.status === 409 && blocked.json?.code === "TAX_TITLE_BLOCKS_DELETION" && blocked.json.details?.motivos?.[0]?.includes("parcela 2"), `exclusão barrada sem estorno: ${blocked.status} ${JSON.stringify(blocked.json)}`);
    check((await pool.query(`SELECT 1 FROM tax_installments WHERE id = $1`, [inst.a2])).rows.length === 1 && (await titleOf(inst.a2)).situacao === "enviado", "nada foi excluído");
    // A guarda do banco vale mesmo sem passar pelo estorno antes (ex.: título enviado entre a conferência e a exclusão).
    const direct = await asA(() => deleteInstallmentWithGuides(inst.a2).then(() => null, (error) => error));
    check(direct?.details?.motivos?.[0]?.includes("parcela 2"), `motivo por parcela na guarda do banco: ${JSON.stringify(direct?.details)}`);
    check(direct?.code === "TAX_TITLE_BLOCKS_DELETION" && (await pool.query(`SELECT 1 FROM tax_installments WHERE id = $1`, [inst.a2])).rows.length === 1, `exclusão direta com título no Protheus é barrada: ${direct?.code}`);
    fake.state.reverse = "ok";
    const removed = await call(tA, "DELETE", `/api/entities/TaxInstallment/${inst.a2}`);
    check(removed.status === 200 && (await titleOf(inst.a2)) === null, `exclusão com estorno confirmado: ${removed.status}`);
    check(![...fake.state.se2.values()].some((r) => r.numero === busyTitle.numero_e2), "título saiu do Protheus antes da parcela");
    const paidDelete = await call(tA, "DELETE", `/api/entities/TaxInstallment/${inst.a1}`);
    check(paidDelete.status === 409 && paidDelete.json.error.includes("já foi pago"), `parcela com título pago não é excluída: ${paidDelete.status}`);
    const conferenceDelete = await call(tA, "DELETE", `/api/entities/TaxInstallment/${inst.a7}`);
    check(conferenceDelete.status === 409, "título em conferência barra a exclusão");

    // ---- Parcelamento rescindido: estorna antes do pagamento ----
    await attach(inst.r1, makeLine(80000, "8008"));
    check((await titleOf(inst.r1)).situacao === "enviado", "título do segundo parcelamento enviado");
    resetCalls();
    await call(tA, "PATCH", `/api/entities/TaxAgreement/${agreementA2}`, { situacao: "rescindido" });
    await settleTaxTitleSyncs();
    check((await titleOf(inst.r1)).situacao === "estornado" && callsOf("extornar").length === 1, "parcelamento rescindido estorna o título");

    // ---- Chave já existente no Protheus antes do primeiro envio: não adota, vai para conferência ----
    resetCalls();
    const t10 = await titleOf(inst.a10);
    const alienKey = ["01", "TRB", t10.numero_e2, "01", "TX", "UNIAO", "00"].join("|");
    fake.state.se2.set(alienKey, { filial: "01", prefixo: "TRB", numero: t10.numero_e2, parcela: "01", tipo: "TX", fornecedor: "UNIAO", loja: "00", valor: 500, saldo: 500, historico: "lancamento manual", situacao: "aberto" });
    await attach(inst.a10, makeLine(50000, "1011"));
    const t10b = await titleOf(inst.a10);
    check(t10b.situacao === "conferencia" && callsOf("incluir").length === 0 && t10b.motivo.includes("Já existe no Protheus um título com a chave"), `chave alheia: ${t10b.situacao} ${t10b.motivo}`);
    check(fake.state.se2.get(alienKey).historico === "lancamento manual", "título alheio (mesma chave e mesmo valor) intacto e não adotado");
    // A tela recebe os dados como os que SERIAM enviados: nada foi enviado.
    const alienView = (await call(tA, "GET", `/api/tax/payable-titles?installment_id=${inst.a10}`)).json[0];
    check(alienView.situacao === "conferencia" && alienView.dados_enviados === false && alienView.previsto === true, `conferência antes do envio: previsto ${alienView.previsto}, enviados ${alienView.dados_enviados}`);
    check(alienView.numero === t10.numero_e2 && alienView.valor === 500 && alienView.prefixo === "TRB" && alienView.saldo === null, `dados que seriam enviados: ${alienView.valor} ${alienView.prefixo} ${alienView.saldo}`);
    // Consulta manual e consulta de todos não adotam a chave alheia: continua em conferência, sem dados enviados.
    resetCalls();
    const manual = await asA(() => consultTaxTitle(t10.id));
    check(manual.situacao === "conferencia" && manual.dados_enviados === false && manual.motivo.includes("não foi enviado pelo AllDebt"), `consulta manual não adota a chave alheia: ${manual.situacao} ${manual.dados_enviados}`);
    await call(tA, "POST", "/api/tax/payable-titles/consult");
    const afterAll = await titleOf(inst.a10);
    check(afterAll.situacao === "conferencia" && afterAll.dados_enviados === false, `consulta de todos não adota a chave alheia: ${afterAll.situacao}`);
    // Nem a troca de guia, nem o agendador, nem a exclusão mexem no título alheio.
    await attach(inst.a10, makeLine(50500, "1012"), { substituir: "true" });
    await asA(() => syncTaxTitles());
    const blockedAlien = await call(tA, "DELETE", `/api/entities/TaxInstallment/${inst.a10}`);
    check(blockedAlien.status === 409 && callsOf("extornar").length === 0 && callsOf("incluir").length === 0 && fake.state.se2.has(alienKey), `nada estorna nem inclui sobre a chave alheia: ${blockedAlien.status} ${fake.state.calls.map((c) => c.op)}`);
    check((await titleOf(inst.a10)).situacao === "conferencia", "continua em conferência");
    // Resolvido no Protheus (o lançamento alheio saiu) e ausência confirmada: o envio seguinte marca os dados como enviados.
    fake.state.se2.delete(alienKey);
    await call(tA, "POST", `/api/tax/payable-titles/${t10.id}/confirm-absence`);
    await settleTaxTitleSyncs();
    const resent10 = (await call(tA, "GET", `/api/tax/payable-titles?installment_id=${inst.a10}`)).json[0];
    check(resent10.situacao === "enviado" && resent10.dados_enviados === true && resent10.previsto === false, `reenviado depois da conferência: ${resent10.situacao} ${resent10.dados_enviados}`);
    const sentView = (await call(tA, "GET", `/api/tax/payable-titles?installment_id=${inst.a4}`)).json[0];
    check(sentView.dados_enviados === true && sentView.previsto === false, "título enviado: dados enviados");

    // ---- Achado em outra filial ou com outro valor: conferência, nunca integrado/estornado ----
    const t8now = await titleOf(inst.a8);
    check(t8now.situacao === "enviado", `título da parcela 8 integrado: ${t8now.situacao}`);
    fake.state.consultPatch = { filial: "03" };
    const branch = await asA(() => consultTaxTitle(t8now.id));
    check(branch.situacao === "conferencia" && branch.motivo.includes("outra filial"), `outra filial: ${branch.situacao} ${branch.motivo}`);
    fake.state.consultPatch = { valor: 55.5 };
    const t5now = await titleOf(inst.a5);
    resetCalls();
    await call(tA, "DELETE", `/api/tax/installments/${inst.a5}/guide`);
    await settleTaxTitleSyncs();
    const t5b = await titleOf(inst.a5);
    check(t5b.situacao === "conferencia" && t5b.motivo.includes("outro valor") && callsOf("extornar").length === 0, `outro valor: não estorna: ${t5b.situacao} ${t5b.motivo}`);
    check(t5now.situacao === "enviado", "antes estava integrado");
    fake.state.consultPatch = null;

    // ---- Trava renovada a cada passo: perdida no meio, para sem estornar ----
    await attach(inst.a11, makeLine(50000, "1111"));
    check((await titleOf(inst.a11)).situacao === "enviado", "título da parcela 11 integrado");
    fake.state.consultDelayMs = 400;
    resetCalls();
    await call(tA, "POST", `/api/tax/installments/${inst.a11}/guide`, { linha_digitavel: makeLine(51000, "1112"), substituir: "true" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const t11 = await titleOf(inst.a11);
    await pool.query(`UPDATE tax_payable_titles SET trava_por = 'outra-operacao', trava_ate = now() + interval '1 minute' WHERE id = $1`, [t11.id]);
    await settleTaxTitleSyncs();
    fake.state.consultDelayMs = 0;
    check(callsOf("extornar").length === 0 && (await titleOf(inst.a11)).situacao === "enviado", `trava perdida: não estornou: ${fake.state.calls.map((c) => c.op)}`);
    await pool.query(`UPDATE tax_payable_titles SET trava_por = NULL, trava_ate = NULL WHERE id = $1`, [t11.id]);
    await asA(() => processTaxTitle(inst.a11));
    check((await titleOf(inst.a11)).valor_n === 510, "depois, com a trava livre, segue o processamento");

    // ---- SM0 lida uma vez por execução do agendador ----
    await asA(() => setParameter("finance.tax_title_type", "", { scope: "TENANT" }));
    await attach(inst.a12, makeLine(50000, "1212"));
    await attach(inst.a13, makeLine(50000, "1313"));
    check((await titleOf(inst.a12)).situacao === "pendente" && (await titleOf(inst.a13)).situacao === "pendente", "dois títulos esperando o tipo");
    await asA(() => setParameter("finance.tax_title_type", "TX", { scope: "TENANT" }));
    fake.state.gets = 0;
    await asA(() => syncTaxTitles());
    const batchGets = fake.state.gets;
    check((await titleOf(inst.a12)).situacao === "enviado" && (await titleOf(inst.a13)).situacao === "enviado", "lote enviou os dois");
    fake.state.gets = 0;
    await call(tA, "POST", `/api/tax/payable-titles/${(await titleOf(inst.a13)).id}/integrate`);
    check(batchGets > 0, `o lote lê a SM0: ${batchGets}`);
    await call(tA, "DELETE", `/api/tax/installments/${inst.a13}/guide`);
    await settleTaxTitleSyncs();
    fake.state.gets = 0;
    await attach(inst.a13, makeLine(52000, "1314"));
    const singleGets = fake.state.gets;
    check(singleGets > 0 && batchGets === singleGets, `lote com dois envios lê a SM0 uma vez só: lote ${batchGets}, um envio ${singleGets}`);

    // ---- Consulta antes do primeiro envio inconclusiva: não envia ----
    fake.state.consult = "html";
    resetCalls();
    await attach(inst.a14, makeLine(50000, "1414"));
    const t14 = await titleOf(inst.a14);
    check(callsOf("incluir").length === 0 && t14.situacao === "pendente" && t14.motivo.includes("Não foi possível confirmar no Protheus que a chave"), `consulta inconclusiva antes do envio: ${t14.situacao} ${t14.motivo}`);
    fake.state.consult = "ok";
    await asA(() => processTaxTitle(inst.a14));
    check((await titleOf(inst.a14)).situacao === "enviado", "com a consulta de volta, envia");

    // ---- Sem confirmação que, na consulta, aparece com outro valor: conferência, contada como divergente ----
    fake.state.include = "drop_after";
    await attach(inst.a15, makeLine(50000, "1515"));
    fake.state.include = "ok";
    const t15 = await titleOf(inst.a15);
    check(t15.situacao === "incerto", `parcela 15 sem confirmação: ${t15.situacao}`);
    const stored15 = [...fake.state.se2.values()].find((r) => r.numero === t15.numero_e2);
    stored15.valor = 1;
    const all15 = await call(tA, "POST", "/api/tax/payable-titles/consult");
    check(all15.json?.por_resultado?.divergente >= 1 && (await titleOf(inst.a15)).situacao === "conferencia", `incerto divergente contado como divergente: ${JSON.stringify(all15.json?.por_resultado)}`);
    const view15 = (await call(tA, "GET", `/api/tax/payable-titles?installment_id=${inst.a15}`)).json[0];
    check(view15.dados_enviados === true && view15.previsto === false, "incerto que foi enviado: dados enviados, mesmo em conferência");

    // ---- Agendador ----
    const job = await asA(() => syncTaxTitles());
    check(typeof job.total === "number", "tarefa de integração roda");

    // ---- Isolamento entre clientes ----
    const listB = await call(tB, "GET", "/api/tax/payable-titles");
    check(Array.isArray(listB.json) && listB.json.length === 0, "cliente B não vê títulos do A");
    const t4 = await titleOf(inst.a4);
    for (const [method, path] of [["POST", `/api/tax/payable-titles/${t4.id}/integrate`], ["POST", `/api/tax/payable-titles/${t4.id}/consult`], ["POST", `/api/tax/payable-titles/${t4.id}/confirm-absence`]]) {
      const res = await call(tB, method, path);
      check(res.status === 404, `cliente B em título do A ${path}: ${res.status}`);
    }
    const listA = await call(tA, "GET", "/api/tax/payable-titles");
    check(Array.isArray(listA.json) && listA.json.every((t) => t.origem === "tributo") && listA.json.some((t) => t.id === t4.id), "Contas a Pagar do A lista os títulos de tributo");
    const guideView = await call(tA, "GET", `/api/tax/installments/${inst.a4}/guide`);
    check(guideView.json?.titulo_pagar?.situacao === t4.situacao && guideView.json.titulo_pagar.numero === t4.numero_e2 && guideView.json.titulo_pagar.codigo_parcelamento === "PARC-TT1" && guideView.json.titulo_pagar.numero_parcela === 4, `a parcela mostra o título: ${guideView.json?.titulo_pagar?.situacao} ${guideView.json?.titulo_pagar?.codigo_parcelamento}`);

    // ---- Módulo e perfil ----
    const tAdmin = token(users.adminA);
    for (const path of [`/api/tax/payable-titles/${t4.id}/integrate`, `/api/tax/payable-titles/${t4.id}/confirm-absence`]) {
      const res = await call(tAdmin, "POST", path);
      check(res.status === 403 && res.json?.code === "OWNER_REQUIRED", `só o proprietário integra/confirma ausência ${path}: ${res.status} ${res.json?.code}`);
    }
    const adminConsult = await call(tAdmin, "POST", `/api/tax/payable-titles/${t4.id}/consult`);
    check(adminConsult.status === 200 && adminConsult.json?.id === t4.id, `quem escreve consulta: ${adminConsult.status}`);
    const all = await call(tAdmin, "POST", "/api/tax/payable-titles/consult");
    const counted = Object.values(all.json?.por_resultado || {}).reduce((sum, n) => sum + n, 0);
    check(all.status === 200 && all.json.total > 0 && counted === all.json.total && all.json.por_resultado.encontrado > 0, `consultar todos: ${all.status} ${JSON.stringify(all.json)}`);
    for (const path of [`/api/tax/payable-titles/${t4.id}/consult`, "/api/tax/payable-titles/consult", `/api/tax/payable-titles/${t4.id}/confirm-absence`]) {
      const res = await call(token(users.viewerA), "POST", path);
      check(res.status === 403 && res.json?.code === "READ_ONLY", `visualizador barrado ${path}: ${res.status}`);
    }
    const allB = await call(tB, "POST", "/api/tax/payable-titles/consult");
    check(allB.status === 200 && allB.json.total === 0, "consultar todos só vê o próprio cliente");
    const viewer = await call(token(users.viewerA), "POST", `/api/tax/payable-titles/${t4.id}/integrate`);
    check(viewer.status === 403 && viewer.json?.code === "READ_ONLY", `visualizador não integra: ${viewer.status}`);
    const noTax = await call(token(users.noTaxA), "GET", "/api/tax/payable-titles");
    check(noTax.status === 403 && noTax.json?.code === "MODULE_FORBIDDEN", "sem o módulo não vê");

    // ---- As rotinas dos empréstimos não alcançam o título de tributo ----
    const taxSnapshot = async () => JSON.stringify((await pool.query(`SELECT * FROM tax_payable_titles WHERE group_id = $1 ORDER BY id`, [groupA])).rows);
    const before = await taxSnapshot();
    resetCalls();
    const ready = await asA(() => listReadyPayableTitles());
    check(ready.every((r) => r.id !== t4.id), "lista de prontos para integrar é só de empréstimo");
    const loanRoutines = [
      ["cleanupOrphanedPayableTitles", () => runWithTenant({ ...scopeA, platformAdmin: true }, () => cleanupOrphanedPayableTitles({}))],
      ["syncPayableTitlesFromApprovedContracts", () => asA(() => syncPayableTitlesFromApprovedContracts())],
      ["autoIntegratePayableTitles", () => asA(() => autoIntegratePayableTitles())],
      ["refreshPayableTitlesFromErp", () => asA(() => refreshPayableTitlesFromErp({ force: true, staleMinutes: 0 }))],
      ["convertPayablePrToTx", () => asA(() => convertPayablePrToTx())],
      ["classifyPayableTitles", () => asA(() => classifyPayableTitles({ ids: [loanTitle] }))],
    ];
    for (const [, routine] of loanRoutines) {
      try { await routine(); } catch { /* a rotina pode recusar o cenário de teste; o que importa é o título de tributo */ }
    }
    check((await taxSnapshot()) === before, "rotinas dos empréstimos não mexem no título de tributo");
    check(!fake.state.calls.some((c) => c.body?.prefixo === "TRB"), "rotinas dos empréstimos não mandam nada do título de tributo ao Protheus");
    const loanList = await call(tA, "GET", "/api/entities/PayableTitle?limit=1000");
    check(Array.isArray(loanList.json) && !loanList.json.some((t) => t.prefixo === "TRB"), "CRUD de PayableTitle não lista título de tributo");
  } finally {
    await settleTaxTitleSyncs();
    server.close();
    fake.server.close();
    await pool.query(`DELETE FROM tax_payable_titles WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM tax_agreements WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM payable_titles WHERE id = ANY($1::text[])`, [[loanTitle, `${loanTitle}_x`]]);
    await pool.query(`DELETE FROM loan_contracts WHERE id = $1`, [contractA]);
    await pool.query(`DELETE FROM natures WHERE group_id = $1`, [groupA]);
    await pool.query(`DELETE FROM integrations WHERE id = $1`, [integrationA]);
    await pool.query(`DELETE FROM system_parameters WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM tenant_users WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(users).map((u) => u.id)]);
    await pool.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [tenantA, tenantB]);
    await pool.query(`DELETE FROM company_entities WHERE id IN ($1,$2)`, [entityA, entityB]);
    await pool.query(`DELETE FROM groups WHERE id IN ($1,$2)`, [groupA, groupB]).catch(() => {});
  }

  if (failures.length) {
    console.error(`títulos de tributo: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log(`títulos de tributo ok (TZ=${process.env.TZ || "padrão"})`);
  await pool.end();
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  for (const message of failures) console.error(` - ${message}`);
  pool.end().finally(() => process.exit(1));
});
