import net from "node:net";
import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { config } from "../../config.js";
import { runWithTenant } from "../tenants/access.js";
import { updateMyPreferences } from "../preferences/service.js";
import { TASK_KEYS } from "../schedules/tasks.js";
import { addDays } from "./brazilClock.js";
import { ALERT_FROM_HOUR, DUE_SOON_DAYS, MAX_ALERT_ATTEMPTS, runTaxAlerts } from "./alerts.js";
import { buildTaxAlertEmail } from "./alertEmail.js";
import { buildGuideEmail } from "./guideEmail.js";
import { escapeHtml } from "./html.js";

// Alertas diários da Gestão Tributária por e-mail, contra um SMTP de teste local (nada sai da máquina): conteúdo
// (vencidas, a vencer em 7 dias, guia pendente), só com algo a avisar, opt-out, um resumo por usuário e dia mesmo
// rodando duas vezes (inclusive ao mesmo tempo), sem SMTP, recusa do servidor, limite de tentativas e isolamento.
// O dia é fixado pelo `now` passado à rotina; as parcelas são datadas a partir dele.

process.exitCode = 1;
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
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

function decodedSubject(data) {
  const header = /^Subject: (.*(?:\r\n[ \t].*)*)/m.exec(data)?.[1] || "";
  return header.replace(/\r\n[ \t]/g, " ").replace(/=\?UTF-8\?Q\?([^?]*)\?=\s*/gi, (_, word) => {
    const bytes = word.replace(/_/g, " ").replace(/=([0-9A-F]{2})/g, (__, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }).trim();
}

function decodedMail(data) {
  const qp = data.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(qp, "latin1").toString("utf8");
}

// Parte HTML da mensagem, decodificada.
function htmlPart(data) {
  const decoded = decodedMail(data);
  const start = decoded.indexOf("Content-Type: text/html");
  return start < 0 ? "" : decoded.slice(start);
}

const MONEY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const LINE = "836400000011331201380002812884627116080136181551";
const BARCODE = "83640000001331201380008128846271108013618155";

/** Instante às `hour` horas de Brasília (UTC−3) do dia civil `day`. */
function at(day, hour) {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00-03:00`);
}

// E-mails da Gestão Tributária não dependem do escape compartilhado (que mostra 0 como vazio e não escapa aspa simples).
function escapeTests() {
  check(escapeHtml(0) === "0" && escapeHtml(null) === "" && escapeHtml(undefined) === "", "escape: 0 vira \"0\", null/undefined vazio");
  check(escapeHtml(`D'Ávila & "Filhos" <x>`) === "D&#39;Ávila &amp; &quot;Filhos&quot; &lt;x&gt;", `escape completo: ${escapeHtml(`D'Ávila & "Filhos" <x>`)}`);

  const item = {
    id: "i0", agreement_id: "a0", numero_parcela: 1, qtd_parcelas: 10, vencimento: "2031-03-12", esfera: "federal",
    entity_name: "D'Ávila & Filhos", codigo_parcelamento: "P'1", orgao_label: "PGFN", tributo: "IRPJ",
    valor_para_pagamento: 0, origem_valor: "estimado", guia: { situacao: "sem_guia", label: "Sem guia" },
  };
  const alert = buildTaxAlertEmail({
    tenantName: "Cliente D'Oeste", recipientName: "Zé D'Água", today: "2031-03-10", dueSoonDays: 7,
    content: { a_vencer: [item], vencidas: [], guia_pendente: [] }, appUrl: "http://localhost",
  });
  check(alert.html.includes("D&#39;Ávila &amp; Filhos") && !alert.html.includes("D'Ávila"), "alerta: aspa simples escapada no HTML");
  check(alert.html.includes("Zé D&#39;Água") && alert.html.includes("Cliente D&#39;Oeste"), "alerta: nome de quem recebe e do cliente escapados");
  check(alert.html.includes(`${MONEY.format(0)} (estimado`) && alert.text.includes(`${MONEY.format(0)} (estimado`), "alerta: parcela de valor zero aparece com R$ 0,00");
  check(alert.subject === "Tributos: 1 vence em até 7 dias — Cliente D'Oeste — AllDebt", `alerta: assunto sem as contagens zeradas: ${alert.subject}`);
  check(!alert.html.includes("Parcelas vencidas") && !alert.html.includes("Guia pendente"), "alerta: seção com 0 parcelas não aparece");
  check(alert.html.includes("Parcelas que vencem nos próximos 7 dias (1)"), "alerta: contagem da seção");

  const guideMail = buildGuideEmail({
    ctx: {
      entity_name: "D'Ávila & Filhos", document_number: "", esfera: "federal", orgao: "PGFN", uf: null, tributo: "IRPJ",
      modalidade: "Transação", codigo_parcelamento: "P'1", numero_parcela: 1, qtd_parcelas: 10, vencimento: "2031-03-12", valor: 0,
    },
    guide: { situacao: "vinculada", valor_guia: null, pagar_ate: null, linha_digitavel: LINE, arquivo_chave: null },
    message: "Pagar hoje, é 'urgente'.",
    sender: { email: "x@teste.local", full_name: "Zé D'Água" },
  });
  check(guideMail.html.includes("D&#39;Ávila &amp; Filhos") && guideMail.html.includes("&#39;urgente&#39;") && !guideMail.html.includes("'urgente'"), "guia: aspa simples escapada no HTML");
  check(guideMail.html.includes(MONEY.format(0)), "guia: valor estimado zero aparece com R$ 0,00");
}

async function main() {
  escapeTests();
  check(TASK_KEYS.includes("alertas_tributarios"), "tarefa no catálogo do agendador");
  check(DUE_SOON_DAYS === 7, "mesmo prazo do semáforo (7 dias)");

  const suffix = `${Date.now()}`;
  const day1 = "2031-03-10";
  const ids = {
    groupA: `grp_alert_a_${suffix}`, groupB: `grp_alert_b_${suffix}`, groupC: `grp_alert_c_${suffix}`,
    entA: `ent_alert_a_${suffix}`, entB: `ent_alert_b_${suffix}`, entC: `ent_alert_c_${suffix}`,
    tenantA: `tnt_alert_a_${suffix}`, tenantB: `tnt_alert_b_${suffix}`, tenantC: `tnt_alert_c_${suffix}`,
  };
  const users = {
    a1: { id: randomUUID(), email: `Alert-A1-${suffix}@Tax.Test`, name: "Ana <Financeiro>", tenant: ids.tenantA, group: ids.groupA, tax: true },
    a2: { id: randomUUID(), email: `alert-a2-${suffix}@tax.test`, name: "Bruno", tenant: ids.tenantA, group: ids.groupA, tax: true },
    a3: { id: randomUUID(), email: `alert-a3-${suffix}@tax.test`, name: "Carla sem módulo", tenant: ids.tenantA, group: ids.groupA, tax: false },
    a4: { id: randomUUID(), email: `alert-a4-${suffix}@tax.test`, name: "Davi inativo", tenant: ids.tenantA, group: ids.groupA, tax: true, status: "disabled" },
    b1: { id: randomUUID(), email: `alert-b1-${suffix}@tax.test`, name: "Elisa", tenant: ids.tenantB, group: ids.groupB, tax: true },
    c1: { id: randomUUID(), email: `alert-c1-${suffix}@tax.test`, name: "Fábio", tenant: ids.tenantC, group: ids.groupC, tax: true },
  };
  const ag = {};
  const inst = {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Alertas A','ativo','teste'), ($2,'Alertas B','ativo','teste'), ($3,'Alertas C','ativo','teste')`,
      [ids.groupA, ids.groupB, ids.groupC]
    );
    for (const [id, group, name, code] of [[ids.entA, ids.groupA, "Empresa <b>A&B</b>", "91"], [ids.entB, ids.groupB, "Empresa Bê", "92"], [ids.entC, ids.groupC, "Empresa Cê", "93"]]) {
      await client.query(
        `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
         VALUES ($1,$2,$3,$4,'CNPJ','empresa',$5,'01','ativa','teste')`,
        [id, group, name, `00.000.000/0001-${code}`, code]
      );
    }
    await client.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'Cliente Alfa','STARTER','active',$3,'teste'), ($4,$5,'Cliente Beta','STARTER','active',$6,'teste'), ($7,$8,'Cliente Gama','STARTER','active',$9,'teste')`,
      [ids.tenantA, ids.groupA, users.a1.email, ids.tenantB, ids.groupB, users.b1.email, ids.tenantC, ids.groupC, users.c1.email]
    );
    for (const user of Object.values(users)) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_by) VALUES ($1,$2,'hash',$3,'user',$4,'teste')`,
        [user.id, user.email, user.name, user.status || "active"]
      );
      await client.query(
        `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,'ADMIN',$5,'teste')`,
        [`tu_${user.id}`, user.tenant, user.group, user.email, user.tax ? { tax: true } : {}]
      );
    }
    // a2 também atende o cliente B (consultor): desligar os alertas no A não desliga no B.
    await client.query(
      `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,'ADMIN',$5,'teste')`,
      [`tu_b_${users.a2.id}`, ids.tenantB, ids.groupB, users.a2.email, { tax: true }]
    );
    const agreement = async (key, group, entityId, situacao = "ativo") => {
      ag[key] = randomUUID();
      await client.query(
        `INSERT INTO tax_agreements (id, group_id, entity_id, esfera, orgao, modalidade, tributo, codigo_parcelamento, qtd_parcelas, situacao, created_by)
         VALUES ($1,$2,$3,'federal','PGFN','Transação','IRPJ',$4,24,$5,'teste')`,
        [ag[key], group, entityId, `${key}-${suffix}`, situacao]
      );
    };
    let numero = 0;
    const installment = async (key, agreementKey, group, vencimento, valor, situacao = "em_aberto") => {
      inst[key] = randomUUID();
      numero += 1;
      await client.query(
        `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor, situacao, data_pagamento, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'teste')`,
        [inst[key], group, ag[agreementKey], numero, vencimento, valor, situacao, situacao === "reconhecida" ? vencimento : null]
      );
    };
    const guide = (key, group, situacao, valorGuia) => client.query(
      `INSERT INTO tax_installment_guides (id, group_id, installment_id, origem, linha_fonte, linha_digitavel, codigo_barras, valor_guia, situacao, motivos)
       VALUES ($1,$2,$3,'digitada','digitada',$4,$5,$6,$7,$8::jsonb)`,
      [randomUUID(), group, inst[key], LINE, BARCODE, valorGuia, situacao,
        JSON.stringify(situacao === "excecao" ? [{ codigo: "CNPJ_DIFERENTE", mensagem: "CNPJ diferente" }] : [])]
    );
    await agreement("A1", ids.groupA, ids.entA);
    await installment("overdue", "A1", ids.groupA, addDays(day1, -2), 111.11);
    await installment("soonNoGuide", "A1", ids.groupA, addDays(day1, 3), 222.22);
    await installment("soonLinked", "A1", ids.groupA, addDays(day1, 5), 333.33);
    await guide("soonLinked", ids.groupA, "vinculada", 345.67);
    await installment("soonException", "A1", ids.groupA, addDays(day1, 6), 444.44);
    await guide("soonException", ids.groupA, "excecao", 456.78);
    await installment("lastDay", "A1", ids.groupA, addDays(day1, 7), 555.55);
    await guide("lastDay", ids.groupA, "vinculada", 567.89);
    await installment("tooFar", "A1", ids.groupA, addDays(day1, 8), 666.66);
    await installment("paidOverdue", "A1", ids.groupA, addDays(day1, -3), 777.77, "reconhecida");
    await installment("cancelled", "A1", ids.groupA, addDays(day1, 1), 888.88, "cancelada");
    await agreement("A2", ids.groupA, ids.entA, "rescindido");
    await installment("rescinded", "A2", ids.groupA, addDays(day1, -1), 999.99);
    await agreement("B1", ids.groupB, ids.entB);
    await installment("bOverdue", "B1", ids.groupB, addDays(day1, -1), 121.21);
    // Cliente C: só parcela longe (nada a avisar).
    await agreement("C1", ids.groupC, ids.entC);
    await installment("cFar", "C1", ids.groupC, addDays(day1, 30), 10);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    throw error;
  }
  client.release();

  const asSystem = (group, tenant, fn) => runWithTenant({ groupId: group, tenantId: tenant, email: "sistema", fullName: "Sistema" }, fn);
  const runA = (now) => asSystem(ids.groupA, ids.tenantA, () => runTaxAlerts({ now }));
  const sends = async (group, email = null) => (await pool.query(
    `SELECT user_email, data_referencia::text AS dia, situacao, tentativas, resumo, assunto, erro, enviado_em
       FROM tax_alert_sends WHERE group_id = $1 ${email ? "AND user_email = $2" : ""} ORDER BY data_referencia, user_email`,
    email ? [group, email.toLowerCase()] : [group]
  )).rows;

  const previousSmtp = { host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure, user: config.smtpUser, from: config.smtpFrom };
  const smtp = await startFakeSmtp();
  config.smtpHost = "";
  config.smtpPort = smtp.server.address().port;
  config.smtpSecure = false;
  config.smtpUser = "";
  const messagesTo = (email) => smtp.state.messages.filter((m) => m.to.map((t) => t.toLowerCase()).includes(email.toLowerCase()));

  try {
    // ---- Opt-out pela preferência do próprio usuário (gravada como ele, pela regra da tela) ----
    await runWithTenant({ groupId: ids.groupA, tenantId: ids.tenantA, email: users.a2.email, permissions: { tax: true } }, () => updateMyPreferences({ alertas_tributarios: false }));

    // ---- Antes das 7h: nada ----
    const early = await runA(at(day1, ALERT_FROM_HOUR - 1));
    check(early.ok && early.detalhes.fora_do_horario && (await sends(ids.groupA)).length === 0, `antes das ${ALERT_FROM_HOUR}h nada sai: ${JSON.stringify(early)}`);

    // ---- Sem SMTP: registra a falha, não quebra, não diz "enviado" ----
    const noSmtp = await runA(at(day1, 9));
    const afterNoSmtp = await sends(ids.groupA);
    check(noSmtp.ok === false && noSmtp.detalhes.falhas === 1 && noSmtp.detalhes.enviados === 0 && noSmtp.detalhes.sem_smtp === true, `sem SMTP: ${JSON.stringify(noSmtp)}`);
    check(noSmtp.message.includes("envio de e-mail não configurado") && !/1 resumo enviado/.test(noSmtp.message), `mensagem sem SMTP: ${noSmtp.message}`);
    check(afterNoSmtp.length === 1 && afterNoSmtp[0].situacao === "falhou" && afterNoSmtp[0].erro === "SMTP não configurado" && afterNoSmtp[0].enviado_em === null,
      `sem SMTP registrado como falha: ${JSON.stringify(afterNoSmtp)}`);
    check(afterNoSmtp[0]?.user_email === users.a1.email.toLowerCase(), "registro com o e-mail em minúsculas");

    // ---- Com SMTP: a falha da manhã é tentada de novo e sai ----
    config.smtpHost = "127.0.0.1";
    const first = await runA(at(day1, 10));
    check(first.ok && first.detalhes.enviados === 1 && first.detalhes.desligados === 1 && first.detalhes.destinatarios === 2, `envio: ${JSON.stringify(first)}`);
    const sentRow = (await sends(ids.groupA))[0];
    check(sentRow?.situacao === "enviado" && sentRow.tentativas === 2 && sentRow.enviado_em && sentRow.erro === null, `registro do envio: ${JSON.stringify(sentRow)}`);
    check(JSON.stringify(sentRow?.resumo) === JSON.stringify({ a_vencer: 4, vencidas: 1, guia_pendente: 2 }), `resumo registrado: ${JSON.stringify(sentRow?.resumo)}`);
    check(smtp.state.messages.length === 1 && messagesTo(users.a1.email).length === 1, `só a1 recebe: ${smtp.state.messages.map((m) => m.to.join()).join(" | ")}`);
    for (const key of ["a2", "a3", "a4", "b1", "c1"]) check(messagesTo(users[key].email).length === 0, `${key} não recebe o resumo do cliente A`);

    const mail = smtp.state.messages[0];
    const subject = decodedSubject(mail.data);
    check(subject === "Tributos: 1 vencida, 4 vencem em até 7 dias, 2 com guia pendente — Cliente Alfa — AllDebt", `assunto: ${subject}`);
    const html = htmlPart(mail.data);
    const body = decodedMail(mail.data);
    check(!html.includes("<b>A&B</b>") && html.includes("Empresa &lt;b&gt;A&amp;B&lt;/b&gt;"), "HTML escapado (nome da empresa)");
    check(html.includes("Olá, Ana &lt;Financeiro&gt;.") && !html.includes("<Financeiro>"), "HTML escapado (nome de quem recebe)");
    for (const [value, origin, label] of [
      [111.11, "estimado", "vencida"], [222.22, "estimado", "a vencer sem guia"], [345.67, "valor da guia", "a vencer com guia"],
      [444.44, "estimado", "guia em exceção vale o estimado"], [567.89, "valor da guia", "vence no 7º dia"],
    ]) {
      check(body.includes(`${MONEY.format(value)} (${origin}`), `${label}: ${MONEY.format(value)} (${origin})`);
    }
    for (const [value, label] of [[333.33, "estimado de parcela com guia"], [456.78, "valor de guia em exceção"], [666.66, "8º dia"], [777.77, "paga"], [888.88, "cancelada"], [999.99, "parcelamento rescindido"], [121.21, "outro cliente"]]) {
      check(!body.includes(MONEY.format(value)), `fora do resumo: ${label} (${MONEY.format(value)})`);
    }
    // Guia pendente: sem guia e guia em exceção, não a vinculada.
    const pendingSection = body.slice(body.indexOf("Guia pendente (2)"), body.indexOf("Planejamento completo"));
    check(pendingSection.includes(MONEY.format(222.22)) && pendingSection.includes(MONEY.format(444.44)) && !pendingSection.includes(MONEY.format(345.67)) && !pendingSection.includes(MONEY.format(567.89)),
      `seção guia pendente: ${pendingSection.slice(0, 600)}`);
    check(body.includes(`${config.appPublicUrl}/TaxPlanning`), "link para o Planejamento");
    check(body.includes(`${config.appPublicUrl}/TaxFederal?acordo=${ag.A1}&guia=${inst.overdue}`) || html.includes(`/TaxFederal?acordo=${ag.A1}&amp;guia=${inst.overdue}`), "link para a parcela");

    // ---- Rodar de novo no mesmo dia: nada repete ----
    const again = await runA(at(day1, 11));
    check(again.ok && again.detalhes.enviados === 0 && again.detalhes.ja_enviados === 1 && smtp.state.messages.length === 1, `segunda execução no dia não repete: ${JSON.stringify(again)}`);
    check((await sends(ids.groupA))[0].tentativas === 2, "segunda execução não conta tentativa");

    // ---- Duas execuções ao mesmo tempo, no dia seguinte: um e-mail só ----
    const day2 = addDays(day1, 1);
    const before = smtp.state.messages.length;
    const [r1, r2] = await Promise.all([runA(at(day2, 8)), runA(at(day2, 8))]);
    check(smtp.state.messages.length === before + 1, `concorrência: ${smtp.state.messages.length - before} e-mails (${JSON.stringify([r1.detalhes, r2.detalhes])})`);
    check(r1.detalhes.enviados + r2.detalhes.enviados === 1, "uma das execuções envia, a outra encontra reservado");

    // ---- Isolamento: cliente B recebe só o dele ----
    const runB = await asSystem(ids.groupB, ids.tenantB, () => runTaxAlerts({ now: at(day1, 10) }));
    const bMail = messagesTo(users.b1.email);
    check(runB.ok && bMail.length === 1, `cliente B: ${JSON.stringify(runB)}`);
    const a2InB = messagesTo(users.a2.email);
    check(runB.detalhes.enviados === 2 && a2InB.length === 1 && decodedMail(a2InB[0].data).includes(MONEY.format(121.21)), "preferência é por cliente: a2 desligou no A e recebe o do B");
    const bBody = decodedMail(bMail[0]?.data || "");
    check(bBody.includes(MONEY.format(121.21)) && !bBody.includes(MONEY.format(111.11)) && !bBody.includes("A&amp;B"), "cliente B só com as parcelas dele");
    check((await sends(ids.groupB)).length === 2 && (await sends(ids.groupA)).every((row) => row.user_email !== users.b1.email), "registros separados por cliente");

    // ---- Nada a avisar: não envia nem registra ----
    const beforeC = smtp.state.messages.length;
    const runC = await asSystem(ids.groupC, ids.tenantC, () => runTaxAlerts({ now: at(day1, 10) }));
    check(runC.ok && runC.detalhes.tem_algo === false && smtp.state.messages.length === beforeC && (await sends(ids.groupC)).length === 0, `nada a avisar: ${JSON.stringify(runC)}`);
    check(runC.message.startsWith("Nada a avisar hoje"), `mensagem: ${runC.message}`);

    // ---- Recusa do servidor de e-mail: falha registrada ----
    const day3 = addDays(day1, 2);
    smtp.state.rejectRcpt = (address) => address.toLowerCase() === users.a1.email.toLowerCase();
    const rejected = await runA(at(day3, 9));
    const rejectedRow = (await sends(ids.groupA)).find((row) => row.dia === day3);
    check(rejected.ok === false && rejected.detalhes.falhas === 1 && rejectedRow?.situacao === "falhou" && rejectedRow.erro, `recusa: ${JSON.stringify(rejected)} ${JSON.stringify(rejectedRow)}`);

    // ---- Limite de tentativas no dia ----
    for (let i = 1; i < MAX_ALERT_ATTEMPTS; i += 1) await runA(at(day3, 9 + i));
    const exhaustedRow = (await sends(ids.groupA)).find((row) => row.dia === day3);
    check(exhaustedRow?.tentativas === MAX_ALERT_ATTEMPTS && exhaustedRow.situacao === "falhou", `tentativas no dia: ${JSON.stringify(exhaustedRow)}`);
    smtp.state.rejectRcpt = () => false;
    const beforeExhausted = smtp.state.messages.length;
    const exhausted = await runA(at(day3, 20));
    check(exhausted.ok === false && exhausted.detalhes.esgotados === 1 && exhausted.detalhes.ja_enviados === 0 && smtp.state.messages.length === beforeExhausted,
      `depois do limite não tenta mais no dia: ${JSON.stringify(exhausted)}`);
    check((await sends(ids.groupA)).find((row) => row.dia === day3)?.tentativas === MAX_ALERT_ATTEMPTS, "limite não ultrapassado");

    // ---- Religar os alertas: volta a receber ----
    await runWithTenant({ groupId: ids.groupA, tenantId: ids.tenantA, email: users.a2.email, permissions: { tax: true } }, () => updateMyPreferences({ alertas_tributarios: true }));
    const day4 = addDays(day1, 3);
    const back = await runA(at(day4, 9));
    check(back.detalhes.enviados === 2 && messagesTo(users.a2.email).length === 2, `religado: ${JSON.stringify(back)}`);

    // ---- Cliente suspenso: nada ----
    await pool.query(`UPDATE tenants SET billing_status = 'suspended' WHERE id = $1`, [ids.tenantB]);
    const suspended = await asSystem(ids.groupB, ids.tenantB, () => runTaxAlerts({ now: at(day4, 9) }));
    check(suspended.detalhes.cliente_suspenso === true && messagesTo(users.b1.email).length === 1 && messagesTo(users.a2.email).length === 2, `cliente suspenso: ${JSON.stringify(suspended)}`);
  } finally {
    smtp.server.close();
    Object.assign(config, { smtpHost: previousSmtp.host, smtpPort: previousSmtp.port, smtpSecure: previousSmtp.secure, smtpUser: previousSmtp.user, smtpFrom: previousSmtp.from });
    const groups = [ids.groupA, ids.groupB, ids.groupC];
    await pool.query(`DELETE FROM tax_alert_sends WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM tax_agreements WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM user_preferences WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM tenant_users WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(users).map((u) => u.id)]);
    await pool.query(`DELETE FROM tenants WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM company_entities WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM groups WHERE id = ANY($1::text[])`, [groups]).catch(() => {});
  }

  if (failures.length) {
    console.error(`alertas tributários: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log("alertas tributários ok: conteúdo, opt-out, um por dia, sem SMTP, recusa, tentativas e isolamento");
  await pool.end();
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  for (const message of failures) console.error(` - ${message}`);
  pool.end().finally(() => process.exit(1));
});
