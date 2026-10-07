import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { pool } from "../../db/pool.js";
import { createApp } from "../../app.js";
import { issueAuthResponse } from "../auth/token.js";
import { runWithTenant } from "../tenants/access.js";
import { createServer } from "node:http";
import { checkSupplierInErp, lookupPayableErp, rawSupplierKey, readSupplierPages, shareInflight, supplierRowsOf } from "../payables/erpLookup.js";
import { checkTaxSuppliersInErp, resolveTaxSupplier } from "./taxSupplier.js";
import { normalizeTaxSuppliers, pickTaxSupplier } from "./taxSupplierConfig.js";

// Fornecedor (credor) dos títulos de tributo: configuração por cliente em Lógica Contábil, resolução por
// esfera/UF e conferência no Protheus ao salvar.

// Saída sem chegar ao fim (ex.: promessa que nunca resolve esvazia o event loop) não pode parecer sucesso.
process.exitCode = 1;

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}
const check2 = check;

const KEY = "finance.tax_suppliers";
const PLACE = "Configurações > Lógica Contábil";

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

function errorOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// Resolução e validação (puro)
// ---------------------------------------------------------------------------

function pickTests() {
  const config = {
    federal: { fornecedor: "UNIAO", loja: "00" },
    estadual: { fornecedor: "SEFAZ", loja: "01" },
    por_uf: { SP: { fornecedor: "SEFASP", loja: "02" } },
  };
  const federal = pickTaxSupplier(config, { esfera: "federal", uf: "SP" });
  check(federal.fornecedor === "UNIAO" && federal.loja === "00" && federal.origem === "federal", `federal: ${JSON.stringify(federal)}`);
  const sp = pickTaxSupplier(config, { esfera: "estadual", uf: "SP" });
  check(sp.fornecedor === "SEFASP" && sp.loja === "02" && sp.origem === "estadual_uf", `estadual com exceção da UF: ${JSON.stringify(sp)}`);
  const mg = pickTaxSupplier(config, { esfera: "estadual", uf: "MG" });
  check(mg.fornecedor === "SEFAZ" && mg.loja === "01" && mg.origem === "estadual_padrao", `estadual sem exceção usa o padrão: ${JSON.stringify(mg)}`);
  const lowerUf = pickTaxSupplier(config, { esfera: "estadual", uf: "sp" });
  check(lowerUf.fornecedor === "SEFASP", "UF minúscula acha a exceção");

  // Faltando: mensagem diz o que configurar e onde.
  const noFederal = errorOf(() => pickTaxSupplier({ ...config, federal: null }, { esfera: "federal" }));
  check(noFederal?.status === 422 && noFederal.code === "TAX_SUPPLIER_NOT_CONFIGURED" && noFederal.message === `Informe o fornecedor dos tributos federais em ${PLACE}.`, `federal faltando: ${noFederal?.message}`);
  const noState = errorOf(() => pickTaxSupplier({ federal: config.federal }, { esfera: "estadual", uf: "MG" }));
  check(noState?.message === `Informe o fornecedor dos tributos estaduais (o padrão ou o de MG) em ${PLACE}.`, `estadual faltando: ${noState?.message}`);
  // Exceção de outra UF não serve para MG; o padrão estadual vazio não é "achado".
  const otherUfOnly = errorOf(() => pickTaxSupplier({ por_uf: { SP: config.por_uf.SP } }, { esfera: "estadual", uf: "MG" }));
  check(otherUfOnly?.code === "TAX_SUPPLIER_NOT_CONFIGURED", "exceção de SP não vale para MG");
  // Federal configurado não vale para estadual, nem o estadual para o federal.
  check(errorOf(() => pickTaxSupplier({ federal: config.federal }, { esfera: "estadual", uf: "SP" }))?.code === "TAX_SUPPLIER_NOT_CONFIGURED", "fornecedor federal não vale para estadual");
  check(errorOf(() => pickTaxSupplier({ estadual: config.estadual }, { esfera: "federal" }))?.code === "TAX_SUPPLIER_NOT_CONFIGURED", "fornecedor estadual não vale para federal");
  const municipal = errorOf(() => pickTaxSupplier(config, { esfera: "municipal" }));
  check(municipal?.message.includes("municipal"), `municipal: ${municipal?.message}`);
  const empty = errorOf(() => pickTaxSupplier(null, { esfera: "federal" }));
  check(empty?.code === "TAX_SUPPLIER_NOT_CONFIGURED", "sem configuração nenhuma");
  const broken = errorOf(() => pickTaxSupplier({ federal: { fornecedor: "UNIAO@", loja: "00" } }, { esfera: "federal" }));
  check(broken?.message === `A configuração dos fornecedores de tributos está inválida. Revise em ${PLACE}.`, `configuração gravada inválida: ${broken?.message}`);
}

function normalizeTests() {
  const normalized = normalizeTaxSuppliers({
    federal: { fornecedor: " uniao ", loja: "00" },
    estadual: { fornecedor: "4521", loja: "1a" },
    por_uf: { rj: { fornecedor: "SEFARJ", loja: "01" }, sp: { fornecedor: "", loja: "" } },
  });
  check(
    JSON.stringify(normalized) === JSON.stringify({
      federal: { fornecedor: "UNIAO", loja: "00" },
      estadual: { fornecedor: "004521", loja: "1A" },
      por_uf: { RJ: { fornecedor: "SEFARJ", loja: "01" } },
    }),
    `normalização: ${JSON.stringify(normalized)}`
  );
  const cleared = normalizeTaxSuppliers({ federal: { fornecedor: "", loja: "" } });
  check(cleared.federal === null && cleared.estadual === null && JSON.stringify(cleared.por_uf) === "{}", "campos vazios = sem fornecedor");

  const cases = [
    [{ federal: { fornecedor: "UNIAO1X", loja: "00" } }, "deve ter até 6 letras ou números", "federal.fornecedor"],
    [{ federal: { fornecedor: "UNI-AO", loja: "00" } }, "sem espaços nem símbolos", "federal.fornecedor"],
    [{ federal: { fornecedor: "UNIAO", loja: "0" } }, "A loja do fornecedor dos tributos federais tem 2 letras ou números", "federal.loja"],
    [{ federal: { fornecedor: "UNIAO", loja: "000" } }, "tem 2 letras ou números", "federal.loja"],
    [{ federal: { fornecedor: "UNIAO" } }, "Informe a loja do fornecedor dos tributos federais", "federal.loja"],
    [{ estadual: { loja: "01" } }, "Informe o código do fornecedor dos tributos estaduais junto com a loja", "estadual.fornecedor"],
    [{ por_uf: { XX: { fornecedor: "A1", loja: "01" } } }, "UF inválida nas exceções", "por_uf"],
    [{ por_uf: { SP: { fornecedor: "A1", loja: "01" }, sp: { fornecedor: "B1", loja: "01" } } }, "aparece duas vezes", "por_uf.SP"],
    [{ por_uf: { SP: { fornecedor: "A 1", loja: "01" } } }, "dos tributos estaduais de SP", "por_uf.SP.fornecedor"],
    [{ por_uf: [] }, "exceções por UF foram enviadas em formato inválido", "por_uf"],
    [{ federal: { fornecedor: "UNIAO", loja: "00", cnpj: "1" } }, "Campo desconhecido", "federal"],
    [{ municipal: null }, "Campo desconhecido", null],
    ["UNIAO", "formato inválido", null],
  ];
  for (const [value, message, field] of cases) {
    const error = errorOf(() => normalizeTaxSuppliers(value));
    check(error?.status === 400 && error.message.includes(message) && error.details?.field === field, `validação ${JSON.stringify(value)}: ${error?.message} (${error?.details?.field})`);
  }
}

async function erpCheckTests() {
  const config = normalizeTaxSuppliers({
    federal: { fornecedor: "UNIAO", loja: "00" },
    estadual: { fornecedor: "SEFAZ", loja: "01" },
    por_uf: { SP: { fornecedor: "UNIAO", loja: "00" }, MG: { fornecedor: "SEFAMG", loja: "01" }, RJ: { fornecedor: "LENTO", loja: "01" } },
  });
  const calls = [];
  const check = async (fornecedor) => {
    calls.push(fornecedor);
    if (fornecedor === "SEFAZ") throw new Error("Protheus fora do ar");
    if (fornecedor === "SEFAMG") return { situacao: "nao_encontrado" };
    if (fornecedor === "LENTO") return new Promise((resolve) => setTimeout(() => resolve({ situacao: "encontrado" }), 500));
    return { situacao: "encontrado" };
  };
  const startedAt = Date.now();
  const result = await checkTaxSuppliersInErp(config, { erpEnabled: true, check, budgetMs: 100 });
  const elapsed = Date.now() - startedAt;
  const situation = Object.fromEntries(result.fornecedores.map((item) => [item.campo, item.situacao]));
  check2(situation.federal === "encontrado" && situation["por_uf.SP"] === "encontrado", `encontrado: ${JSON.stringify(situation)}`);
  check2(situation.estadual === "nao_conferido", "falha da consulta = não conferido (nunca 'existe')");
  check2(situation["por_uf.MG"] === "nao_encontrado", "não encontrado conclusivo passa adiante");
  check2(situation["por_uf.RJ"] === "nao_conferido" && elapsed < 400, `consulta além do prazo = não conferido, sem esperar: ${situation["por_uf.RJ"]} em ${elapsed} ms`);
  check2(calls.filter((c) => c === "UNIAO").length === 1, `mesmo fornecedor consultado uma vez: ${calls.join(",")}`);
  const mgWarning = result.fornecedores.find((item) => item.campo === "por_uf.MG")?.mensagem;
  check2(mgWarning === "O fornecedor SEFAMG loja 01 (tributos estaduais de MG) não apareceu no cadastro de fornecedores do Protheus (ou está bloqueado). A configuração foi salva. Confira o código e a loja no Protheus ou cadastre o fornecedor: sem ele, o Protheus não aceita o título de tributo.", `aviso de não encontrado: ${mgWarning}`);
  check2(result.avisos.filter((a) => a.startsWith("Não foi possível conferir no Protheus se o fornecedor")).length === 2, `avisos de não conferido: ${JSON.stringify(result.avisos)}`);

  const disabled = await checkTaxSuppliersInErp(config, { erpEnabled: false, check: async () => { throw new Error("não deveria consultar"); } });
  check2(disabled.conferido === false && disabled.avisos.length === 0, "cliente sem ERP: não confere");
}

const supplier = (codigo, loja) => ({ A2_COD: codigo, A2_LOJA: loja, A2_NOME: `Fornecedor ${codigo}` });

async function strictCheckTests() {
  const complete = (rows) => async () => ({ rows, items: [], complete: true, limitReached: false });
  const fullReads = [];
  const tracked = (fn) => async () => { fullReads.push(1); return fn(); };

  const viaIndex = await checkSupplierInErp("UNIAO", "00", {
    indexLookup: async () => ({ rows: [supplier("UNIAO", "00")], truncated: false }),
    fullRead: tracked(complete([])),
  });
  check2(viaIndex.situacao === "encontrado" && fullReads.length === 0, `achado no índice, sem ler o SA2: ${JSON.stringify(viaIndex)}`);
  // Índice sem o código (busca por nome) não prova ausência: vai ao SA2.
  const indexMiss = await checkSupplierInErp("SEFAZ", "01", {
    indexLookup: async () => ({ rows: [supplier("SEFAZX", "01")], truncated: false }),
    fullRead: tracked(complete([supplier("SEFAZ", "01")])),
  });
  check2(indexMiss.situacao === "encontrado" && fullReads.length === 1, `índice sem o código cai no SA2: ${JSON.stringify(indexMiss)}`);
  const absent = await checkSupplierInErp("SEFAZ", "01", { indexLookup: async () => null, fullRead: complete([supplier("SEFAZ", "02")]) });
  check2(absent.situacao === "nao_encontrado", `leitura completa sem o fornecedor: ${JSON.stringify(absent)}`);
  const partial = await checkSupplierInErp("SEFAZ", "01", {
    indexLookup: async () => null,
    fullRead: async () => ({ rows: [], items: [], complete: false, limitReached: false }),
  });
  check2(partial.situacao === "nao_conferido" && partial.motivo === "pagina_falhou", `página falha = não conferido: ${JSON.stringify(partial)}`);
  const capped = await checkSupplierInErp("SEFAZ", "01", {
    indexLookup: async () => null,
    fullRead: async () => ({ rows: [], items: [], complete: false, limitReached: true }),
  });
  check2(capped.situacao === "nao_conferido" && capped.motivo === "limite_de_paginas", `limite de páginas = não conferido: ${JSON.stringify(capped)}`);
  const partialButFound = await checkSupplierInErp("SEFAZ", "01", {
    indexLookup: async () => null,
    fullRead: async () => ({ rows: [supplier("SEFAZ", "01")], items: [], complete: false, limitReached: true }),
  });
  check2(partialButFound.situacao === "encontrado", "leitura parcial que trouxe o fornecedor = encontrado");
  const readFails = await checkSupplierInErp("SEFAZ", "01", { indexLookup: async () => { throw new Error("x"); }, fullRead: async () => { throw new Error("sem conexão"); } });
  check2(readFails.situacao === "nao_conferido", "sem conexão = não conferido");

  // Código como está no Protheus: letras e números juntos não podem virar só números na comparação.
  const sa2 = [
    supplier("F00010", "01"), supplier("AB1234", "01"), supplier("UNIAO", "00"), supplier("000123", "01"),
    { A2_COD: "  F00020 ", A2_LOJA: " 01 ", A2_NOME: "Com espaços" },
    { A2_COD: "BLQ001", A2_LOJA: "01", A2_NOME: "Bloqueado", A2_MSBLQL: "1" },
  ];
  const cases = [
    ["F00010", "01", "encontrado"], ["AB1234", "01", "encontrado"], ["UNIAO", "00", "encontrado"], ["000123", "01", "encontrado"],
    ["F00020", "01", "encontrado"],
    // A busca das telas vê "F00010" como "000010" e "AB1234" como "001234"; esses códigos não existem no Protheus.
    ["000010", "01", "nao_encontrado"], ["001234", "01", "nao_encontrado"],
    ["F00011", "01", "nao_encontrado"], ["AB1234", "02", "nao_encontrado"], ["UNIAO", "01", "nao_encontrado"], ["000124", "01", "nao_encontrado"],
    ["BLQ001", "01", "nao_encontrado"],
  ];
  for (const [codigo, loja, expected] of cases) {
    const viaRead = await checkSupplierInErp(codigo, loja, { indexLookup: async () => null, fullRead: complete(sa2) });
    check2(viaRead.situacao === expected, `SA2 ${codigo}/${loja}: esperado ${expected}, veio ${viaRead.situacao}`);
    if (expected === "encontrado") {
      const viaIdx = await checkSupplierInErp(codigo, loja, {
        indexLookup: async () => ({ rows: sa2, truncated: false }),
        fullRead: async () => { throw new Error("não deveria ler o SA2"); },
      });
      check2(viaIdx.situacao === "encontrado" && viaIdx.motivo === "indice", `índice ${codigo}/${loja}: ${JSON.stringify(viaIdx)}`);
    }
  }
  // Zeros à esquerda: só um NÚMERO JSON prova que eles se perderam; texto sem os zeros não prova nada.
  const numericSa2 = [
    { A2_COD: 10, A2_LOJA: "01" }, { A2_COD: 4521, A2_LOJA: 1 }, { A2_COD: "000077", A2_LOJA: "02" },
    { A2_COD: "88", A2_LOJA: "01" }, { A2_COD: "000099", A2_LOJA: "1" }, { A2_COD: "F10", A2_LOJA: "01" },
  ];
  const numericCases = [
    ["000010", "01", "encontrado"], // número 10
    ["004521", "01", "encontrado"], // número 4521, loja número 1
    ["000077", "02", "encontrado"], // texto idêntico
    ["000088", "01", "nao_conferido"], // texto "88" sem os zeros
    ["000099", "01", "nao_conferido"], // loja texto "1" sem o zero
    ["000010", "02", "nao_encontrado"], ["000011", "01", "nao_encontrado"],
    // Com letras, nada é completado.
    ["F00010", "01", "nao_encontrado"], ["F10", "01", "encontrado"],
  ];
  for (const [codigo, loja, expected] of numericCases) {
    const got = await checkSupplierInErp(codigo, loja, { indexLookup: async () => null, fullRead: complete(numericSa2) });
    check2(got.situacao === expected, `numérico ${codigo}/${loja}: esperado ${expected}, veio ${got.situacao} (${got.motivo})`);
  }
  const textNoZeros = await checkSupplierInErp("000088", "01", { indexLookup: async () => null, fullRead: complete(numericSa2) });
  check2(textNoZeros.motivo === "codigo_sem_zeros", `motivo do texto sem zeros: ${textNoZeros.motivo}`);
  const textProvenAnyway = await checkSupplierInErp("000088", "01", { indexLookup: async () => null, fullRead: complete([...numericSa2, supplier("000088", "01")]) });
  check2(textProvenAnyway.situacao === "encontrado", "texto sem zeros + registro idêntico = encontrado");
  const numericIdx = await checkSupplierInErp("000010", "01", { indexLookup: async () => ({ rows: [{ A2_COD: 10, A2_LOJA: "01" }] }), fullRead: async () => { throw new Error("não deveria ler"); } });
  check2(numericIdx.situacao === "encontrado", `índice com código numérico como número: ${JSON.stringify(numericIdx)}`);
  const textIdx = await checkSupplierInErp("000010", "01", { indexLookup: async () => ({ rows: [{ A2_COD: "10", A2_LOJA: "01" }] }), fullRead: complete([supplier("OUTRO", "01")]) });
  check2(textIdx.situacao === "nao_conferido", `índice com texto sem zeros impede afirmar ausência: ${JSON.stringify(textIdx)}`);
  const fractional = await checkSupplierInErp("000010", "01", { indexLookup: async () => null, fullRead: complete([{ A2_COD: 10.5, A2_LOJA: "01" }]) });
  check2(fractional.situacao === "nao_encontrado", "número não inteiro não é código");

  // Mesmo código sem loja: não prova presença nem ausência daquela loja.
  const noStoreSa2 = [{ A2_COD: "UNIAO", A2_NOME: "Sem loja" }, { A2_COD: "SEFAZ", A2_LOJA: "" }];
  const noStore = await checkSupplierInErp("UNIAO", "00", { indexLookup: async () => null, fullRead: complete(noStoreSa2) });
  check2(noStore.situacao === "nao_conferido" && noStore.motivo === "registro_sem_loja", `código igual sem loja: ${JSON.stringify(noStore)}`);
  const blankStore = await checkSupplierInErp("SEFAZ", "01", { indexLookup: async () => null, fullRead: complete(noStoreSa2) });
  check2(blankStore.situacao === "nao_conferido", `loja em branco: ${JSON.stringify(blankStore)}`);
  const provenAnyway = await checkSupplierInErp("UNIAO", "00", { indexLookup: async () => null, fullRead: complete([...noStoreSa2, supplier("UNIAO", "00")]) });
  check2(provenAnyway.situacao === "encontrado", "outro registro com a loja certa prova presença");
  const noStoreInIndex = await checkSupplierInErp("UNIAO", "00", {
    indexLookup: async () => ({ rows: [{ A2_COD: "UNIAO" }] }),
    fullRead: complete([supplier("OUTRO", "01")]),
  });
  check2(noStoreInIndex.situacao === "nao_conferido", `índice com o código sem loja impede afirmar ausência: ${JSON.stringify(noStoreInIndex)}`);
  const otherCodeNoStore = await checkSupplierInErp("UNIAO", "00", { indexLookup: async () => null, fullRead: complete([{ A2_COD: "OUTRO" }]) });
  check2(otherCodeNoStore.situacao === "nao_encontrado", "registro sem loja de OUTRO código não atrapalha a ausência");

  // As chaves cruas do registro.
  check2(JSON.stringify(rawSupplierKey({ A2_COD: "F00010", A2_LOJA: "01" })) === '{"codigo":"F00010","loja":"01"}', "chave crua mantém letras");
  check2(rawSupplierKey({ A2_COD: "X1", A2_LOJA: "01", D_E_L_E_T_: "*" }) === null, "registro excluído não conta");

  // Ao salvar: código com letras fica como digitado (em maiúsculas); só o só-numérico ganha zeros, como o título
  // a pagar já envia.
  const saved = normalizeTaxSuppliers({
    federal: { fornecedor: "F00010", loja: "01" },
    estadual: { fornecedor: "ab1234", loja: "01" },
    por_uf: { SP: { fornecedor: "123", loja: "01" }, RJ: { fornecedor: "000123", loja: "01" }, MG: { fornecedor: "UNIAO", loja: "00" } },
  });
  check2(saved.federal.fornecedor === "F00010" && saved.estadual.fornecedor === "AB1234", `código com letras não muda ao salvar: ${JSON.stringify(saved)}`);
  check2(saved.por_uf.SP.fornecedor === "000123" && saved.por_uf.RJ.fornecedor === "000123" && saved.por_uf.MG.fornecedor === "UNIAO", `código numérico com zeros: ${JSON.stringify(saved.por_uf)}`);
}

const rowsLen = (payload) => {
  try {
    return supplierRowsOf(payload).length;
  } catch {
    return -1;
  }
};

async function pageReadTests() {
  const pageOf = (page, size, count) => Array.from({ length: count }, (_, i) => supplier(String(page * 1000 + i), "01"));
  const fetcher = ({ total, perPage = 200, lastCount, failPages = [], hasNext }) => async (page) => {
    if (failPages.includes(page)) throw new Error(`página ${page} quebrou`);
    const count = lastCount !== undefined && page === Math.ceil(total / perPage) ? lastCount : perPage;
    return { total, hasNext, items: pageOf(page, perPage, count) };
  };
  const full = await readSupplierPages(fetcher({ total: 450, lastCount: 50 }), { maxPages: 40 });
  check2(full.complete && full.items.length === 450 && full.pages === 3, `leitura completa: ${full.complete} ${full.items.length} ${full.pages}`);
  const failed = await readSupplierPages(fetcher({ total: 450, lastCount: 50, failPages: [2] }), { maxPages: 40 });
  check2(!failed.complete && failed.failedPages.join() === "2" && failed.items.length === 250, `página falha: ${JSON.stringify({ ...failed, items: failed.items.length })}`);
  const capped = await readSupplierPages(fetcher({ total: 450, lastCount: 50 }), { maxPages: 2 });
  check2(!capped.complete && capped.limitReached && capped.items.length === 400, `teto de páginas: ${capped.complete} ${capped.limitReached}`);
  // Sem total: o fim é a página que diz hasNext: false (ou vem vazia), nunca uma página só "curta".
  const noTotalEnd = await readSupplierPages(async (page) => ({ hasNext: page < 2, items: page <= 2 ? pageOf(page, 200, page === 2 ? 10 : 200) : [] }), { maxPages: 5 });
  check2(noTotalEnd.complete && !noTotalEnd.limitReached, "sem total, hasNext false antes do teto: completa");
  const noTotalCap = await readSupplierPages(async (page) => ({ hasNext: true, items: pageOf(page, 200, 200) }), { maxPages: 3 });
  check2(!noTotalCap.complete && noTotalCap.limitReached, "sem total, todas as páginas cheias até o teto: incompleta");
  // Servidor que limita a página abaixo do pedido (100 em vez de 200): toda página é "curta", e mesmo assim a
  // leitura que parou no teto não é completa.
  const serverCapped = await readSupplierPages(async (page) => ({ hasNext: true, items: pageOf(page, 100, 100) }), { maxPages: 3 });
  check2(!serverCapped.complete && serverCapped.limitReached, `página limitada pelo servidor, sem total, até o teto: ${serverCapped.complete}`);
  const serverCappedTotal = await readSupplierPages(async (page) => ({ total: 450, items: pageOf(page, 100, 100) }), { maxPages: 40 });
  check2(!serverCappedTotal.complete && serverCappedTotal.items.length === 300, `página limitada pelo servidor, com total: ${serverCappedTotal.complete} ${serverCappedTotal.items.length}`);
  // Página do meio que falha, mesmo com o fim encontrado depois dela: incompleta.
  const holeNoTotal = await readSupplierPages(async (page) => {
    if (page === 2) throw new Error("página 2 quebrou");
    return { hasNext: page < 3, items: pageOf(page, 200, page === 3 ? 5 : 200) };
  }, { maxPages: 5 });
  check2(!holeNoTotal.complete && holeNoTotal.failedPages.join() === "2", `buraco no meio sem total: ${holeNoTotal.complete}`);
  const endAtCeiling = await readSupplierPages(async (page) => ({ hasNext: page < 3, items: pageOf(page, 200, 200) }), { maxPages: 3 });
  check2(endAtCeiling.complete, "fim exatamente na última página do teto (hasNext false): completa");
  const noMeta = await readSupplierPages(async () => ({ items: pageOf(1, 200, 5) }), { maxPages: 40 });
  check2(!noMeta.complete, "sem total nem hasNext, com registros: não dá para saber se acabou");
  const emptyNoMeta = await readSupplierPages(async () => ({ items: [] }), { maxPages: 40, extract: supplierRowsOf });
  check2(emptyNoMeta.complete && emptyNoMeta.items.length === 0, "primeira página vazia: SA2 vazio, completa");
  // Página com um fornecedor só: a conferência não pode perdê-lo.
  const single = await readSupplierPages(async () => ({ hasNext: false, items: [supplier("UNIAO", "00")] }), { maxPages: 40, extract: supplierRowsOf });
  check2(single.complete && single.items.length === 1 && single.items[0].codigo === "UNIAO", `uma página com um fornecedor: ${JSON.stringify(single)}`);
  const lastPageOne = await readSupplierPages(
    async (page) => ({ total: 201, items: page === 1 ? pageOf(1, 200, 200) : [supplier("SEFAZ", "01")] }),
    { maxPages: 40, extract: supplierRowsOf }
  );
  check2(lastPageOne.complete && lastPageOne.items.some((item) => item.codigo === "SEFAZ"), "última página com um fornecedor só não some");
  check2(rowsLen({ Items: [1] }) === 1 && rowsLen([1, 2]) === 2 && rowsLen({ data: { items: [1, 2] } }) === 2, "lista de registros nos formatos aceitos");
  // Envelope aninhado com um item só não perde o item.
  check2(rowsLen({ data: { items: [supplier("UNIAO", "00")] } }) === 1, "envelope aninhado com um item");
  check2(rowsLen({ Data: { SA2: [supplier("UNIAO", "00")] } }) === 1, "envelope aninhado com outra caixa e um item");
  check2(rowsLen({ items: [] }) === 0, "lista vazia reconhecida é vazia");
  for (const unknown of [{ message: "erro" }, "<html>erro</html>", null, { items: "x" }]) {
    check2(errorOf(() => supplierRowsOf(unknown)) !== null, `formato não reconhecido lança: ${JSON.stringify(unknown)}`);
  }
  // Na leitura: página com formato desconhecido conta como falha (e a ausência fica "não conferido").
  const oddPage = await readSupplierPages(
    async (page) => (page === 2 ? { message: "manutenção" } : { total: 401, items: page === 1 ? pageOf(1, 200, 200) : pageOf(page, 200, 1) }),
    { maxPages: 40, extract: supplierRowsOf }
  );
  check2(!oddPage.complete && oddPage.failedPages.join() === "2", `página com formato desconhecido = falha: ${JSON.stringify({ ...oddPage, items: oddPage.items.length })}`);
  const oddCheck = await checkSupplierInErp("NAOEXISTE", "01", {
    indexLookup: async () => null,
    fullRead: async () => readSupplierPages(async () => ({ data: { mensagem: "sem acesso" } }), { extract: supplierRowsOf }),
  });
  check2(oddCheck.situacao === "nao_conferido", `primeira página com formato desconhecido = não conferido: ${JSON.stringify(oddCheck)}`);

  // Leitura em andamento compartilhada.
  const inflight = new Map();
  let starts = 0;
  let release;
  const slow = () => { starts += 1; return new Promise((resolve) => { release = resolve; }); };
  const a = shareInflight(inflight, "int1", slow);
  const b = shareInflight(inflight, "int1", slow);
  const other = shareInflight(inflight, "int2", async () => "outra");
  await new Promise((resolve) => setImmediate(resolve));
  check2(a === b && starts === 1, `chamadas simultâneas dividem a leitura: ${starts}`);
  check2((await other) === "outra", "outra integração lê à parte");
  release("ok");
  const settled = (promise) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("não resolveu"), 1000))]);
  const [ra, rb] = [await settled(a), await settled(b)];
  check2(ra === "ok" && rb === "ok", `as duas recebem o resultado: ${ra} ${rb}`);
  await shareInflight(inflight, "int1", async () => { starts += 1; return "nova"; });
  check2(starts === 2, "terminada a leitura, a próxima chamada lê de novo (dado fresco)");
  await shareInflight(inflight, "int3", async () => { throw new Error("falhou"); }).catch(() => {});
  check2(!inflight.has("int3"), "leitura que falhou não fica presa");
}

// ---------------------------------------------------------------------------
// Contra um SA2 de teste (HTTP), pela conexão do cliente
// ---------------------------------------------------------------------------

function startFakeSa2() {
  const state = { suppliers: [], failPages: new Set(), total: null, requests: [], indexRows: [], indexCalls: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    // Busca indexada do FinRestTitulos (POST .../pagar/fornecedores).
    if (req.method === "POST" && url.pathname.endsWith("/fornecedores")) {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        state.indexCalls.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}").busca);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ origem: "indice", truncated: false, items: state.indexRows }));
      });
      return;
    }
    const page = Number(url.searchParams.get("page") || 1);
    const size = Number(url.searchParams.get("pageSize") || 200);
    state.requests.push(page);
    if (state.failPages.has(page)) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "erro de teste" }));
      return;
    }
    const items = state.suppliers.slice((page - 1) * size, page * size);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ total: state.total ?? state.suppliers.length, items }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state })));
}

async function sa2Tests() {
  const suffix = `${Date.now()}`;
  const groupId = `grp_forn_sa2_${suffix}`;
  const fake = await startFakeSa2();
  const integrationId = randomUUID();
  await pool.query(`INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Forn SA2','ativo','teste')`, [groupId]);
  await pool.query(
    `INSERT INTO integrations (id, code, nome, erp_nome, base_url, auth_type, status, group_id, created_by)
     VALUES ($1,$2,'SA2 de teste','Protheus',$3,'none','ativo',$4,'teste')`,
    [integrationId, `sa2_${suffix}`, `http://127.0.0.1:${fake.server.address().port}`, groupId]
  );
  await pool.query(
    `INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key)
     VALUES ($1,'SA2','GET','/sa2','fornecedores'), ($1,'Títulos a pagar','POST','/FinRestTitulos/pagar','titulos_pagar')`,
    [integrationId]
  );
  const scope = { userId: randomUUID(), groupId, tenantId: null, email: `sa2-${suffix}@test.local`, role: "admin", tenantRole: "OWNER" };
  const filler = Array.from({ length: 399 }, (_, i) => supplier(String(100000 + i), "01"));
  fake.state.suppliers = [...filler.slice(0, 398), supplier("F00010", "01"), supplier("SEFAZ", "01")]; // 400 = 2 páginas cheias
  const config = (extra = {}) => normalizeTaxSuppliers({
    federal: { fornecedor: "UNIAO", loja: "00" },
    estadual: { fornecedor: "SEFAZ", loja: "01" },
    por_uf: { SP: { fornecedor: "NOVO", loja: "01" } },
    ...extra,
  });
  const situationOf = (result) => Object.fromEntries(result.fornecedores.map((item) => [item.campo, item.situacao]));

  try {
    await runWithTenant(scope, async () => {
      // A busca das telas carrega o SA2 e guarda em cache.
      const screen = await lookupPayableErp({ kind: "fornecedores", search: "SEFAZ" });
      check2(screen.items.some((item) => item.codigo === "SEFAZ"), "busca das telas acha o fornecedor");
      // Fornecedor cadastrado depois: a tela segue no cache (sem nova leitura); a conferência lê de novo.
      fake.state.suppliers = [...filler.slice(0, 398), supplier("F00010", "01"), supplier("SEFAZ", "01"), supplier("NOVO", "01")];
      fake.state.requests = [];
      const screenAgain = await lookupPayableErp({ kind: "fornecedores", search: "NOVO" });
      check2(fake.state.requests.length === 0 && !screenAgain.items.some((item) => item.codigo === "NOVO"), "tela continua usando o cache de 10 min");

      const fresh = await checkTaxSuppliersInErp(config({ por_uf: { SP: { fornecedor: "NOVO", loja: "01" }, RJ: { fornecedor: "F00010", loja: "01" } } }), { erpEnabled: true });
      const s1 = situationOf(fresh);
      check2(s1["por_uf.RJ"] === "encontrado", `F00010 presente no SA2: ${JSON.stringify(s1)}`);
      check2(s1["por_uf.SP"] === "encontrado" && s1.estadual === "encontrado", `conferência com dado fresco: ${JSON.stringify(s1)}`);
      check2(s1.federal === "nao_encontrado", `leitura completa sem o fornecedor = não encontrado: ${JSON.stringify(s1)}`);
      // Três fornecedores, uma leitura completa do SA2 (3 páginas: 401 registros).
      check2(fake.state.requests.join() === "1,2,3", `uma leitura só para os três: ${fake.state.requests.join()}`);
      // A última página tem um fornecedor só (NOVO), e ele não se perde.

      // Página que falha: ausência vira "não conferido"; presença na página lida continua "encontrado".
      fake.state.failPages = new Set([3]);
      fake.state.requests = [];
      const failed = situationOf(await checkTaxSuppliersInErp(config(), { erpEnabled: true }));
      check2(failed.federal === "nao_conferido" && failed.estadual === "encontrado" && failed["por_uf.SP"] === "nao_conferido", `página falha: ${JSON.stringify(failed)}`);
      fake.state.failPages = new Set();

      // Mais registros do que o teto de páginas lê: ausência vira "não conferido".
      fake.state.total = 200 * 41;
      const capped = situationOf(await checkTaxSuppliersInErp(config(), { erpEnabled: true }));
      check2(capped.federal === "nao_conferido", `teto de páginas: ${JSON.stringify(capped)}`);
      fake.state.total = null;

      // Busca indexada traz o fornecedor com o código cru (letras e números): basta, sem depender do SA2 lido.
      fake.state.indexRows = [supplier("IDX001", "01")];
      const viaIndex = situationOf(await checkTaxSuppliersInErp(config({ federal: { fornecedor: "IDX001", loja: "01" }, estadual: null, por_uf: {} }), { erpEnabled: true }));
      check2(viaIndex.federal === "encontrado" && fake.state.indexCalls.includes("IDX001"), `achado pela busca indexada do Protheus: ${JSON.stringify(viaIndex)} ${fake.state.indexCalls}`);
      fake.state.indexRows = [];

      // Leitura completa recente passa a servir também à busca das telas.
      fake.state.requests = [];
      await checkTaxSuppliersInErp(config(), { erpEnabled: true });
      const afterFresh = await lookupPayableErp({ kind: "fornecedores", search: "NOVO" });
      check2(afterFresh.items.some((item) => item.codigo === "NOVO"), "cache das telas atualizado pela leitura completa");
    });
  } finally {
    fake.server.close();
    await pool.query(`DELETE FROM integrations WHERE id = $1`, [integrationId]);
    await pool.query(`DELETE FROM groups WHERE id = $1`, [groupId]).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Pela API de parâmetros
// ---------------------------------------------------------------------------

async function apiTests() {
  const suffix = `${Date.now()}`;
  const groupA = `grp_forn_a_${suffix}`;
  const groupB = `grp_forn_b_${suffix}`;
  const tenantA = `tnt_forn_a_${suffix}`;
  const tenantB = `tnt_forn_b_${suffix}`;
  const users = {
    ownerA: { id: randomUUID(), email: `forn-owner-a-${suffix}@test.local`, role: "admin", tenantRole: "OWNER", tenant: tenantA, group: groupA },
    viewerA: { id: randomUUID(), email: `forn-viewer-a-${suffix}@test.local`, role: "user", tenantRole: "VIEWER", tenant: tenantA, group: groupA },
    ownerB: { id: randomUUID(), email: `forn-owner-b-${suffix}@test.local`, role: "admin", tenantRole: "OWNER", tenant: tenantB, group: groupB },
  };
  await pool.query("BEGIN");
  try {
    await pool.query(`INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Forn A','ativo','teste'), ($2,'Forn B','ativo','teste')`, [groupA, groupB]);
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, owner_email, created_by)
       VALUES ($1,$2,'Forn A','STARTER','active',$5,'teste'), ($3,$4,'Forn B','STARTER','active',$6,'teste')`,
      [tenantA, groupA, tenantB, groupB, users.ownerA.email, users.ownerB.email]
    );
    for (const user of Object.values(users)) {
      await pool.query(`INSERT INTO users (id, email, password_hash, full_name, role, status, created_by) VALUES ($1,$2,'x',$2,$3,'active','teste')`, [user.id, user.email, user.role]);
      await pool.query(`INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, created_by) VALUES ($1,$2,$3,$4,$5,'teste')`, [`tu_${user.id}`, user.tenant, user.group, user.email, user.tenantRole]);
    }
    // Cliente A integra com ERP (sem conexão configurada no teste); cliente B não integra.
    await pool.query(
      `INSERT INTO system_parameters (scope, group_id, param_key, value_json, updated_by) VALUES ('TENANT', $1, 'integrations.external_erp_enabled', '{"v":false}'::jsonb, 'teste')`,
      [groupB]
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
  const tViewer = token(users.viewerA);
  const tB = token(users.ownerB);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const call = (t, method, path, body) => jsonRequest(server, { method, path, body, token: t });
  const scopeOf = (user) => ({ userId: user.id, groupId: user.group, tenantId: user.tenant, email: user.email, role: user.role, tenantRole: user.tenantRole });

  try {
    // Sem configuração: vazio (sem padrão silencioso), com a sugestão do Protheus para a tela.
    const listed = await call(tA, "GET", "/api/parameters?category=finance");
    const item = (listed.json?.data || []).find((p) => p.key === KEY);
    check(item && item.type === "JSON" && item.source === "DEFAULT", `parâmetro listado: ${JSON.stringify(item)}`);
    check(JSON.stringify(item?.value) === JSON.stringify({ federal: null, estadual: null, por_uf: {} }), `valor inicial vazio: ${JSON.stringify(item?.value)}`);
    check(item?.suggestedValue?.federal?.fornecedor === "UNIAO" && item.suggestedValue.federal.loja === "00", `sugestão: ${JSON.stringify(item?.suggestedValue)}`);
    const notConfigured = await runWithTenant(scopeOf(users.ownerA), () => resolveTaxSupplier({ esfera: "federal" }).catch((e) => e));
    check(notConfigured?.code === "TAX_SUPPLIER_NOT_CONFIGURED", "sem configuração, a sugestão não é usada como valor");

    // Formato inválido: 400 e nada gravado.
    const invalid = await call(tA, "PATCH", `/api/parameters/${KEY}`, { value: { federal: { fornecedor: "UNIAO", loja: "0" } } });
    check(invalid.status === 400 && invalid.json?.error?.includes("A loja do fornecedor dos tributos federais tem 2 letras") && invalid.json?.details?.field === "federal.loja", `inválido: ${invalid.status} ${JSON.stringify(invalid.json)}`);
    const stored = await pool.query(`SELECT count(*)::int AS n FROM system_parameters WHERE group_id = $1 AND param_key = $2`, [groupA, KEY]);
    check(stored.rows[0].n === 0, "valor inválido não é gravado");

    // Gravar: normalizado; com ERP ligado e consulta impossível, salva e avisa que não conferiu.
    const value = { federal: { fornecedor: "uniao", loja: "00" }, estadual: { fornecedor: "SEFAZ", loja: "01" }, por_uf: { sp: { fornecedor: "SEFASP", loja: "02" } } };
    const saved = await call(tA, "PATCH", `/api/parameters/${KEY}`, { value });
    check(saved.status === 200 && saved.json?.data?.newValue?.federal?.fornecedor === "UNIAO" && saved.json.data.newValue.por_uf.SP?.loja === "02", `gravar: ${saved.status} ${JSON.stringify(saved.json)}`);
    const conferencia = saved.json?.data?.conferencia;
    check(conferencia?.conferido === true && conferencia.fornecedores.length === 3 && conferencia.fornecedores.every((f) => f.situacao === "nao_conferido"), `conferência sem conexão: ${JSON.stringify(conferencia)}`);
    check(conferencia?.avisos?.[0]?.startsWith("Não foi possível conferir no Protheus se o fornecedor UNIAO loja 00 (tributos federais) existe."), `aviso: ${conferencia?.avisos?.[0]}`);
    const audit = await pool.query(
      `SELECT after_json FROM audit_events WHERE action = 'PARAMETER_UPDATED' AND resource_id = $1 AND group_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
      [KEY, groupA]
    );
    check(audit.rows[0]?.after_json?.value?.federal?.fornecedor === "UNIAO", `auditoria da gravação: ${JSON.stringify(audit.rows[0]?.after_json)}`);

    await runWithTenant(scopeOf(users.ownerA), async () => {
      const fed = await resolveTaxSupplier({ esfera: "federal" });
      check(fed.fornecedor === "UNIAO" && fed.loja === "00", `resolução federal pelo parâmetro: ${JSON.stringify(fed)}`);
      const sp = await resolveTaxSupplier({ esfera: "estadual", uf: "SP" });
      check(sp.fornecedor === "SEFASP", `resolução SP pelo parâmetro: ${JSON.stringify(sp)}`);
      const rs = await resolveTaxSupplier({ esfera: "estadual", uf: "RS" });
      check(rs.fornecedor === "SEFAZ", `resolução RS cai no padrão estadual: ${JSON.stringify(rs)}`);
    });

    // Isolamento: o cliente B não vê nem usa a configuração do A.
    const listedB = await call(tB, "GET", `/api/parameters/${KEY}`);
    check(JSON.stringify(listedB.json?.data?.value) === JSON.stringify({ federal: null, estadual: null, por_uf: {} }), `cliente B não vê a configuração do A: ${JSON.stringify(listedB.json?.data?.value)}`);
    const bResolve = await runWithTenant(scopeOf(users.ownerB), () => resolveTaxSupplier({ esfera: "federal" }).catch((e) => e));
    check(bResolve?.code === "TAX_SUPPLIER_NOT_CONFIGURED", "cliente B não resolve pelo fornecedor do A");
    // Cliente sem ERP: grava sem conferir.
    const savedB = await call(tB, "PATCH", `/api/parameters/${KEY}`, { value: { federal: { fornecedor: "UNIAO", loja: "00" } } });
    check(savedB.status === 200 && savedB.json?.data?.conferencia?.conferido === false && savedB.json.data.conferencia.avisos.length === 0, `cliente sem ERP: ${JSON.stringify(savedB.json?.data?.conferencia)}`);
    await runWithTenant(scopeOf(users.ownerA), async () => {
      const stillA = await resolveTaxSupplier({ esfera: "estadual", uf: "SP" });
      check(stillA.fornecedor === "SEFASP", "gravação do B não mexe no A");
    });

    // Permissão: igual aos demais parâmetros (visualizador não grava).
    const viewer = await call(tViewer, "PATCH", `/api/parameters/${KEY}`, { value: { federal: null } });
    check(viewer.status === 403, `visualizador não grava: ${viewer.status} ${JSON.stringify(viewer.json)}`);
    await runWithTenant(scopeOf(users.ownerA), async () => {
      check((await resolveTaxSupplier({ esfera: "federal" })).fornecedor === "UNIAO", "tentativa do visualizador não mudou nada");
    });

    // Reset volta ao vazio.
    const reset = await call(tA, "POST", "/api/parameters/reset", { key: KEY });
    check(reset.status === 200 && reset.json?.data?.newValue?.federal === null, `reset: ${JSON.stringify(reset.json?.data?.newValue)}`);
  } finally {
    server.close();
    await pool.query(`DELETE FROM system_parameters WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM tenant_users WHERE group_id IN ($1,$2)`, [groupA, groupB]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(users).map((u) => u.id)]);
    await pool.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [tenantA, tenantB]);
    // A auditoria é só-inclusão: o grupo com eventos auditados fica como resíduo de teste.
    await pool.query(`DELETE FROM groups WHERE id IN ($1,$2)`, [groupA, groupB]).catch(() => {});
  }
}

async function main() {
  pickTests();
  normalizeTests();
  await erpCheckTests();
  await strictCheckTests();
  await pageReadTests();
  await sa2Tests();
  await apiTests();
  if (failures.length) {
    console.error(`fornecedor dos tributos: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log("fornecedor dos tributos ok: resolução federal/estadual/UF, validação, conferência no Protheus, isolamento");
  await pool.end();
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
