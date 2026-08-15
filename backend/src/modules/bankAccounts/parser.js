import {
  asTrimmedString,
  extractArray,
  flattenItem,
  isErpBlockedRecord,
  isErpDeletedRecord,
  lookup,
} from "../integrations/erpJson.js";
import { normalizeBankCode } from "./bankMatch.js";

export function bankAccountRowKey(empresa, bankCode, agencia, conta) {
  return `${empresa ?? ""}::${bankCode ?? ""}::${agencia ?? ""}::${conta ?? ""}`;
}

function resolveEmpresa(record, scope = {}) {
  const fromRecord = asTrimmedString(lookup(record, ["empresa", "m0_codigo", "company", "companyid"]));
  const fromFilial = asTrimmedString(lookup(record, ["filial", "a6_filial", "branch", "sourceBranch"]));
  const fromScope = String(scope.empresa || scope.filial || "").trim();
  return fromRecord || fromFilial || fromScope || "";
}

export function parseBankAccountsFromErp(payload, scope = {}) {
  const items = extractArray(payload);
  const parsed = [];
  const seen = new Set();

  for (const item of items) {
    const record = flattenItem(item);
    if (!record) continue;
    if (isErpDeletedRecord(record) || isErpBlockedRecord(record)) continue;

    const bankCode = normalizeBankCode(lookup(record, ["a6_cod", "banco", "bank", "bankcode", "codigoBanco", "codbanco"]));
    const agencia = asTrimmedString(lookup(record, ["a6_agencia", "agencia", "agency", "ag"]));
    const conta = asTrimmedString(lookup(record, [
      "a6_numcon",
      "numcon",
      "contaBancaria",
      "conta_bancaria",
      "accountNumber",
      "nroconta",
      "numeroConta",
    ]));
    if (!bankCode || !agencia || !conta) continue;

    const nome = asTrimmedString(lookup(record, ["a6_nome", "a6_nreduz", "nome", "descricao", "description", "desc"]))
      || `Agência ${agencia} Conta ${conta}`;
    const empresa = resolveEmpresa(record, scope);
    const filial = "";
    const key = bankAccountRowKey(empresa, bankCode, agencia, conta);
    if (seen.has(key)) continue;
    seen.add(key);

    parsed.push({
      empresa,
      filial,
      bank_code: bankCode,
      agencia,
      conta,
      digito: asTrimmedString(lookup(record, ["a6_dvcta", "dvcta", "digito", "dvconta", "dac"])) || "",
      nome,
      tipo: asTrimmedString(lookup(record, ["a6_tipo", "tipo", "tipoConta", "tipo_conta"])) || "",
      moeda: asTrimmedString(lookup(record, ["a6_moeda", "moeda", "currency"])) || "",
      conta_contabil: asTrimmedString(lookup(record, ["a6_conta", "contaContabil", "conta_contabil"])) || "",
      natureza: asTrimmedString(lookup(record, ["a6_naturez", "natureza", "naturez"])) || "",
    });
  }

  return parsed;
}
