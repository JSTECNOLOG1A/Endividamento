import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { mapDbError } from "../entities/store.js";

// Gestão Tributária pelo CRUD genérico, de ponta a ponta (HTTP → rotas → store → banco).
// Rodar também com TZ positivo (ex.: TZ=Pacific/Kiritimati) para provar que data civil não desloca.

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

function jsonRequest(server, { method, path, body, token }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const payload = body == null ? null : JSON.stringify(body);
    const req = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method,
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

function expectError(res, status, messagePart, label) {
  const ok = res.status === status && typeof res.json?.error === "string" && res.json.error.includes(messagePart);
  check(ok, `${label}: esperado ${status} com "${messagePart}", veio ${res.status} ${JSON.stringify(res.json)}`);
}

async function main() {
  const suffix = `${Date.now()}`;
  const groupA = `grp_tax_a_${suffix}`;
  const groupB = `grp_tax_b_${suffix}`;
  const entityA = `ent_tax_a_${suffix}`;
  const entityA2 = `ent_tax_a2_${suffix}`;
  const entityA3 = `ent_tax_a3_${suffix}`;
  const contractA3 = `ctr_tax_a3_${suffix}`;
  const titleA3 = `ttl_tax_a3_${suffix}`;
  const entityB = `ent_tax_b_${suffix}`;
  const tenantA = `tnt_tax_a_${suffix}`;
  const tenantB = `tnt_tax_b_${suffix}`;
  const users = {
    ownerA: { id: randomUUID(), email: `owner-a-${suffix}@tax.test`, role: "admin", tenantRole: "OWNER", tenant: tenantA, group: groupA, tax: true },
    noTaxA: { id: randomUUID(), email: `notax-a-${suffix}@tax.test`, role: "admin", tenantRole: "ADMIN", tenant: tenantA, group: groupA, tax: false },
    viewerA: { id: randomUUID(), email: `viewer-a-${suffix}@tax.test`, role: "viewer", tenantRole: "VIEWER", tenant: tenantA, group: groupA, tax: true },
    ownerB: { id: randomUUID(), email: `owner-b-${suffix}@tax.test`, role: "admin", tenantRole: "OWNER", tenant: tenantB, group: groupB, tax: true },
  };

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Teste Tributário A','ativo','teste'), ($2,'Teste Tributário B','ativo','teste')`,
      [groupA, groupB]
    );
    await pool.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
       VALUES ($1,$2,'Empresa A','00.000.000/0001-71','CNPJ','empresa','71','01','ativa','teste'),
              ($3,$2,'Empresa A2','00.000.000/0001-72','CNPJ','empresa','72','01','ativa','teste'),
              ($4,$5,'Empresa B','00.000.000/0001-73','CNPJ','empresa','73','01','ativa','teste')`,
      [entityA, groupA, entityA2, entityB, groupB]
    );
    // Empresa com contrato e contrato com título: vizinhos que impedem a exclusão.
    const bank = await pool.query(`SELECT id FROM banks ORDER BY created_date ASC LIMIT 1`);
    if (!bank.rows[0]) throw new Error("É preciso ao menos um banco cadastrado para o teste");
    await pool.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
       VALUES ($1,$2,'Empresa A3','00.000.000/0001-74','CNPJ','empresa','74','01','ativa','teste')`,
      [entityA3, groupA]
    );
    await pool.query(
      `INSERT INTO loan_contracts (id, group_id, entity_id, bank_id, contract_number, status, created_by)
       VALUES ($1,$2,$3,$4,'TAXA3','rascunho','teste')`,
      [contractA3, groupA, entityA3, bank.rows[0].id]
    );
    await pool.query(
      `INSERT INTO payable_titles (id, group_id, entity_id, contract_id, parcela, titulo_numero, valor, saldo, status, created_by)
       VALUES ($1,$2,$3,$4,'001','000000099',10,10,'aberto','teste')`,
      [titleA3, groupA, entityA3, contractA3]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'Tributário A','STARTER','trial',$5,'teste'), ($3,$4,'Tributário B','STARTER','trial',$6,'teste')`,
      [tenantA, groupA, tenantB, groupB, users.ownerA.email, users.ownerB.email]
    );
    for (const user of Object.values(users)) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_by) VALUES ($1,$2,'hash',$3,$4,'active','teste')`,
        [user.id, user.email, user.email, user.role]
      );
      await pool.query(
        `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, permissions, created_by) VALUES ($1,$2,$3,$4,$5,$6,'teste')`,
        [`tu_${user.id}`, user.tenant, user.group, user.email, user.tenantRole, user.tax ? { tax: true } : {}]
      );
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  const token = (user) => issueAuthResponse(
    { id: user.id, email: user.email, full_name: user.email, role: user.role, platform_admin: false },
    { id: user.tenant, group_id: user.group, tenant_name: "Teste", tenant_role: user.tenantRole, billing_status: "trial", plan: "STARTER" }
  ).token;
  const tA = token(users.ownerA);
  const tNoTax = token(users.noTaxA);
  const tViewer = token(users.viewerA);
  const tB = token(users.ownerB);

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const call = (t, method, path, body) => jsonRequest(server, { method, path: `/api/entities${path}`, body, token: t });

  try {
    // ---- Parcelamento: criação com procedência forjada ----
    const created = await call(tA, "POST", "/TaxAgreement", {
      entity_id: entityA,
      esfera: "Federal",
      orgao: " Receita Federal ",
      uf: "SP",
      modalidade: "Simplificado",
      codigo_parcelamento: "PARC-001",
      data_adesao: "2026-01-31",
      qtd_parcelas: 3,
      saldo_oficial: "1500.50",
      saldo_data_base: "2026-02-28",
      origem_dado: "api",
      group_id: groupB,
      created_by: "receita@gov.br",
      selo_oficial: true,
    });
    check(created.status === 201, `criar parcelamento: esperado 201, veio ${created.status} ${JSON.stringify(created.json)}`);
    const agreement = created.json || {};
    check(agreement.origem_dado === "manual", `dado digitado com origem "api" deveria ser gravado como manual, veio ${agreement.origem_dado}`);
    check(agreement.group_id === groupA, "parcelamento deveria ficar no grupo do usuário, não no grupo enviado");
    check(agreement.created_by === users.ownerA.email, `autoria deveria ser o usuário logado, veio ${agreement.created_by}`);
    check(agreement.selo_oficial === undefined, "campo desconhecido não pode ser guardado no parcelamento");
    check(agreement.uf === null, `UF de parcelamento federal deveria ser ignorada, veio ${agreement.uf}`);
    check(agreement.esfera === "federal" && agreement.orgao === "Receita Federal", "esfera e órgão normalizados");
    check(agreement.data_adesao === "2026-01-31" && agreement.saldo_data_base === "2026-02-28", `datas do parcelamento deslocadas: ${agreement.data_adesao} ${agreement.saldo_data_base}`);
    check(agreement.situacao === "ativo", "situação padrão do parcelamento é ativo");

    const stored = await pool.query(`SELECT origem_dado, extra_json, group_id FROM tax_agreements WHERE id = $1`, [agreement.id]);
    check(stored.rows[0]?.origem_dado === "manual" && stored.rows[0]?.extra_json === null, "banco: origem manual e sem campos extras");

    // ---- Edição não troca a procedência nem o grupo ----
    const edited = await call(tA, "PATCH", `/TaxAgreement/${agreement.id}`, { origem_dado: "importado", observacoes: "conferido no e-CAC", group_id: groupB });
    check(edited.status === 200 && edited.json?.origem_dado === "manual", `edição não pode trocar a origem para importado, veio ${edited.status} ${edited.json?.origem_dado}`);
    check(edited.json?.group_id === groupA, "edição não pode trocar o grupo");

    // ---- Saldo trocado sem nova conferência deixa de estar conferido ----
    const patchAgreement = (body) => call(tA, "PATCH", `/TaxAgreement/${agreement.id}`, body);
    const conferred = await patchAgreement({ ultima_conferencia: "2026-09-01" });
    check(conferred.json?.ultima_conferencia === "2026-09-01", `marcar conferência: ${conferred.json?.ultima_conferencia}`);
    const sameBalance = await patchAgreement({ saldo_oficial: "1500.5", saldo_data_base: "2026-02-28" });
    check(sameBalance.status === 200 && sameBalance.json?.ultima_conferencia === "2026-09-01", `reenviar o mesmo saldo não pode apagar a conferência, veio ${sameBalance.json?.ultima_conferencia}`);
    // O banco guarda centavos: um valor que arredonda para o mesmo saldo não é saldo novo.
    const sameCents = await patchAgreement({ saldo_oficial: "1500.501" });
    check(sameCents.json?.saldo_oficial === 1500.5 && sameCents.json?.ultima_conferencia === "2026-09-01", `saldo igual nos centavos não pode apagar a conferência, veio ${sameCents.json?.saldo_oficial} ${sameCents.json?.ultima_conferencia}`);
    const otherField = await patchAgreement({ observacoes: "sem mudança de saldo" });
    check(otherField.json?.ultima_conferencia === "2026-09-01", "editar outro campo mantém a conferência");
    const newBalance = await patchAgreement({ saldo_oficial: 1400 });
    check(newBalance.status === 200 && newBalance.json?.ultima_conferencia === null && newBalance.json?.saldo_oficial === 1400, `saldo novo sem conferência deveria ficar nunca conferido, veio ${newBalance.json?.ultima_conferencia}`);
    await patchAgreement({ ultima_conferencia: "2026-09-02" });
    const newBaseDate = await patchAgreement({ saldo_data_base: "2026-03-31" });
    check(newBaseDate.json?.ultima_conferencia === null, `data-base nova sem conferência deveria ficar nunca conferido, veio ${newBaseDate.json?.ultima_conferencia}`);
    const conferredNow = await patchAgreement({ saldo_oficial: 1300, ultima_conferencia: "2026-10-01" });
    check(conferredNow.json?.ultima_conferencia === "2026-10-01" && conferredNow.json?.saldo_oficial === 1300, `saldo novo com conferência enviada vale a data enviada, veio ${conferredNow.json?.ultima_conferencia}`);
    expectError(await patchAgreement({ saldo_oficial: 1200, ultima_conferencia: "2999-01-01" }), 400, "não pode ser no futuro", "conferência enviada continua validada");

    // Registro que veio de importação, editado à mão, deixa de parecer oficial.
    const importedId = `tax_imp_${suffix}`;
    await pool.query(
      `INSERT INTO tax_agreements (id, group_id, entity_id, esfera, orgao, modalidade, codigo_parcelamento, origem_dado, created_by)
       VALUES ($1,$2,$3,'federal','PGFN','Transação','IMP-1','importado','teste')`,
      [importedId, groupA, entityA]
    );
    const touched = await call(tA, "PATCH", `/TaxAgreement/${importedId}`, { observacoes: "valor ajustado à mão" });
    check(touched.status === 200 && touched.json?.origem_dado === "manual", `edição manual de registro importado deveria virar manual, veio ${touched.status} ${touched.json?.origem_dado}`);

    // ---- Validações do parcelamento ----
    const base = { entity_id: entityA, esfera: "estadual", uf: "MG", orgao: "SEF-MG", modalidade: "ICMS", codigo_parcelamento: "EST-1" };
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, esfera: "municipal" }), 400, "municipal ainda não está disponível", "esfera municipal");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, esfera: "distrital" }), 400, "Esfera inválida", "esfera inválida");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, esfera: undefined }), 400, "Selecione a esfera", "esfera ausente");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, uf: "" }), 400, "Informe a UF", "estadual sem UF");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, uf: "XX" }), 400, "UF inválida", "UF inexistente");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, entity_id: "" }), 400, "Selecione a empresa", "sem empresa");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, orgao: "  " }), 400, "Informe o órgão", "sem órgão");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, modalidade: null }), 400, "Informe a modalidade", "sem modalidade");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, codigo_parcelamento: "" }), 400, "Informe o número do parcelamento", "sem número");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, entity_id: entityB }), 400, "empresa selecionada não foi encontrada", "empresa de outro grupo");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, qtd_parcelas: 1.5 }), 400, "quantidade de parcelas", "quantidade fracionada");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, saldo_oficial: -1, saldo_data_base: "2026-01-01" }), 400, "não pode ser negativo", "saldo negativo");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, saldo_oficial: 10 }), 400, "data-base do saldo", "saldo sem data-base");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, data_adesao: "2026-02-30" }), 400, "Informe uma data válida no campo data de adesão", "data inexistente");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, data_adesao: "2026-02-10T03:00:00.000Z" }), 400, "Informe uma data válida no campo data de adesão", "data com horário");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, situacao: "cancelado" }), 400, "Situação do parcelamento inválida", "situação inválida");
    expectError(await call(tA, "POST", "/TaxAgreement", { ...base, ultima_conferencia: "2999-01-01" }), 400, "não pode ser no futuro", "conferência no futuro");

    const estadual = await call(tA, "POST", "/TaxAgreement", { ...base, uf: "mg" });
    check(estadual.status === 201 && estadual.json?.uf === "MG", `estadual com UF minúscula deveria gravar MG, veio ${estadual.status} ${estadual.json?.uf}`);
    // Trocar para federal apaga a UF; voltar para estadual sem UF é recusado.
    const toFederal = await call(tA, "PATCH", `/TaxAgreement/${estadual.json?.id}`, { esfera: "federal" });
    check(toFederal.status === 200 && toFederal.json?.uf === null, `virar federal deveria limpar UF, veio ${toFederal.json?.uf}`);
    expectError(await call(tA, "PATCH", `/TaxAgreement/${estadual.json?.id}`, { esfera: "estadual" }), 400, "Informe a UF", "voltar a estadual sem UF");
    expectError(await call(tA, "PATCH", `/TaxAgreement/${estadual.json?.id}`, { entity_id: entityB }), 400, "empresa selecionada não foi encontrada", "edição para empresa de outro grupo");
    expectError(await call(tA, "PATCH", `/TaxAgreement/${estadual.json?.id}`, { orgao: "" }), 400, "Informe o órgão", "edição apagando órgão");

    // ---- Unicidade do parcelamento ----
    expectError(
      await call(tA, "POST", "/TaxAgreement", { entity_id: entityA, esfera: "federal", orgao: "Receita Federal", modalidade: "Simplificado", codigo_parcelamento: "PARC-001" }),
      409, "Já existe um parcelamento com esse número", "parcelamento repetido"
    );
    // Mesma chave escrita com outra caixa ou com espaços sobrando é o mesmo parcelamento.
    expectError(
      await call(tA, "POST", "/TaxAgreement", { entity_id: entityA, esfera: "federal", orgao: "  receita   federal ", modalidade: " simplificado", codigo_parcelamento: "parc-001 " }),
      409, "Já existe um parcelamento com esse número", "parcelamento repetido com outra caixa e espaços"
    );
    let dbGuard = null;
    try {
      await pool.query(
        `INSERT INTO tax_agreements (id, group_id, entity_id, esfera, orgao, modalidade, codigo_parcelamento)
         VALUES ($1,$2,$3,'federal','RECEITA FEDERAL','SIMPLIFICADO','parc-001')`,
        [`tax_dup_${suffix}`, groupA, entityA]
      );
    } catch (error) {
      dbGuard = error;
    }
    check(dbGuard?.code === "23505" && dbGuard?.constraint === "tax_agreements_code_norm_uidx", `banco deveria recusar a mesma chave com outra caixa por qualquer caminho, veio ${dbGuard?.code} ${dbGuard?.constraint}`);
    const canonical = await call(tA, "POST", "/TaxAgreement", { entity_id: entityA, esfera: "federal", orgao: " pgfn ", modalidade: "Transação   Excepcional", codigo_parcelamento: "PARC  002" });
    check(
      canonical.status === 201 && canonical.json?.orgao === "PGFN" && canonical.json?.modalidade === "Transação Excepcional" && canonical.json?.codigo_parcelamento === "PARC 002",
      `órgão sugerido deveria gravar na grafia canônica e sem espaços repetidos, veio ${canonical.status} ${JSON.stringify(canonical.json)}`
    );
    const otherCompany = await call(tA, "POST", "/TaxAgreement", { entity_id: entityA2, esfera: "federal", orgao: "Receita Federal", modalidade: "Simplificado", codigo_parcelamento: "PARC-001" });
    check(otherCompany.status === 201, "mesmo número em outra empresa é permitido");

    // ---- Parcelas em lote: tudo ou nada ----
    const partial = await call(tA, "POST", "/TaxInstallment/bulk", [
      { agreement_id: agreement.id, numero_parcela: 1, vencimento: "2026-03-31", valor: 500 },
      { agreement_id: agreement.id, numero_parcela: 2, vencimento: "2026-04-30", valor: 500 },
      { agreement_id: agreement.id, numero_parcela: 2, vencimento: "2026-05-31", valor: 500 },
    ]);
    expectError(partial, 409, "Já existe uma parcela com esse número", "lote com parcela repetida");
    const afterPartial = await pool.query(`SELECT count(*)::int AS n FROM tax_installments WHERE agreement_id = $1`, [agreement.id]);
    check(afterPartial.rows[0].n === 0, `lote recusado não pode deixar parcelas gravadas, ficaram ${afterPartial.rows[0].n}`);

    const invalidInBulk = await call(tA, "POST", "/TaxInstallment/bulk", [
      { agreement_id: agreement.id, numero_parcela: 1, vencimento: "2026-03-31", valor: 500 },
      { agreement_id: agreement.id, numero_parcela: 2, vencimento: "2026-04-31", valor: 500 },
    ]);
    expectError(invalidInBulk, 400, "Informe uma data válida no campo vencimento", "lote com vencimento inexistente");
    const afterInvalid = await pool.query(`SELECT count(*)::int AS n FROM tax_installments WHERE agreement_id = $1`, [agreement.id]);
    check(afterInvalid.rows[0].n === 0, `lote com data inválida não pode deixar parcelas gravadas, ficaram ${afterInvalid.rows[0].n}`);

    const bulk = await call(tA, "POST", "/TaxInstallment/bulk", [
      { agreement_id: agreement.id, numero_parcela: 1, vencimento: "2026-03-31", valor: 500, origem_dado: "api", group_id: groupB },
      { agreement_id: agreement.id, numero_parcela: 2, vencimento: "2026-04-30", valor: "500.25" },
      { agreement_id: agreement.id, numero_parcela: 3, vencimento: "2026-12-31", valor: 499.75 },
    ]);
    check(bulk.status === 201 && Array.isArray(bulk.json) && bulk.json.length === 3, `lote válido deveria criar 3 parcelas, veio ${bulk.status} ${JSON.stringify(bulk.json)}`);
    const parcels = Array.isArray(bulk.json) ? bulk.json : [];
    check(parcels.every((p) => p.origem_dado === "manual" && p.group_id === groupA), "parcelas do lote: origem manual e grupo do parcelamento");
    check(parcels.map((p) => p.vencimento).join(",") === "2026-03-31,2026-04-30,2026-12-31", `vencimentos do lote deslocados: ${parcels.map((p) => p.vencimento).join(",")}`);
    check(parcels[1]?.valor === 500.25 && parcels[0]?.situacao === "em_aberto", "valor numérico e situação padrão em aberto");

    // ---- Data civil: ida e volta em leitura, filtro e lista ----
    const byId = await call(tA, "GET", `/TaxInstallment/${parcels[2]?.id}`);
    check(byId.json?.vencimento === "2026-12-31", `GET por id deslocou o vencimento: ${byId.json?.vencimento}`);
    const filtered = await call(tA, "POST", "/TaxInstallment/filter", { query: { agreement_id: agreement.id, vencimento: "2026-03-31" } });
    check(Array.isArray(filtered.json) && filtered.json.length === 1 && filtered.json[0].numero_parcela === 1, `filtro por vencimento: ${JSON.stringify(filtered.json)}`);
    const listed = await call(tA, "GET", "/TaxInstallment?sort=vencimento&limit=50");
    const listedOwn = (listed.json || []).filter((p) => p.agreement_id === agreement.id).map((p) => p.vencimento).join(",");
    check(listedOwn === "2026-03-31,2026-04-30,2026-12-31", `listagem deslocou datas: ${listedOwn}`);
    const badFilter = await call(tA, "POST", "/TaxInstallment/filter", { query: { vencimento: "2026-02-30" } });
    check(badFilter.status === 400, `filtro com data inexistente deveria ser 400, veio ${badFilter.status}`);

    // ---- Validações da parcela ----
    const inst = { agreement_id: agreement.id, numero_parcela: 9, vencimento: "2026-09-30", valor: 10 };
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, numero_parcela: 0 }), 400, "maior que zero", "parcela zero");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, numero_parcela: 2.5 }), 400, "maior que zero", "parcela fracionada");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, numero_parcela: "" }), 400, "Informe o número da parcela", "parcela sem número");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, vencimento: null }), 400, "Informe o vencimento", "sem vencimento");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, valor: -0.01 }), 400, "não pode ser negativo", "valor negativo");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, valor: "" }), 400, "Informe o valor da parcela", "valor vazio");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, valor: "abc" }), 400, "Informe um número válido no campo valor da parcela", "valor não numérico");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, agreement_id: "" }), 400, "Selecione o parcelamento", "sem parcelamento");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, situacao: "reconhecida" }), 400, "Informe a data de pagamento", "paga sem data");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, situacao: "paga_aguardando_reconhecimento", data_pagamento: "2999-01-01" }), 400, "não pode ser no futuro", "pagamento no futuro");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, data_pagamento: "2026-09-01" }), 400, "Parcela em aberto não pode ter data", "em aberto com data de pagamento");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, situacao: "cancelada", valor_pago: 10 }), 400, "Parcela cancelada não pode ter", "cancelada com valor pago");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, situacao: "paga" }), 400, "Situação da parcela inválida", "situação inválida");
    expectError(await call(tA, "POST", "/TaxInstallment", { ...inst, numero_parcela: 1 }), 409, "Já existe uma parcela com esse número", "parcela repetida");

    const paid = await call(tA, "POST", "/TaxInstallment", { ...inst, situacao: "reconhecida", data_pagamento: "2026-09-30", valor_pago: 10 });
    check(paid.status === 201 && paid.json?.data_pagamento === "2026-09-30", `parcela paga: ${paid.status} ${JSON.stringify(paid.json)}`);
    // Voltar para em aberto sem limpar o pagamento é recusado; limpando, passa.
    expectError(await call(tA, "PATCH", `/TaxInstallment/${paid.json?.id}`, { situacao: "em_aberto" }), 400, "Parcela em aberto não pode ter data", "reabrir sem limpar pagamento");
    const importedInstallmentId = `tax_inst_imp_${suffix}`;
    await pool.query(
      `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor, origem_dado, created_by)
       VALUES ($1,$2,$3,77,'2027-01-31',10,'api','teste')`,
      [importedInstallmentId, groupA, agreement.id]
    );
    const touchedInstallment = await call(tA, "PATCH", `/TaxInstallment/${importedInstallmentId}`, { valor: 11 });
    check(touchedInstallment.json?.origem_dado === "manual", `parcela vinda da API editada à mão deveria virar manual, veio ${touchedInstallment.json?.origem_dado}`);
    await pool.query(`DELETE FROM tax_installments WHERE id = $1`, [importedInstallmentId]);

    const reopened = await call(tA, "PATCH", `/TaxInstallment/${paid.json?.id}`, { situacao: "em_aberto", data_pagamento: null, valor_pago: null, origem_dado: "api" });
    check(reopened.status === 200 && reopened.json?.data_pagamento === null && reopened.json?.origem_dado === "manual", `reabrir limpando pagamento: ${reopened.status} ${JSON.stringify(reopened.json)}`);
    expectError(await call(tA, "PATCH", `/TaxInstallment/${paid.json?.id}`, { agreement_id: otherCompany.json?.id }), 400, "Não é possível mover a parcela", "mover parcela");
    const sameAgreement = await call(tA, "PATCH", `/TaxInstallment/${paid.json?.id}`, { agreement_id: agreement.id, observacoes: "ok" });
    check(sameAgreement.status === 200, "reenviar o mesmo parcelamento na edição é aceito");
    expectError(await call(tA, "PATCH", `/TaxInstallment/${paid.json?.id}`, { numero_parcela: 1 }), 409, "Já existe uma parcela com esse número", "edição para número repetido");

    // ---- Isolamento entre clientes ----
    expectError(await call(tB, "POST", "/TaxInstallment", { ...inst, numero_parcela: 50 }), 400, "parcelamento desta parcela não foi encontrado", "parcela em parcelamento de outro cliente");
    expectError(await call(tB, "GET", `/TaxAgreement/${agreement.id}`), 404, "Parcelamento não encontrado", "ler parcelamento de outro cliente");
    expectError(await call(tB, "PATCH", `/TaxInstallment/${parcels[0]?.id}`, { valor: 1 }), 404, "Parcela não encontrada", "editar parcela de outro cliente");
    expectError(await call(tB, "DELETE", `/TaxAgreement/${agreement.id}`), 404, "Parcelamento não encontrado", "excluir parcelamento de outro cliente");
    const listB = await call(tB, "GET", "/TaxAgreement");
    check(Array.isArray(listB.json) && !listB.json.some((a) => a.id === agreement.id), "cliente B não lista parcelamento de A");

    // ---- Módulo e escrita ----
    const gate = [
      ["GET", "/TaxAgreement"], ["GET", `/TaxAgreement/${agreement.id}`], ["POST", "/TaxAgreement/filter", { query: {} }],
      ["POST", "/TaxAgreement", base], ["POST", "/TaxInstallment/bulk", [inst]], ["PATCH", `/TaxAgreement/${agreement.id}`, { observacoes: "x" }],
      ["PUT", `/TaxAgreement/${agreement.id}`, { observacoes: "x" }], ["DELETE", `/TaxAgreement/${agreement.id}`],
      ["GET", "/TaxInstallment"], ["DELETE", `/TaxInstallment/${parcels[0]?.id}`],
    ];
    for (const [method, path, body] of gate) {
      const res = await call(tNoTax, method, path, body);
      check(res.status === 403 && res.json?.code === "MODULE_FORBIDDEN", `sem módulo ${method} ${path}: esperado 403 MODULE_FORBIDDEN, veio ${res.status} ${res.json?.code}`);
    }
    const viewerRead = await call(tViewer, "GET", `/TaxAgreement/${agreement.id}`);
    check(viewerRead.status === 200, "visualizador com módulo lê o parcelamento");
    for (const [method, path, body] of [["POST", "/TaxAgreement", base], ["POST", "/TaxInstallment/bulk", [inst]], ["PATCH", `/TaxInstallment/${parcels[0]?.id}`, { valor: 1 }], ["DELETE", `/TaxAgreement/${agreement.id}`]]) {
      const res = await call(tViewer, method, path, body);
      check(res.status === 403 && res.json?.code === "READ_ONLY", `visualizador ${method} ${path}: esperado 403 READ_ONLY, veio ${res.status} ${res.json?.code}`);
    }

    // ---- Exclusão em cascata, auditada ----
    const removed = await call(tA, "DELETE", `/TaxAgreement/${agreement.id}`);
    check(removed.status === 200 && removed.json?.parcelas_excluidas === 4, `excluir parcelamento deveria informar 4 parcelas, veio ${removed.status} ${JSON.stringify(removed.json)}`);
    const orphan = await pool.query(`SELECT count(*)::int AS n FROM tax_installments WHERE agreement_id = $1`, [agreement.id]);
    check(orphan.rows[0].n === 0, "parcelas devem sair junto com o parcelamento");
    const audit = await pool.query(
      `SELECT registro, rotina, payload FROM audit_events WHERE action = 'DELETE' AND resource_type = 'TaxAgreement' AND resource_id = $1`,
      [agreement.id]
    );
    const auditRow = audit.rows[0];
    check(
      auditRow?.registro === "Parcelamento PARC-001 — Receita Federal — Simplificado (com 4 parcelas)" && auditRow?.rotina === "Gestão Tributária",
      `auditoria da exclusão: ${JSON.stringify(auditRow)}`
    );
    check(auditRow?.payload?.parcelas_excluidas === 4, "auditoria guarda quantas parcelas saíram");
    const bulkAudit = await pool.query(
      `SELECT registro FROM audit_events WHERE action = 'BULK_CREATE' AND resource_type = 'TaxInstallment' AND group_id = $1`,
      [groupA]
    );
    check(bulkAudit.rows.some((r) => r.registro === "3 parcelas"), `auditoria do lote: ${JSON.stringify(bulkAudit.rows)}`);
    const installmentAudit = await pool.query(
      `SELECT registro FROM audit_events WHERE action = 'CREATE' AND resource_type = 'TaxInstallment' AND group_id = $1`,
      [groupA]
    );
    check(installmentAudit.rows.some((r) => r.registro === "Parcela 9 — vencimento 30/09/2026"), `auditoria da parcela: ${JSON.stringify(installmentAudit.rows)}`);

    // Exclusão barrada por registro que depende do cadastro: 409 dizendo o que depende, não "não existe".
    expectError(await call(tA, "DELETE", `/CompanyEntity/${entityA2}`), 409, "Não é possível excluir a empresa: existem parcelamentos de tributos", "excluir empresa com parcelamento");
    expectError(await call(tA, "DELETE", `/CompanyEntity/${entityA3}`), 409, "Não é possível excluir a empresa: existem contratos", "excluir empresa com contrato");
    expectError(await call(tA, "DELETE", `/LoanContract/${contractA3}`), 409, "Não é possível excluir o contrato: existem títulos a pagar", "excluir contrato com título");
    const stillThere = await pool.query(`SELECT (SELECT count(*) FROM loan_contracts WHERE id = $1)::int AS c, (SELECT count(*) FROM company_entities WHERE id = $2)::int AS e`, [contractA3, entityA3]);
    check(stillThere.rows[0].c === 1 && stillThere.rows[0].e === 1, "exclusão recusada não pode apagar nada");

    // Erro do banco aponta o campo quando o Postgres diz qual é (CHECK de coluna); sem isso, mensagem genérica.
    let checkError = null;
    try {
      await pool.query(
        `INSERT INTO tax_installments (id, group_id, agreement_id, numero_parcela, vencimento, valor) VALUES ($1,$2,$3,1,'2026-01-01',-5)`,
        [`tax_chk_${suffix}`, groupA, otherCompany.json?.id]
      );
    } catch (error) {
      checkError = error;
    }
    const mappedCheck = mapDbError(checkError);
    check(mappedCheck?.status === 400 && mappedCheck.message === "O campo valor da parcela tem um valor que não é permitido", `CHECK do banco: ${checkError?.code} ${checkError?.constraint} → ${mappedCheck?.status} ${mappedCheck?.message}`);
    let formatError = null;
    try {
      await pool.query(`SELECT $1::date`, ["2026-02-30"]);
    } catch (error) {
      formatError = error;
    }
    const mappedFormat = mapDbError(formatError);
    check(mappedFormat?.status === 400 && mappedFormat.message === "Um dos campos tem um valor inválido", `formato inválido sem coluna: ${formatError?.code} → ${mappedFormat?.message}`);
  } finally {
    server.close();
    await pool.query(`DELETE FROM tax_agreements WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM tenant_users WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(users).map((u) => u.id)]);
    await pool.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [tenantA, tenantB]);
    await pool.query(`DELETE FROM payable_titles WHERE id = $1`, [titleA3]);
    await pool.query(`DELETE FROM loan_contracts WHERE id = $1`, [contractA3]);
    await pool.query(`DELETE FROM company_entities WHERE id IN ($1,$2,$3,$4)`, [entityA, entityA2, entityA3, entityB]);
    // A auditoria é só-inclusão: o grupo com eventos auditados não pode ser apagado e fica como resíduo de teste.
    await pool.query(`DELETE FROM groups WHERE id IN ($1,$2)`, [groupA, groupB]).catch(() => {});
  }

  if (failures.length) {
    console.error(`gestão tributária: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log(`gestão tributária ok (TZ=${process.env.TZ || "padrão"})`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
