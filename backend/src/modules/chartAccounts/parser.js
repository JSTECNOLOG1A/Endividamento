import {
  asTrimmedString,
  extractArray,
  flattenItem,
  isErpBlockedRecord,
  isErpDeletedRecord,
  lookup,
  lookupLoose,
} from "../integrations/erpJson.js";

export function chartAccountRowKey(codigo) {
  return String(codigo ?? "").trim();
}

function mapAccountType(value) {
  const text = asTrimmedString(value);
  if (!text) return "analitica";
  const normalized = text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["1", "S", "SINTETICA", "SINTETICO"].includes(normalized)) return "sintetica";
  return "analitica";
}

function mapAccountNature(value) {
  const text = asTrimmedString(value);
  if (!text) return "devedora";
  const normalized = text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["2", "C", "CREDORA", "CREDOR"].includes(normalized)) return "credora";
  return "devedora";
}

function mapAccountClass(record, code) {
  const raw = asTrimmedString(lookup(record, ["ct1_natcta", "natcta", "account_class"]));
  const normalized = (raw || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["1", "01", "ATIVO"].includes(normalized) || normalized.startsWith("01")) return "ativo";
  if (["2", "02", "PASSIVO"].includes(normalized) || normalized.startsWith("02")) return "passivo";
  if (["3", "03", "PL", "PATRIMONIO"].includes(normalized) || normalized.startsWith("03")) return "patrimonio_liquido";
  if (["4", "04", "RECEITA", "RESULTADO"].includes(normalized) || normalized.startsWith("04")) return "receita";
  if (["5", "05", "DESPESA"].includes(normalized) || normalized.startsWith("05")) return "despesa";

  const digit = String(code || "").replace(/\D/g, "").slice(0, 1);
  if (digit === "1") return "ativo";
  if (digit === "2") return "passivo";
  if (digit === "3") return "patrimonio_liquido";
  if (digit === "4") return "receita";
  return "despesa";
}

export function parseChartAccountsFromErp(payload) {
  const items = extractArray(payload);
  const parsed = [];
  const seen = new Set();

  for (const item of items) {
    const record = flattenItem(item);
    if (!record) continue;
    if (isErpDeletedRecord(record) || isErpBlockedRecord(record)) continue;

    const accountCode = asTrimmedString(lookupLoose(record, ["ct1_conta", "account_code", "conta", "codigo"]));
    const accountName = asTrimmedString(lookupLoose(record, [
      "ct1_desc01",
      "ct1_desc",
      "account_name",
      "descricao",
      "descric",
      "nome",
    ]));
    if (!accountCode || !accountName) continue;

    const key = chartAccountRowKey(accountCode);
    if (seen.has(key)) continue;
    seen.add(key);

    parsed.push({
      account_code: accountCode,
      account_name: accountName,
      account_class: mapAccountClass(record, accountCode),
      account_type: mapAccountType(lookup(record, ["ct1_classe", "classe", "tipo", "account_type", "tipoConta"])),
      account_nature: mapAccountNature(lookup(record, ["ct1_normal", "normal", "natureza", "account_nature"])),
    });
  }

  return parsed;
}
