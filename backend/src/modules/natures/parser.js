import {
  asTrimmedString,
  extractArray,
  flattenItem,
  isErpBlockedRecord,
  isErpDeletedRecord,
  lookup,
} from "../integrations/erpJson.js";

export function natureRowKey(empresa, filial, codigo) {
  return `${empresa ?? ""}::${filial ?? ""}::${codigo}`;
}

function isProtheusSim(value) {
  const text = asTrimmedString(value);
  if (!text) return false;
  const normalized = text.toUpperCase();
  return normalized === "1" || normalized === "S" || normalized === "SIM" || normalized === "TRUE";
}

function mapTipoConta(value) {
  const text = asTrimmedString(value);
  if (!text) return null;
  const normalized = text.toUpperCase();
  if (["R", "RECEITA", "RECEBER"].includes(normalized)) return "Receita";
  if (["P", "D", "DESPESA", "PAGAR"].includes(normalized)) return "Despesa";
  return text;
}

function mapTipoNatureza(value) {
  const text = asTrimmedString(value);
  if (!text) return "analitica";
  const normalized = text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["1", "S", "SINTETICA", "SINTETICO"].includes(normalized)) return "sintetica";
  return "analitica";
}

function resolveNatureEmpresa(record, scope = {}) {
  const fromRecord = asTrimmedString(lookup(record, ["empresa", "m0_codigo", "company", "companyid"]));
  const fromFilial = asTrimmedString(lookup(record, ["filial", "ed_filial", "branch", "sourceBranch"]));
  const fromScope = String(scope.empresa || scope.filial || "").trim();
  return fromRecord || fromFilial || fromScope || "";
}

export function parseNaturesFromErp(payload, scope = {}) {
  const items = extractArray(payload);
  const parsed = [];
  const seen = new Set();

  for (const item of items) {
    const record = flattenItem(item);
    if (!record) continue;
    if (isErpDeletedRecord(record) || isErpBlockedRecord(record)) continue;

    const codigo = asTrimmedString(lookup(record, ["ed_codigo", "codigo", "code", "codnatureza"]));
    const descricao = asTrimmedString(lookup(record, ["descricao", "descricaoConsulta", "ed_descric", "description", "nome", "desc"]));
    if (!codigo || !descricao) continue;

    const empresa = resolveNatureEmpresa(record, scope);
    const filial = "";
    const key = natureRowKey(empresa, filial, codigo);
    if (seen.has(key)) continue;
    seen.add(key);

    parsed.push({
      empresa,
      filial,
      codigo,
      descricao,
      tipo_conta: mapTipoConta(lookup(record, ["ed_cond", "condicao", "tipoConta", "tipo_conta", "cond"])),
      c_custo: asTrimmedString(lookup(record, ["cCusto", "c_custo", "ed_ccusto", "ccusto"])),
      c_des_fat: asTrimmedString(lookup(record, ["cDesFat", "c_des_fat", "ed_desfat", "cdesfat"])),
      tipo_natureza: mapTipoNatureza(lookup(record, ["tipoNatureza", "tipo_natureza", "ed_tipo", "classe"])),
      gera_lcdpr: isProtheusSim(lookup(record, ["geraLcdpr", "gera_lcdpr", "ed_lcdpr", "lcdpr", "livroCaixa", "livro_caixa"])),
    });
  }

  return parsed;
}
