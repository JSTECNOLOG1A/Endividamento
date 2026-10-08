import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { isDeepStrictEqual } from "node:util";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { runWithTenant } from "../tenants/access.js";
import { getDashboardSummary } from "../accounting/dashboardSummary.js";
import { addDays, addMonths, brazilDate, lastDayOfMonth } from "./brazilClock.js";
import { aggregateDueWindows, aggregatePlanning, getDashboardTaxDue, parsePeriod } from "./planning.js";
import { updateMyPreferences } from "../preferences/service.js";

// Planejamento da Gestão Tributária (calendário e fluxo de caixa), série dos tributos no Dashboard e preferências do
// usuário. Valores escolhidos para divergir por construção: valor estimado ≠ valor da guia em toda parcela com guia,
// para que somar os dois (ou trocar um pelo outro) dê um número diferente do esperado.

process.exitCode = 1;
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}
function same(actual, expected, message) {
  check(isDeepStrictEqual(actual, expected), `${message}: esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`);
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

const LINE = "836400000011331201380002812884627116080136181551";
const BARCODE = "83640000001331201380008128846271108013618155";

// ---------------------------------------------------------------------------
// Agregação (pura)
// ---------------------------------------------------------------------------

function row(over) {
  return {
    id: randomUUID(), agreement_id: "ag1", numero_parcela: 1, qtd_parcelas: 12, vencimento: "2026-10-20", valor: "100.00",
    situacao: "em_aberto", data_pagamento: null, valor_pago: null, entity_id: "e1", entity_name: "Alfa", esfera: "federal",
    uf: null, orgao: "PGFN", modalidade: "Transação", tributo: "IRPJ", codigo_parcelamento: "P1", guide_id: null,
    guide_situacao: null, valor_guia: null, title_id: null, title_situacao: null, numero_e2: null, ...over,
  };
}

function pureTests() {
  const today = "2026-10-07";
  const months = ["2026-10", "2026-11", "2026-12"];
  const result = aggregatePlanning([
    // Guia × estimado, nos quatro quadrantes: só guia vinculada com valor vale o valor da guia.
    row({ vencimento: "2026-10-20", valor: "200.00", guide_id: "g1", guide_situacao: "vinculada", valor_guia: "133.12" }),
    row({ vencimento: "2026-10-21", valor: "300.00", guide_id: "g2", guide_situacao: "vinculada", valor_guia: null }),
    row({ vencimento: "2026-10-22", valor: "400.00", guide_id: "g3", guide_situacao: "excecao", valor_guia: "999.99" }),
    row({ vencimento: "2026-10-23", valor: "0.29" }),
    // Hoje ainda é a pagar; ontem é vencida.
    row({ vencimento: today, valor: "10.00" }),
    row({ vencimento: "2026-10-06", valor: "55.00" }),
    // Vencida de antes do período: aparece à parte, não some.
    row({ vencimento: "2025-01-10", valor: "80.00" }),
    // Pagas: pelo valor pago, nunca no "a pagar"; sem valor informado conta à parte.
    row({ vencimento: "2026-11-05", valor: "500.00", situacao: "reconhecida", data_pagamento: "2026-10-01", valor_pago: "510.50" }),
    row({ vencimento: "2026-11-06", valor: "600.00", situacao: "paga_aguardando_reconhecimento", data_pagamento: "2026-10-01", valor_pago: null }),
    // Paga com vencimento já passado: não é vencida.
    row({ vencimento: "2026-09-30", valor: "700.00", situacao: "reconhecida", data_pagamento: "2026-09-30", valor_pago: "700.00" }),
    // Cancelada não entra; fora do período não entra.
    row({ vencimento: "2026-11-07", valor: "800.00", situacao: "cancelada" }),
    row({ vencimento: "2027-01-10", valor: "900.00" }),
    // Recortes: outra empresa, estadual, tributo com outra caixa e sem tributo.
    row({ vencimento: "2026-12-01", valor: "20.00", entity_id: "e2", entity_name: "Beta", esfera: "estadual", uf: "SP", orgao: "Sefaz", tributo: "irpj", agreement_id: "ag2", codigo_parcelamento: "P2" }),
    row({ vencimento: "2026-12-02", valor: "30.00", entity_id: "e2", entity_name: "Beta", tributo: null, agreement_id: "ag3", codigo_parcelamento: "P3" }),
  ], { today, months });

  const [oct, nov, dec] = result.meses;
  same(oct.a_pagar, { total: 843.41, com_guia: 133.12, estimado: 710.29, parcelas: 5, parcelas_com_guia: 1, parcelas_estimadas: 4 },
    "outubro: guia vinculada com valor vale a guia; vinculada sem valor, exceção e sem guia valem o estimado; hoje entra");
  const withGuide = oct.parcelas.find((item) => item.valor_estimado === 200);
  same([withGuide.valor_para_pagamento, withGuide.valor_guia, withGuide.origem_valor], [133.12, 133.12, "guia"], "parcela com guia: valor da guia, nunca somado ao estimado");
  const exception = oct.parcelas.find((item) => item.valor_estimado === 400);
  same([exception.valor_para_pagamento, exception.valor_guia, exception.origem_valor, exception.guia.situacao], [400, null, "estimado", "excecao"], "guia em exceção não vale o valor dela");
  same(oct.parcelas_vencidas, 1, "a vencida de outubro aparece no calendário do mês");
  check(oct.parcelas.some((item) => item.conta_em === "vencida" && item.vencimento === "2026-10-06"), "vencida listada no mês com conta_em=vencida");
  same(result.vencidas.a_pagar, { total: 135, com_guia: 0, estimado: 135, parcelas: 2, parcelas_com_guia: 0, parcelas_estimadas: 2 }, "vencidas à parte, inclusive de antes do período");
  same(nov.a_pagar.total, 0, "novembro: pagas e canceladas fora do a pagar");
  same(nov.pago, { total: 510.5, parcelas: 2, parcelas_sem_valor: 1 }, "novembro: pago pelo valor pago, sem valor contado à parte");
  check(!nov.parcelas.some((item) => item.situacao === "cancelada"), "cancelada fora do calendário");
  same(dec.a_pagar.total, 50, "dezembro");
  same(result.totais.a_pagar.total, 893.41, "total a pagar do período não inclui vencidas nem pagas");
  same(result.totais.pago.total, 510.5, "total pago do período (a paga de setembro está fora)");
  check(!result.meses.some((month) => month.parcelas.some((item) => item.vencimento === "2027-01-10")), "fora do período não entra");

  const byTribute = Object.fromEntries(result.por_tributo.map((entry) => [entry.chave, entry]));
  same(byTribute.irpj?.a_pagar.total, 863.41, "tributo agrupado sem diferenciar maiúsculas");
  same(byTribute.irpj?.label, "IRPJ", "rótulo do tributo é o primeiro gravado");
  same(result.por_tributo.at(-1).chave, null, "sem tributo informado por último");
  same(result.por_tributo.at(-1).label, "Tributo não informado", "rótulo de sem tributo");
  same(byTribute.irpj?.vencidas.total, 135, "vencidas no recorte por tributo");
  const bySphere = Object.fromEntries(result.por_esfera.map((entry) => [entry.chave, entry]));
  same([bySphere.federal?.a_pagar.total, bySphere.estadual?.a_pagar.total], [873.41, 20], "por esfera");
  same(bySphere.estadual?.meses.map((m) => m.a_pagar.total), [0, 0, 20], "por esfera e mês");
  const byCompany = Object.fromEntries(result.por_empresa.map((entry) => [entry.chave, entry]));
  same([byCompany.e1?.a_pagar.total, byCompany.e2?.a_pagar.total], [843.41, 50], "por empresa");
  same(byCompany.e1?.meses.map((m) => m.pago.total), [0, 510.5, 0], "pago por empresa e mês");
  same(result.por_orgao.find((entry) => entry.chave === "sefaz|SP")?.label, "Sefaz — SP", "órgão estadual com UF");

  // Janelas do Dashboard: mesma regra da dívida bancária — cronograma da janela a partir da data-base, pago ou não;
  // vencidas (situação de hoje) à parte.
  const windows = aggregateDueWindows([
    row({ vencimento: "2026-10-31", valor: "1.00" }), // igual à data-base: fora
    row({ vencimento: "2026-11-30", valor: "2.00", guide_id: "g", guide_situacao: "vinculada", valor_guia: "20.00" }), // +30, pela guia
    row({ vencimento: "2026-11-15", valor: "50.00", situacao: "reconhecida", data_pagamento: "2026-10-01", valor_pago: "55.00" }), // paga: pelo valor pago
    row({ vencimento: "2026-11-16", valor: "70.00", situacao: "paga_aguardando_reconhecimento", data_pagamento: "2026-10-01", valor_pago: null }), // paga sem valor
    row({ vencimento: "2026-11-17", valor: "90.00", situacao: "cancelada" }), // cancelada: fora
    row({ vencimento: "2026-12-01", valor: "4.00" }), // +31
    row({ vencimento: "2027-04-29", valor: "8.00" }), // +180
    row({ vencimento: "2027-04-30", valor: "16.00" }), // +181
    row({ vencimento: "2026-10-01", valor: "32.00" }), // vencida
  ], { dataBase: "2026-10-31", today: "2026-10-07" });
  same(windows.d30, { total: 75, com_guia: 20, estimado: 0, pago: 55, parcelas: 3, parcelas_com_guia: 1, parcelas_estimadas: 0, parcelas_pagas: 2, parcelas_pagas_sem_valor: 1 },
    "janela de 30 dias: guia ou valor pago, um valor por parcela; paga sem valor contada à parte; cancelada fora");
  same([windows.d90.total, windows.d180.total, windows.vencidas.total], [79, 87, 32], "janelas 90/180 e vencidas");
  // Data-base no passado: a vencida em aberto está no cronograma da janela e, à parte, nas vencidas de hoje.
  const past = aggregateDueWindows([row({ vencimento: "2026-09-15", valor: "5.00" }), row({ vencimento: "2026-10-10", valor: "7.00" })], { dataBase: "2026-08-31", today: "2026-10-07" });
  same([past.d30.total, past.d90.total, past.vencidas.total], [5, 12, 5], "data-base no passado");

  // Período.
  same(parsePeriod({}, "2026-10-07"), { inicio: "2026-10", fim: "2027-09", meses: parsePeriod({ inicio: "2026-10", fim: "2027-09" }, "x").meses }, "padrão: mês atual + 11");
  same(parsePeriod({}, "2026-10-07").meses.length, 12, "doze meses");
  same(parsePeriod({ inicio: "2026-12" }, "2026-10-07").fim, "2027-11", "só início: + 11");
  for (const [query, label] of [[{ inicio: "2026-13" }, "mês 13"], [{ inicio: "2026-1" }, "formato"], [{ inicio: "2026-10", fim: "2026-09" }, "fim antes do início"], [{ inicio: "2026-01", fim: "2029-01" }, "37 meses"], [{ inicio: ["2026-01", "2026-02"] }, "dois valores"]]) {
    let error = null;
    try { parsePeriod(query, "2026-10-07"); } catch (err) { error = err; }
    check(error?.status === 400 && error.code === "TAX_VALIDATION", `período inválido (${label}) recusado: ${error?.message}`);
  }
  same(parsePeriod({ inicio: "2026-01", fim: "2028-12" }, "2026-10-07").meses.length, 36, "36 meses é o máximo aceito");
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function main() {
  pureTests();

  const suffix = `${Date.now()}`;
  const today = brazilDate();
  const month = today.slice(0, 7);
  const next = addMonths(month, 1);
  const day = (monthText, dd) => `${monthText}-${String(dd).padStart(2, "0")}`;
  const ids = {
    groupA: `grp_plan_a_${suffix}`, groupB: `grp_plan_b_${suffix}`, groupC: `grp_plan_c_${suffix}`,
    entA1: `ent_plan_a1_${suffix}`, entA2: `ent_plan_a2_${suffix}`, entB: `ent_plan_b_${suffix}`, entC: `ent_plan_c_${suffix}`,
    tenantA: `tnt_plan_a_${suffix}`, tenantB: `tnt_plan_b_${suffix}`, tenantC: `tnt_plan_c_${suffix}`,
  };
  const users = {
    ownerA: { id: randomUUID(), email: `Plan-Owner-A-${suffix}@Tax.Test`, role: "admin", tenantRole: "OWNER", tenant: ids.tenantA, group: ids.groupA, tax: true },
    noTaxA: { id: randomUUID(), email: `plan-notax-a-${suffix}@tax.test`, role: "admin", tenantRole: "ADMIN", tenant: ids.tenantA, group: ids.groupA, tax: false },
    viewerA: { id: randomUUID(), email: `plan-viewer-a-${suffix}@tax.test`, role: "viewer", tenantRole: "VIEWER", tenant: ids.tenantA, group: ids.groupA, tax: true },
    ownerB: { id: randomUUID(), email: `plan-owner-b-${suffix}@tax.test`, role: "admin", tenantRole: "OWNER", tenant: ids.tenantB, group: ids.groupB, tax: true },
    ownerC: { id: randomUUID(), email: `plan-owner-c-${suffix}@tax.test`, role: "admin", tenantRole: "OWNER", tenant: ids.tenantC, group: ids.groupC, tax: true },
  };
  const ag = {};
  const inst = {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Plan A','ativo','teste'), ($2,'Plan B','ativo','teste'), ($3,'Plan C','ativo','teste')`,
      [ids.groupA, ids.groupB, ids.groupC]
    );
    const entity = (id, group, name, cnpj, pending) => client.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, implantacao_pendente, created_by)
       VALUES ($1,$2,$3,$4,'CNPJ','empresa',$6,'01','ativa',$5,'teste')`,
      [id, group, name, cnpj, pending, cnpj.slice(-2)]
    );
    await entity(ids.entA1, ids.groupA, "Alfa Ltda", "00.000.000/0001-81", false);
    await entity(ids.entA2, ids.groupA, "Beta S.A.", "00.000.000/0001-82", true);
    await entity(ids.entB, ids.groupB, "Gama B", "00.000.000/0001-83", false);
    await entity(ids.entC, ids.groupC, "Delta C", "00.000.000/0001-84", false);
    await client.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'Plan A','STARTER','trial',$3,'teste'), ($4,$5,'Plan B','STARTER','trial',$6,'teste'), ($7,$8,'Plan C','STARTER','trial',$9,'teste')`,
      [ids.tenantA, ids.groupA, users.ownerA.email, ids.tenantB, ids.groupB, users.ownerB.email, ids.tenantC, ids.groupC, users.ownerC.email]
    );
    for (const user of Object.values(users)) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_by) VALUES ($1,$2,'hash',$2,$3,'active','teste')`,
        [user.id, user.email, user.role]
      );
      await client.query(
        `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,$5,$6,'teste')`,
        [`tu_${user.id}`, user.tenant, user.group, user.email.toLowerCase(), user.tenantRole, user.tax ? { tax: true } : {}]
      );
    }
    const agreement = async (key, group, entityId, { esfera = "federal", uf = null, orgao = "PGFN", tributo = "IRPJ", situacao = "ativo" } = {}) => {
      ag[key] = randomUUID();
      await client.query(
        `INSERT INTO tax_agreements (id, group_id, entity_id, esfera, orgao, uf, modalidade, tributo, codigo_parcelamento, qtd_parcelas, situacao, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'Transação',$7,$8,12,$9,'teste')`,
        [ag[key], group, entityId, esfera, orgao, uf, tributo, `${key}-${suffix}`, situacao]
      );
    };
    const installment = async (key, agreementKey, group, vencimento, valor, { situacao = "em_aberto", dataPagamento = null, valorPago = null, numero = null } = {}) => {
      inst[key] = randomUUID();
      await client.query(
        `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor, situacao, data_pagamento, valor_pago, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'teste')`,
        [inst[key], group, ag[agreementKey], numero ?? Object.keys(inst).length, vencimento, valor, situacao, dataPagamento, valorPago]
      );
    };
    const guide = (key, group, situacao, valorGuia) => client.query(
      `INSERT INTO tax_installment_guides (id, group_id, installment_id, origem, linha_fonte, linha_digitavel, codigo_barras, valor_guia, situacao, motivos)
       VALUES ($1,$2,$3,'digitada','digitada',$4,$5,$6,$7,$8::jsonb)`,
      [randomUUID(), group, inst[key], LINE, BARCODE, valorGuia, situacao,
        JSON.stringify(situacao === "excecao" ? [{ codigo: "CNPJ_DIFERENTE", mensagem: "CNPJ diferente" }] : [])]
    );

    // viewerA também atende o cliente B: a preferência gravada no A não vale no B.
    await client.query(
      `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,'VIEWER',$5,'teste')`,
      [`tu_b_${users.viewerA.id}`, ids.tenantB, ids.groupB, users.viewerA.email.toLowerCase(), { tax: true }]
    );
    await agreement("A1", ids.groupA, ids.entA1);
    await installment("i1", "A1", ids.groupA, addDays(today, -5), 100);
    await installment("i2", "A1", ids.groupA, today, 200);
    await guide("i2", ids.groupA, "vinculada", 133.12);
    await installment("i3", "A1", ids.groupA, day(next, 15), 300);
    await guide("i3", ids.groupA, "excecao", 999.99);
    await installment("i4", "A1", ids.groupA, day(next, 20), 400, { situacao: "reconhecida", dataPagamento: addDays(today, -1), valorPago: 410.5 });
    await installment("i5", "A1", ids.groupA, day(next, 25), 500, { situacao: "cancelada" });
    await installment("i6", "A1", ids.groupA, day(next, 10), 50, { situacao: "paga_aguardando_reconhecimento", dataPagamento: addDays(today, -1) });
    await installment("i7", "A1", ids.groupA, day(addMonths(month, 12), 10), 700);
    await installment("i8", "A1", ids.groupA, addDays(today, -400), 80);
    await client.query(
      `INSERT INTO tax_payable_titles (id, group_id, installment_id, numero_e2, situacao) VALUES ($1,$2,$3,lpad(nextval('tax_payable_title_number_seq')::text, 9, '0'),'pendente')`,
      [randomUUID(), ids.groupA, inst.i2]
    );
    await agreement("A2", ids.groupA, ids.entA2, { esfera: "estadual", uf: "SP", orgao: "Secretaria da Fazenda", tributo: "icms" });
    await installment("j1", "A2", ids.groupA, day(next, 5), 1000);
    await guide("j1", ids.groupA, "vinculada", 1234.56);
    await installment("j2", "A2", ids.groupA, day(addMonths(month, 2), 10), 250);
    await agreement("A3", ids.groupA, ids.entA1, { orgao: "Receita Federal", tributo: null });
    await installment("k1", "A3", ids.groupA, day(next, 12), 60);
    await agreement("A4", ids.groupA, ids.entA1, { situacao: "quitado" });
    await installment("q1", "A4", ids.groupA, day(next, 1), 9999);
    await installment("q2", "A4", ids.groupA, addDays(today, -3), 8888);
    await agreement("A5", ids.groupA, ids.entA2, { situacao: "suspenso", esfera: "estadual", uf: "SP", orgao: "Secretaria da Fazenda" });
    await installment("s1", "A5", ids.groupA, day(next, 2), 7777);
    await agreement("A6", ids.groupA, ids.entA2, { tributo: "irpj" });
    await installment("m1", "A6", ids.groupA, day(next, 3), 10);
    await agreement("B1", ids.groupB, ids.entB);
    await installment("b1", "B1", ids.groupB, day(next, 15), 5555);
    await installment("b2", "B1", ids.groupB, addDays(today, -2), 4444);
    // Mais parcelas do que qualquer teto de leitura da tela: o servidor soma todas.
    await agreement("C1", ids.groupC, ids.entC);
    await client.query(
      `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor, created_by)
       SELECT gen_random_uuid()::text, $1, $2, n, $3::date, 1, 'teste' FROM generate_series(1, 1200) AS n`,
      [ids.groupC, ag.C1, day(next, 15)]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    throw error;
  }
  client.release();

  const token = (user) => issueAuthResponse(
    { id: user.id, email: user.email, full_name: user.email, role: user.role, platform_admin: false },
    { id: user.tenant, group_id: user.group, tenant_name: "Teste", tenant_role: user.tenantRole, billing_status: "trial", plan: "STARTER" }
  ).token;
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const call = (user, method, path, body) => jsonRequest(server, { method, path, body, token: token(user) });

  try {
    // ---- Planejamento ----
    const plan = await call(users.ownerA, "GET", "/api/tax/planning");
    check(plan.status === 200, `planejamento: ${plan.status} ${JSON.stringify(plan.json)?.slice(0, 300)}`);
    const p = plan.json;
    same(p.hoje, today, "hoje = data civil de Brasília");
    same([p.periodo.inicio, p.periodo.fim, p.meses.length], [month, addMonths(month, 11), 12], "período padrão");
    const monthOf = (text) => p.meses.find((entry) => entry.mes === text);
    same(monthOf(month).a_pagar, { total: 133.12, com_guia: 133.12, estimado: 0, parcelas: 1, parcelas_com_guia: 1, parcelas_estimadas: 0 }, "mês atual: só a parcela de hoje, pelo valor da guia");
    same(monthOf(next).a_pagar, { total: 1604.56, com_guia: 1234.56, estimado: 370, parcelas: 4, parcelas_com_guia: 1, parcelas_estimadas: 3 },
      "mês seguinte: guia em exceção vale o estimado; quitado, suspenso e cancelada fora");
    same(monthOf(next).pago, { total: 410.5, parcelas: 2, parcelas_sem_valor: 1 }, "mês seguinte: pago à parte");
    same(monthOf(addMonths(month, 2)).a_pagar.total, 250, "mês + 2");
    same(p.totais.a_pagar, { total: 1987.68, com_guia: 1367.68, estimado: 620, parcelas: 6, parcelas_com_guia: 2, parcelas_estimadas: 4 }, "total do período");
    same(p.vencidas.a_pagar, { total: 180, com_guia: 0, estimado: 180, parcelas: 2, parcelas_com_guia: 0, parcelas_estimadas: 2 }, "vencidas: só de parcelamento ativo, inclusive de mais de um ano");
    same(p.vencidas.parcelas.map((item) => item.id).sort(), [inst.i1, inst.i8].sort(), "lista de vencidas");
    const i2 = monthOf(month).parcelas.find((item) => item.id === inst.i2);
    same([i2?.valor_estimado, i2?.valor_guia, i2?.valor_para_pagamento, i2?.guia.situacao, i2?.titulo?.situacao, i2?.situacao_label],
      [200, 133.12, 133.12, "vinculada", "pendente", "A vencer"], "parcela de hoje no calendário: guia, título e situação");
    const i3 = monthOf(next).parcelas.find((item) => item.id === inst.i3);
    same([i3?.valor_para_pagamento, i3?.origem_valor, i3?.guia.label, i3?.titulo], [300, "estimado", "Em exceção", null], "parcela com guia em exceção");
    const k1 = monthOf(next).parcelas.find((item) => item.id === inst.k1);
    same([k1?.guia.situacao, k1?.guia.label], ["sem_guia", "Sem guia"], "parcela sem guia");
    const allIds = p.meses.flatMap((entry) => entry.parcelas.map((item) => item.id)).concat(p.vencidas.parcelas.map((item) => item.id));
    for (const key of ["i5", "i7", "q1", "q2", "s1", "b1", "b2"]) check(!allIds.includes(inst[key]), `${key} fora do planejamento`);
    same(monthOf(next).parcelas.filter((item) => item.conta_em === "pago").length, 2, "pagas listadas no calendário do mês");
    const byTribute = Object.fromEntries(p.por_tributo.map((entry) => [entry.chave, entry.a_pagar.total]));
    same(byTribute, { irpj: 443.12, icms: 1484.56, null: 60 }, "por tributo");
    const byCompany = Object.fromEntries(p.por_empresa.map((entry) => [entry.chave, [entry.a_pagar.total, entry.vencidas.total]]));
    same(byCompany, { [ids.entA1]: [493.12, 180], [ids.entA2]: [1494.56, 0] }, "por empresa");
    same(Object.fromEntries(p.por_esfera.map((entry) => [entry.chave, entry.a_pagar.total])), { federal: 503.12, estadual: 1484.56 }, "por esfera");
    same(p.por_parcelamento.length, 4, "por parcelamento: só os ativos com parcela");

    // Período estendido alcança a parcela de daqui a 12 meses.
    const longer = await call(users.ownerA, "GET", `/api/tax/planning?inicio=${month}&fim=${addMonths(month, 12)}`);
    same([longer.status, longer.json?.meses?.length, longer.json?.totais?.a_pagar?.total], [200, 13, 2687.68], "período informado");

    // Filtros.
    const filtered = async (query) => (await call(users.ownerA, "GET", `/api/tax/planning?${query}`)).json;
    same((await filtered(`entity_id=${ids.entA2}`)).totais.a_pagar.total, 1494.56, "filtro por empresa");
    same((await filtered("esfera=estadual")).totais.a_pagar.total, 1484.56, "filtro por esfera");
    same((await filtered("tributo=IRPJ")).totais.a_pagar.total, 443.12, "filtro por tributo sem diferenciar maiúsculas");
    same((await filtered("tributo=null")).totais.a_pagar.total, 60, "filtro por tributo não informado");
    same((await filtered(`orgao=${encodeURIComponent("receita federal")}`)).totais.a_pagar.total, 60, "filtro por órgão");
    same((await filtered(`agreement_id=${ag.A2}`)).totais.a_pagar.total, 1484.56, "filtro por parcelamento");
    same((await filtered("esfera=estadual")).vencidas.a_pagar.total, 0, "filtro vale também para as vencidas");
    const badSphere = await call(users.ownerA, "GET", "/api/tax/planning?esfera=municipal");
    same([badSphere.status, badSphere.json?.code], [400, "TAX_VALIDATION"], "esfera inválida");
    const badMonth = await call(users.ownerA, "GET", "/api/tax/planning?inicio=2026-13");
    same([badMonth.status, badMonth.json?.details?.field], [400, "inicio"], "mês inválido");

    // Isolamento: filtro com empresa/parcelamento de outro cliente é recusado (não vira "nada a pagar").
    const foreignEntity = await call(users.ownerA, "GET", `/api/tax/planning?entity_id=${ids.entB}`);
    same([foreignEntity.status, foreignEntity.json?.code], [404, "NOT_FOUND"], "empresa de outro cliente");
    const foreignAgreement = await call(users.ownerA, "GET", `/api/tax/planning?agreement_id=${ag.B1}`);
    same(foreignAgreement.status, 404, "parcelamento de outro cliente");
    const planB = await call(users.ownerB, "GET", "/api/tax/planning");
    same([planB.json?.totais?.a_pagar?.total, planB.json?.vencidas?.a_pagar?.total], [5555, 4444], "cliente B vê só o dele");

    // Módulo e perfil.
    const noTax = await call(users.noTaxA, "GET", "/api/tax/planning");
    same([noTax.status, noTax.json?.code], [403, "MODULE_FORBIDDEN"], "sem o módulo");
    const viewer = await call(users.viewerA, "GET", "/api/tax/planning");
    same([viewer.status, viewer.json?.totais?.a_pagar?.total], [200, 1987.68], "perfil de visualização lê o planejamento");

    // Sem teto de leitura.
    const planC = await call(users.ownerC, "GET", "/api/tax/planning");
    same([planC.json?.totais?.a_pagar?.parcelas, planC.json?.totais?.a_pagar?.total], [1200, 1200], "1.200 parcelas somadas no servidor");

    // ---- Preferências ----
    const prefsNoTax = await call(users.noTaxA, "GET", "/api/me/preferences");
    same(prefsNoTax.json?.preferencias, {
      dashboard_tributos: { disponivel: false, ligado: false, padrao: true },
      alertas_tributarios: { disponivel: false, ligado: false, padrao: true },
    }, "sem o módulo: opções indisponíveis e desligadas");
    const prefsOwner = await call(users.ownerA, "GET", "/api/me/preferences");
    same(prefsOwner.json?.preferencias, {
      dashboard_tributos: { disponivel: true, ligado: true, padrao: true },
      alertas_tributarios: { disponivel: true, ligado: true, padrao: true },
    }, "com o módulo: padrão ligado");
    const forbidden = await call(users.noTaxA, "PATCH", "/api/me/preferences", { dashboard_tributos: true });
    same([forbidden.status, forbidden.json?.code], [403, "MODULE_FORBIDDEN"], "sem o módulo não liga");
    for (const [body, label] of [[{}, "vazio"], [{ outra: true }, "chave desconhecida"], [{ dashboard_tributos: "sim" }, "não booleano"], [[true], "lista"]]) {
      const bad = await call(users.ownerA, "PATCH", "/api/me/preferences", body);
      same([bad.status, bad.json?.code], [400, "VALIDATION"], `preferência inválida (${label})`);
    }

    // ---- Dashboard ----
    const dataBase = lastDayOfMonth(month);
    const summaryPath = (entity = "all") => `/api/dashboard/summary?entity_id=${entity}&data_base=${dataBase}`;
    const direct = await runWithTenant({ groupId: ids.groupA, tenantId: ids.tenantA, email: users.noTaxA.email }, () => getDashboardSummary({ entityId: "all", dataBase }));
    const dashNoTax = await call(users.noTaxA, "GET", summaryPath());
    check(dashNoTax.status === 200, `dashboard sem o módulo: ${dashNoTax.status}`);
    same(dashNoTax.json, JSON.parse(JSON.stringify(direct)), "sem o módulo: resposta idêntica à de antes");
    check(!("vencimentosTributarios" in dashNoTax.json), "sem o módulo: sem série dos tributos");

    const dashOn = await call(users.ownerA, "GET", summaryPath());
    const { vencimentosTributarios: taxSeries, ...bankPart } = dashOn.json || {};
    same(bankPart, dashNoTax.json, "com o módulo: a parte bancária não muda");
    same(taxSeries?.ok, true, "série dos tributos presente (padrão ligado)");
    // Mesmas empresas da dívida bancária: só a Alfa está liberada; a Beta (aguardando implantação) fica fora.
    same(taxSeries?.escopo_empresas, "mesmas_da_divida_bancaria", "escopo: mesmas empresas da dívida bancária");
    same([taxSeries?.d30?.total, taxSeries?.d30?.com_guia, taxSeries?.d30?.estimado, taxSeries?.d30?.pago, taxSeries?.d30?.parcelas_pagas_sem_valor, taxSeries?.d90?.total, taxSeries?.d180?.total, taxSeries?.vencidas?.total],
      [770.5, 0, 360, 410.5, 1, 770.5, 770.5, 180], "janelas dos tributos como as bancárias (pagas pelo valor pago), só da empresa liberada; vencidas à parte; parcela até a data-base, cancelada e quitado fora");
    same(taxSeries?.dataBase, dataBase, "data-base da série");
    // Data-base antiga (a janela de 180 dias termina antes de hoje): as vencidas continuam todas lá.
    const oldBase = lastDayOfMonth(addMonths(month, -8));
    const dashOld = await call(users.ownerA, "GET", `/api/dashboard/summary?entity_id=all&data_base=${oldBase}`);
    same([dashOld.json?.vencimentosTributarios?.vencidas?.total, dashOld.json?.vencimentosTributarios?.d180?.total], [180, 0], "data-base antiga: vencidas todas, janelas sem o que já venceu");
    const dashEntity = await call(users.ownerA, "GET", summaryPath(ids.entA1));
    same([dashEntity.json?.vencimentosTributarios?.d30?.total, dashEntity.json?.vencimentosTributarios?.vencidas?.total], [770.5, 180], "série dos tributos segue a empresa escolhida");
    // Empresa escolhida aguardando implantação: o resumo bancário bloqueia, e a série mostra a empresa, rotulada.
    const dashBlocked = await call(users.ownerA, "GET", summaryPath(ids.entA2));
    const blockedSeries = dashBlocked.json?.vencimentosTributarios;
    same([dashBlocked.json?.blocked, blockedSeries?.escopo_empresas, blockedSeries?.d30?.total, blockedSeries?.d30?.com_guia, blockedSeries?.d90?.total, blockedSeries?.vencidas?.total],
      [true, "todas_aguardando_implantacao", 1244.56, 1234.56, 1494.56, 0], "nenhuma empresa liberada: todas as ativas do filtro, com o escopo informado");

    const off = await call(users.ownerA, "PATCH", "/api/me/preferences", { dashboard_tributos: false });
    same(off.json?.preferencias?.dashboard_tributos, { disponivel: true, ligado: false, padrao: true }, "desligar devolve o estado novo");
    const prefAudit = async () => (await pool.query(
      `SELECT actor_email, rotina, registro, before_json, after_json FROM audit_events
        WHERE group_id = $1 AND resource_type = 'UserPreference' ORDER BY occurred_at DESC`,
      [ids.groupA]
    )).rows;
    const audits = await prefAudit();
    same([audits.length, audits[0]?.rotina, audits[0]?.actor_email?.toLowerCase(), audits[0]?.before_json, audits[0]?.after_json],
      [1, "Preferências", users.ownerA.email.toLowerCase(), { "Vencimentos dos tributos no Dashboard": "Ligado" }, { "Vencimentos dos tributos no Dashboard": "Desligado" }],
      "auditoria da mudança de preferência, com o nome da opção e o antes/depois");
    check(String(audits[0]?.registro).includes("Vencimentos dos tributos no Dashboard desligado"), `registro da auditoria: ${audits[0]?.registro}`);
    await call(users.ownerA, "PATCH", "/api/me/preferences", { dashboard_tributos: false });
    same((await prefAudit()).length, 1, "pedido sem mudança não gera auditoria");
    const dashOff = await call(users.ownerA, "GET", summaryPath());
    same(dashOff.json, dashNoTax.json, "desligado: resposta idêntica à de quem não tem o módulo");
    const viewerDash = await call(users.viewerA, "GET", summaryPath());
    check(viewerDash.json?.vencimentosTributarios?.ok === true, "a preferência de um usuário não muda a do outro");
    const bDash = await call(users.ownerB, "GET", `/api/dashboard/summary?entity_id=all&data_base=${dataBase}`);
    same(bDash.json?.vencimentosTributarios?.vencidas?.total, 4444, "cliente B: só as vencidas dele");
    const onAgain = await call(users.ownerA, "PATCH", "/api/me/preferences", { dashboard_tributos: true });
    same(onAgain.json?.preferencias?.dashboard_tributos?.ligado, true, "religar");
    same((await call(users.ownerA, "GET", summaryPath())).json?.vencimentosTributarios?.d30?.total, 770.5, "religado: série volta");
    const viewerOff = await call(users.viewerA, "PATCH", "/api/me/preferences", { alertas_tributarios: false });
    same([viewerOff.status, viewerOff.json?.preferencias?.alertas_tributarios?.ligado], [200, false], "perfil de visualização muda a própria preferência");
    same((await call(users.ownerA, "GET", "/api/me/preferences")).json?.preferencias?.alertas_tributarios?.ligado, true, "preferência é por usuário");
    const viewerInB = await call({ ...users.viewerA, tenant: ids.tenantB, group: ids.groupB }, "GET", "/api/me/preferences");
    same(viewerInB.json?.preferencias?.alertas_tributarios?.ligado, true, "preferência é por cliente: desligada no A, ligada no B");

    // Falha ao ler a preferência: o resumo bancário continua; a série vem como falha, nunca zero.
    const realQuery = pool.query;
    pool.query = function patched(text, ...rest) {
      if (typeof text === "string" && text.includes("FROM user_preferences")) return Promise.reject(new Error("preferências fora do ar (teste)"));
      return realQuery.call(this, text, ...rest);
    };
    let prefFail;
    let prefFailNoTax;
    try {
      prefFail = await call(users.ownerA, "GET", summaryPath());
      prefFailNoTax = await call(users.noTaxA, "GET", summaryPath());
    } finally {
      pool.query = realQuery;
    }
    const { vencimentosTributarios: failedSeries, ...failedBank } = prefFail.json || {};
    same([prefFail.status, failedSeries?.ok, typeof failedSeries?.mensagem, "d30" in (failedSeries || {}), failedSeries?.escopo_empresas],
      [200, false, "string", false, "mesmas_da_divida_bancaria"], "falha na preferência: série como falha, sem números");
    same(failedBank, dashNoTax.json, "falha na preferência: resumo bancário inteiro");
    same(prefFailNoTax.json, dashNoTax.json, "falha na preferência não muda nada para quem não tem o módulo");

    // Duas preferências num pedido: gravadas juntas ou nenhuma.
    const scopeA = { groupId: ids.groupA, tenantId: ids.tenantA, email: users.ownerA.email, permissions: { tax: true } };
    const beforeAtomic = (await call(users.ownerA, "GET", "/api/me/preferences")).json?.preferencias;
    const realConnect = pool.connect;
    pool.connect = async function patchedConnect() {
      const conn = await realConnect.call(this);
      const realClientQuery = conn.query;
      let inserts = 0;
      conn.query = function q(text, ...rest) {
        if (typeof text === "string" && text.includes("INSERT INTO user_preferences") && ++inserts === 2) {
          return Promise.reject(new Error("falha na segunda gravação (teste)"));
        }
        return realClientQuery.call(this, text, ...rest);
      };
      const realRelease = conn.release;
      conn.release = function release(...args) {
        conn.query = realClientQuery;
        conn.release = realRelease;
        return realRelease.apply(this, args);
      };
      return conn;
    };
    let atomicError = null;
    try {
      await runWithTenant(scopeA, () => updateMyPreferences({ dashboard_tributos: !beforeAtomic.dashboard_tributos.ligado, alertas_tributarios: !beforeAtomic.alertas_tributarios.ligado }));
    } catch (error) {
      atomicError = error;
    } finally {
      pool.connect = realConnect;
    }
    check(atomicError?.message === "falha na segunda gravação (teste)", `falha simulada na segunda gravação: ${atomicError?.message}`);
    same((await call(users.ownerA, "GET", "/api/me/preferences")).json?.preferencias, beforeAtomic, "falha no meio: nenhuma das duas preferências mudou");
    const both = await call(users.ownerA, "PATCH", "/api/me/preferences", { dashboard_tributos: false, alertas_tributarios: false });
    same([both.json?.preferencias?.dashboard_tributos?.ligado, both.json?.preferencias?.alertas_tributarios?.ligado], [false, false], "as duas num pedido");
    same([(await prefAudit())[0]?.before_json, (await prefAudit())[0]?.after_json],
      [{ "Vencimentos dos tributos no Dashboard": "Ligado", "Alertas de vencimento dos tributos por e-mail": "Ligado" }, { "Vencimentos dos tributos no Dashboard": "Desligado", "Alertas de vencimento dos tributos por e-mail": "Desligado" }],
      "auditoria das duas mudanças");

    // Falha na leitura: nunca zero.
    const originalQuery = pool.query;
    pool.query = () => Promise.reject(new Error("banco fora do ar (teste)"));
    let failed;
    try {
      failed = await runWithTenant({ groupId: ids.groupA, tenantId: ids.tenantA, email: users.ownerA.email }, () => getDashboardTaxDue({ entityIds: [ids.entA1], dataBase }));
    } finally {
      pool.query = originalQuery;
    }
    check(failed?.ok === false && typeof failed.mensagem === "string" && !("d30" in failed) && !("vencidas" in failed), `falha na leitura não vira zero: ${JSON.stringify(failed)}`);
  } finally {
    server.close();
    const groups = [ids.groupA, ids.groupB, ids.groupC];
    await pool.query(`DELETE FROM tax_payable_titles WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM tax_agreements WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM user_preferences WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM tenant_users WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(users).map((u) => u.id)]);
    await pool.query(`DELETE FROM tenants WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM company_entities WHERE group_id = ANY($1::text[])`, [groups]);
    await pool.query(`DELETE FROM groups WHERE id = ANY($1::text[])`, [groups]).catch(() => {});
  }

  if (failures.length) {
    console.error(`planejamento tributário: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log("planejamento tributário ok: calendário, fluxo de caixa, Dashboard e preferências");
  await pool.end();
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  for (const message of failures) console.error(` - ${message}`);
  pool.end().finally(() => process.exit(1));
});
