import * as integrationStore from "../integrations/store.js";
import * as entityStore from "../entities/store.js";
import { decryptSecret } from "../integrations/crypto.js";
import { fetchCadastroAcrossGroup } from "../integrations/protheusScope.js";
import { normalizeGrupoEmpresas, protheusTableName } from "../integrations/protheus.js";
import { chartAccountRowKey, parseChartAccountsFromErp } from "./parser.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function loadLinkedChartEndpoint() {
  const linked = await integrationStore.findLinkedCadastro("plano_contas", "GET");
  if (!linked) {
    throw httpError(400, "Nenhum endpoint GET vinculado ao cadastro Plano de contas. Configure em Configurações > Integrações.");
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

async function fetchParsedAccounts() {
  const { linked, credential } = await loadLinkedChartEndpoint();
  const fetched = await fetchCadastroAcrossGroup({
    integration: linked.integration,
    credential,
    path: linked.endpoint.path,
    parseItems: (payload) => parseChartAccountsFromErp(payload),
    includeBranches: false,
  });

  const parsed = [];
  const seen = new Set();
  for (const item of fetched.items) {
    const key = chartAccountRowKey(item.account_code);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    parsed.push(item);
  }
  if (!parsed.length) {
    throw httpError(404, "Nenhuma conta contábil liberada encontrada. Registros bloqueados e controle por filial são ignorados.");
  }

  return { parsed, linked, scopes: fetched.scopes };
}

export async function previewChartAccounts() {
  const { parsed, linked, scopes } = await fetchParsedAccounts();
  const existing = await entityStore.list("ChartOfAccount", "account_code", 20000);
  const existingByKey = new Map(existing.map((row) => [chartAccountRowKey(row.account_code), row]));
  const grupo = normalizeGrupoEmpresas(linked.integration.grupoEmpresas);
  const empresas = [...new Set(scopes.map((scope) => scope.empresa).filter(Boolean))];

  return {
    items: parsed.map((item) => ({
      ...item,
      already_exists: existingByKey.has(chartAccountRowKey(item.account_code)),
    })),
    connection_name: linked.integration.nome,
    endpoint_path: linked.endpoint.path,
    grupo_empresas: linked.integration.grupoEmpresas,
    empresa: linked.integration.empresa,
    empresas,
    scopes,
    tabela: grupo ? protheusTableName("CT1", linked.integration.grupoEmpresas) : null,
  };
}

export async function integrateChartAccounts(payload = {}, createdBy) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw httpError(400, "Selecione ao menos uma conta do plano para importar");
  }

  const unique = new Map();
  for (const raw of items) {
    const accountCode = String(raw.account_code || "").trim();
    const accountName = String(raw.account_name || "").trim();
    if (!accountCode || !accountName) continue;
    unique.set(chartAccountRowKey(accountCode), {
      account_code: accountCode,
      account_name: accountName,
      account_class: raw.account_class || "despesa",
      account_type: raw.account_type === "sintetica" ? "sintetica" : "analitica",
      account_nature: raw.account_nature === "credora" ? "credora" : "devedora",
      origem: "integrado",
      status: "ativo",
    });
  }

  const selected = [...unique.values()];
  if (!selected.length) {
    throw httpError(400, "Selecione ao menos uma conta do plano para importar");
  }

  const existing = await entityStore.list("ChartOfAccount", "account_code", 20000);
  const existingByKey = new Map(existing.map((row) => [chartAccountRowKey(row.account_code), row]));

  let created = 0;
  let updated = 0;
  for (const item of selected) {
    const current = existingByKey.get(chartAccountRowKey(item.account_code));
    if (current) {
      await entityStore.update("ChartOfAccount", current.id, item);
      updated += 1;
    } else {
      await entityStore.create("ChartOfAccount", item, createdBy);
      created += 1;
    }
  }

  return {
    created,
    updated,
    selected: selected.length,
  };
}
