import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { buildErpTitlePayload, erpTitleLookupPayload } from "./erpIntegrate.js";

// Corpo do título a pagar enviado ao Protheus (FinRestTitulos) e as colunas de código de barras de payable_titles.

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

// Título de empréstimo (sem código de barras).
const LOAN_TITLE = {
  prefixo: "EMP",
  titulo_numero: "123",
  parcela: "7",
  tipo: "DEF",
  natureza: "2010101",
  fornecedor: "4521",
  fornecedor_loja: "01",
  emissao: "2026-01-15",
  vencimento: new Date(Date.UTC(2026, 6, 15)),
  valor: "15234.56",
  historico: "Parcela 7 do contrato 123 — Banco Exemplo S.A. juros e principal",
  filial: "0101",
  filial_origem: "01",
};
const ENTITY = { codigo_empresa: "01" };
const CODES = { e2Filial: "0101", filialOrigem: "01" };

// Corpo gerado pela versão anterior às colunas de código de barras para o mesmo título, byte a byte.
const LOAN_PAYLOAD_BEFORE = '{"filial":"0101","filOrig":"01","prefixo":"EMP","numero":"000000123","parcela":"07","tipo":"DEF","natureza":"2010101","fornecedor":"004521","loja":"01","emissao":"2026-01-15","vencimento":"2026-07-15","valor":15234.56,"historico":"Parcela 7 do contrato 123 — Banco Exempl","moeda":1}';

// Guia de arrecadação (linha publicada, módulo 10) e boleto bancário (47).
const ARRECADACAO_LINE = "836400000011331201380002812884627116080136181551";
const ARRECADACAO_BARCODE = "83640000001331201380008128846271108013618155";
const BOLETO_LINE = "23790123016000000005325000456704979870000010000";
const BOLETO_BARCODE = "23799798700000100000123060000000052500045670";

function payloadTests() {
  const payload = (title) => buildErpTitlePayload({ ...LOAN_TITLE, ...title }, ENTITY, null, CODES);

  // Título sem código de barras: o mesmo corpo de antes, em todas as formas de "não tem".
  for (const [label, extra] of [
    ["sem as colunas", {}],
    ["colunas nulas", { codigo_barras: null, linha_digitavel: null }],
    ["colunas vazias", { codigo_barras: "", linha_digitavel: "" }],
  ]) {
    const body = JSON.stringify(payload(extra));
    check(body === LOAN_PAYLOAD_BEFORE, `título de empréstimo ${label}: corpo mudou\n   antes:  ${LOAN_PAYLOAD_BEFORE}\n   depois: ${body}`);
  }

  // Com código de barras: os dois campos no fim, só dígitos.
  const withGuide = payload({ codigo_barras: ARRECADACAO_BARCODE, linha_digitavel: ARRECADACAO_LINE });
  check(withGuide.codBarras === ARRECADACAO_BARCODE && withGuide.linhaDigitavel === ARRECADACAO_LINE, `guia de arrecadação: ${JSON.stringify(withGuide)}`);
  check(
    JSON.stringify(withGuide) === `${LOAN_PAYLOAD_BEFORE.slice(0, -1)},"codBarras":"${ARRECADACAO_BARCODE}","linhaDigitavel":"${ARRECADACAO_LINE}"}`,
    `campos novos acrescentados no fim, sem mexer nos demais: ${JSON.stringify(withGuide)}`
  );
  const boleto = payload({ codigo_barras: BOLETO_BARCODE, linha_digitavel: "23790.12301 60000.000053 25000.456704 9 79870000010000" });
  check(boleto.codBarras === BOLETO_BARCODE && boleto.linhaDigitavel === BOLETO_LINE, `boleto com máscara vira só dígitos: ${JSON.stringify(boleto)}`);
  const maskedBarcode = payload({ codigo_barras: `${ARRECADACAO_BARCODE.slice(0, 11)} ${ARRECADACAO_BARCODE.slice(11, 22)}.${ARRECADACAO_BARCODE.slice(22)}` });
  check(maskedBarcode.codBarras === ARRECADACAO_BARCODE, `código de barras com espaço e ponto vira só dígitos: ${maskedBarcode.codBarras}`);
  const barcodeOnly = payload({ codigo_barras: ARRECADACAO_BARCODE });
  check(barcodeOnly.codBarras === ARRECADACAO_BARCODE && !("linhaDigitavel" in barcodeOnly), "só código de barras: linha não vai");
  const lineOnly = payload({ linha_digitavel: ARRECADACAO_LINE });
  check(!("codBarras" in lineOnly) && !("linhaDigitavel" in lineOnly), "linha sem código de barras não vai sozinha");
  const shortBarcode = payload({ codigo_barras: ARRECADACAO_BARCODE.slice(0, 43), linha_digitavel: ARRECADACAO_LINE });
  check(!("codBarras" in shortBarcode) && !("linhaDigitavel" in shortBarcode), "código de barras sem 44 dígitos não vai");
  const shortLine = payload({ codigo_barras: ARRECADACAO_BARCODE, linha_digitavel: ARRECADACAO_LINE.slice(0, 46) });
  check(shortLine.codBarras === ARRECADACAO_BARCODE && !("linhaDigitavel" in shortLine), "linha sem 47/48 dígitos não vai");

  // Consulta e estorno: só a chave e os dados conferidos, como antes — sem os campos novos.
  const lookup = erpTitleLookupPayload(withGuide);
  check(JSON.stringify(lookup) === LOAN_PAYLOAD_BEFORE, `consulta/estorno de título com boleto: ${JSON.stringify(lookup)}`);
  check(JSON.stringify(erpTitleLookupPayload(payload({}))) === LOAN_PAYLOAD_BEFORE, "consulta/estorno de título de empréstimo: corpo de antes");
  check("codBarras" in withGuide, "a remoção da consulta não altera o corpo da inclusão");
}

async function columnTests() {
  const suffix = `${Date.now()}`;
  const groupId = `grp_cb_${suffix}`;
  const entityId = `ent_cb_${suffix}`;
  const contractId = `ctr_cb_${suffix}`;
  const client = await pool.connect();
  // Tudo numa transação desfeita no fim: nada fica no banco.
  try {
    await client.query("BEGIN");
    const bank = await client.query(`SELECT id FROM banks ORDER BY created_date ASC LIMIT 1`);
    if (!bank.rows[0]) throw new Error("É preciso ao menos um banco cadastrado para o teste");
    await client.query(`INSERT INTO groups (id, group_name, status, created_by) VALUES ($1,'Código de barras','ativo','teste')`, [groupId]);
    await client.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, codigo_empresa, codigo_filial, status, created_by)
       VALUES ($1,$2,'Empresa CB','00.000.000/0001-99','CNPJ','empresa','99','01','ativa','teste')`,
      [entityId, groupId]
    );
    await client.query(
      `INSERT INTO loan_contracts (id, group_id, entity_id, bank_id, contract_number, status, created_by) VALUES ($1,$2,$3,$4,'CB1','rascunho','teste')`,
      [contractId, groupId, entityId, bank.rows[0].id]
    );
    let n = 0;
    const insert = async (codigoBarras, linhaDigitavel) => {
      n += 1;
      await client.query("SAVEPOINT t");
      try {
        await client.query(
          `INSERT INTO payable_titles (id, group_id, entity_id, contract_id, parcela, titulo_numero, valor, saldo, status, created_by, codigo_barras, linha_digitavel)
           VALUES ($1,$2,$3,$4,$5,'000000001',10,10,'aberto','teste',$6,$7)`,
          [randomUUID(), groupId, entityId, contractId, String(n).padStart(3, "0"), codigoBarras, linhaDigitavel]
        );
        await client.query("RELEASE SAVEPOINT t");
        return null;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT t");
        return error.constraint || error.code;
      }
    };
    const cases = [
      ["sem código de barras", null, null, null],
      ["arrecadação: código e linha coerentes", ARRECADACAO_BARCODE, ARRECADACAO_LINE, null],
      ["boleto: código e linha coerentes", BOLETO_BARCODE, BOLETO_LINE, null],
      ["só código de barras", ARRECADACAO_BARCODE, null, null],
      ["código com 43 dígitos", ARRECADACAO_BARCODE.slice(0, 43), null, "payable_titles_codigo_barras_check"],
      ["código com máscara", `${ARRECADACAO_BARCODE.slice(0, 11)}-${ARRECADACAO_BARCODE.slice(11, 43)}`, null, "payable_titles_codigo_barras_check"],
      ["linha sem código de barras", null, ARRECADACAO_LINE, "payable_titles_linha_digitavel_check"],
      ["linha de outra guia", ARRECADACAO_BARCODE, `${ARRECADACAO_LINE.slice(0, 20)}9${ARRECADACAO_LINE.slice(21)}`, "payable_titles_linha_digitavel_check"],
      ["linha de boleto com código de outro boleto", BOLETO_BARCODE.replace(/0$/, "1"), BOLETO_LINE, "payable_titles_linha_digitavel_check"],
      ["linha de arrecadação com 47 dígitos", ARRECADACAO_BARCODE, ARRECADACAO_LINE.slice(0, 47), "payable_titles_linha_digitavel_check"],
      ["linha de 48 que não começa com 8", `2${ARRECADACAO_BARCODE.slice(1)}`, `2${ARRECADACAO_LINE.slice(1)}`, "payable_titles_linha_digitavel_check"],
      ["linha com máscara", ARRECADACAO_BARCODE, `${ARRECADACAO_LINE.slice(0, 11)}-${ARRECADACAO_LINE.slice(11, 47)}`, "payable_titles_linha_digitavel_check"],
    ];
    for (const [label, codigo, linha, expected] of cases) {
      const got = await insert(codigo, linha);
      check(got === expected, `coluna (${label}): esperado ${expected || "aceito"}, veio ${got || "aceito"}`);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

async function main() {
  payloadTests();
  await columnTests();
  if (failures.length) {
    console.error(`payload do título a pagar: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    await pool.end();
    process.exit(1);
  }
  console.log("payload do título a pagar ok: empréstimo igual ao de antes, código de barras só na inclusão, colunas validadas");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
