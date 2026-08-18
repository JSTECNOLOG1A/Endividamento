import * as integrationStore from "../integrations/store.js";
import * as entityStore from "../entities/store.js";
import { decryptSecret } from "../integrations/crypto.js";
import { fetchCadastroAcrossGroup } from "../integrations/protheusScope.js";
import { normalizeGrupoEmpresas, protheusTableName } from "../integrations/protheus.js";
import { findEntityByEmpresaFilial, normalizeEmpresaCode } from "../natures/entityMatch.js";
import { findBankByCode, normalizeBankCode } from "./bankMatch.js";
import { bankAccountRowKey, parseBankAccountsFromErp } from "./parser.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function loadLinkedAccountEndpoint() {
  const linked = await integrationStore.findLinkedCadastro("contas", "GET");
  if (!linked) {
    throw httpError(400, "Nenhum endpoint GET vinculado ao cadastro Contas bancárias. Configure em Configurações > Integrações.");
  }
  if (linked.integration.status !== "ativo") {
    throw httpError(400, `A conexão "${linked.integration.nome}" está inativa. Ative-a em Integrações.`);
  }
  const credRow = await integrationStore.findCredential(linked.integration.id);
  const credential = credRow?.credential_encrypted
    ? decryptSecret(credRow.credential_encrypted)
    : null;
  if (linked.integration.authType !== "none" && !credential) {
    throw httpError(400, "A conexão vinculada não possui credencial cadastrada.");
  }
  return { linked, credential };
}

function findExistingAccount(existingByKey, item) {
  const bankCode = normalizeBankCode(item.bank_code);
  const exact = existingByKey.get(bankAccountRowKey(item.empresa, bankCode, item.agencia, item.conta));
  if (exact) return exact;
  const legacy = existingByKey.get(bankAccountRowKey("", bankCode, item.agencia, item.conta));
  if (legacy) return legacy;
  for (const row of existingByKey.values()) {
    if (
      normalizeBankCode(row.bank_code) === bankCode
      && row.agencia === item.agencia
      && row.conta === item.conta
      && !row.empresa
    ) {
      return row;
    }
  }
  return null;
}

async function fetchParsedAccounts() {
  const { linked, credential } = await loadLinkedAccountEndpoint();
  const fetched = await fetchCadastroAcrossGroup({
    integration: linked.integration,
    credential,
    path: linked.endpoint.path,
    parseItems: (payload, scope) => parseBankAccountsFromErp(payload, scope),
  });

  const parsed = fetched.items;
  if (!parsed.length) {
    throw httpError(404, "Nenhuma conta bancária liberada encontrada. Registros bloqueados são ignorados.");
  }

  return { parsed, linked, scopes: fetched.scopes };
}

function attachMatches(item, companies, banks) {
  const { entity, ambiguous } = findEntityByEmpresaFilial(companies, item.empresa, item.filial);
  const { bank, ambiguous: bankAmbiguous } = findBankByCode(banks, item.bank_code);
  return {
    ...item,
    empresa: item.empresa || (entity ? normalizeEmpresaCode(entity.codigo_empresa) : ""),
    filial: "",
    bank_code: bank ? normalizeBankCode(bank.bank_code) : normalizeBankCode(item.bank_code),
    entity_id: entity?.id || null,
    entity_name: entity?.entity_name || null,
    entity_codigo: entity ? normalizeEmpresaCode(entity.codigo_empresa) : null,
    unmatched: !entity,
    ambiguous,
    bank_id: bank?.id || null,
    bank_name: bank?.bank_name || null,
    bank_unmatched: !bank,
    bank_ambiguous: bankAmbiguous,
  };
}

export async function previewBankAccounts() {
  const { parsed, linked, scopes } = await fetchParsedAccounts();
  const [existing, companies, banks] = await Promise.all([
    entityStore.list("BankAccount", "agencia", 20000),
    entityStore.list("CompanyEntity", "entity_name", 5000),
    entityStore.list("Bank", "bank_code", 5000),
  ]);
  const existingByKey = new Map(
    existing.map((row) => [bankAccountRowKey(row.empresa, normalizeBankCode(row.bank_code), row.agencia, row.conta), row])
  );
  const grupo = normalizeGrupoEmpresas(linked.integration.grupoEmpresas);
  const empresas = [...new Set(scopes.map((scope) => scope.empresa).filter(Boolean))];

  return {
    items: parsed.map((item) => ({
      ...attachMatches(item, companies, banks),
      already_exists: Boolean(findExistingAccount(existingByKey, item)),
    })),
    connection_name: linked.integration.nome,
    endpoint_path: linked.endpoint.path,
    grupo_empresas: linked.integration.grupoEmpresas,
    empresa: linked.integration.empresa,
    filial: linked.integration.filial,
    empresas,
    scopes,
    tabela: grupo ? protheusTableName("SA6", linked.integration.grupoEmpresas) : null,
  };
}

export async function integrateBankAccounts(payload = {}, createdBy) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw httpError(400, "Selecione ao menos uma conta bancária para importar");
  }

  const unique = new Map();
  for (const raw of items) {
    const bankCode = normalizeBankCode(raw.bank_code);
    const agencia = String(raw.agencia || "").trim();
    const conta = String(raw.conta || "").trim();
    const nome = String(raw.nome || "").trim();
    if (!bankCode || !agencia || !conta || !nome) continue;
    const empresa = String(raw.empresa || "").trim();
    unique.set(bankAccountRowKey(empresa, bankCode, agencia, conta), {
      empresa,
      filial: "",
      bank_code: bankCode,
      agencia,
      conta,
      digito: String(raw.digito || "").trim(),
      nome,
      tipo: String(raw.tipo || "").trim() || null,
      moeda: String(raw.moeda || "").trim() || null,
      conta_contabil: String(raw.conta_contabil || "").trim() || null,
      natureza: String(raw.natureza || "").trim() || null,
      origem: "integrado",
      status: "ativo",
    });
  }

  const selected = [...unique.values()];
  const [existing, companies, banks] = await Promise.all([
    entityStore.list("BankAccount", "agencia", 20000),
    entityStore.list("CompanyEntity", "entity_name", 5000),
    entityStore.list("Bank", "bank_code", 5000),
  ]);
  const existingByKey = new Map(
    existing.map((row) => [bankAccountRowKey(row.empresa, normalizeBankCode(row.bank_code), row.agencia, row.conta), row])
  );

  let created = 0;
  let updated = 0;
  let skipped_unmatched = 0;
  for (const item of selected) {
    const matched = attachMatches(item, companies, banks);
    if (!matched.entity_id || !matched.bank_id) {
      skipped_unmatched += 1;
      continue;
    }
    const accountPayload = {
      ...item,
      entity_id: matched.entity_id,
      bank_id: matched.bank_id,
      empresa: matched.entity_codigo || item.empresa,
      bank_code: matched.bank_code,
      filial: "",
    };
    const current = findExistingAccount(existingByKey, item);
    if (current) {
      await entityStore.update("BankAccount", current.id, accountPayload);
      updated += 1;
    } else {
      await entityStore.create("BankAccount", accountPayload, createdBy);
      created += 1;
    }
  }

  if (!created && !updated) {
    throw httpError(
      400,
      skipped_unmatched
        ? "Nenhuma conta pôde ser importada. Informe a empresa Protheus na entidade e cadastre o banco com o mesmo código COMPE."
        : "Selecione ao menos uma conta bancária para importar"
    );
  }

  return {
    created,
    updated,
    selected: selected.length,
    skipped_unmatched,
  };
}
