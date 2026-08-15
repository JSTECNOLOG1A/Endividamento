import * as integrationStore from "../integrations/store.js";
import * as entityStore from "../entities/store.js";
import { decryptSecret } from "../integrations/crypto.js";
import { fetchCadastroAcrossGroup } from "../integrations/protheusScope.js";
import { normalizeGrupoEmpresas, protheusTableName } from "../integrations/protheus.js";
import { findEntityByEmpresaFilial, normalizeEmpresaCode } from "./entityMatch.js";
import { natureRowKey, parseNaturesFromErp } from "./parser.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function loadLinkedNatureEndpoint() {
  const linked = await integrationStore.findLinkedCadastro("naturezas", "GET");
  if (!linked) {
    throw httpError(400, "Nenhum endpoint GET vinculado ao cadastro Naturezas. Configure em Configurações > Integrações.");
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

function findExistingNature(existingByKey, item) {
  const exact = existingByKey.get(natureRowKey(item.empresa, item.filial, item.codigo));
  if (exact) return exact;
  const legacy = existingByKey.get(natureRowKey("", item.filial, item.codigo));
  if (legacy) return legacy;
  for (const row of existingByKey.values()) {
    if (row.filial === item.filial && row.codigo === item.codigo && !row.empresa) return row;
  }
  return null;
}

async function fetchParsedNatures() {
  const { linked, credential } = await loadLinkedNatureEndpoint();
  const fetched = await fetchCadastroAcrossGroup({
    integration: linked.integration,
    credential,
    path: linked.endpoint.path,
    parseItems: (payload, scope) => parseNaturesFromErp(payload, scope),
  });

  const parsed = fetched.items.filter((item) => !item.bloqueado);
  if (!parsed.length) {
    throw httpError(404, "Nenhuma natureza liberada encontrada. Registros bloqueados são ignorados.");
  }

  return { parsed, linked, scopes: fetched.scopes };
}

function attachEntityMatch(item, companies) {
  const { entity, ambiguous } = findEntityByEmpresaFilial(companies, item.empresa, item.filial);
  return {
    ...item,
    empresa: item.empresa || (entity ? normalizeEmpresaCode(entity.codigo_empresa) : ""),
    filial: "",
    entity_id: entity?.id || null,
    entity_name: entity?.entity_name || null,
    entity_codigo: entity ? normalizeEmpresaCode(entity.codigo_empresa) : null,
    entity_filial: entity ? normalizeEmpresaCode(entity.codigo_filial) : null,
    unmatched: !entity,
    ambiguous,
  };
}

export async function previewNatures() {
  const { parsed, linked, scopes } = await fetchParsedNatures();
  const [existing, companies] = await Promise.all([
    entityStore.list("Nature", "codigo", 20000),
    entityStore.list("CompanyEntity", "entity_name", 5000),
  ]);
  const existingByKey = new Map(existing.map((row) => [natureRowKey(row.empresa, row.filial, row.codigo), row]));
  const grupo = normalizeGrupoEmpresas(linked.integration.grupoEmpresas);
  const empresas = [...new Set(scopes.map((scope) => scope.empresa).filter(Boolean))];

  return {
    items: parsed.map((item) => ({
      ...attachEntityMatch(item, companies),
      already_exists: Boolean(findExistingNature(existingByKey, item)),
    })),
    connection_name: linked.integration.nome,
    endpoint_path: linked.endpoint.path,
    grupo_empresas: linked.integration.grupoEmpresas,
    empresa: linked.integration.empresa,
    filial: linked.integration.filial,
    empresas,
    scopes,
    tabela: grupo ? protheusTableName("SED", linked.integration.grupoEmpresas) : null,
  };
}

export async function integrateNatures(payload = {}, createdBy) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw httpError(400, "Selecione ao menos uma natureza para importar");
  }

  const unique = new Map();
  for (const raw of items) {
    const codigo = String(raw.codigo || "").trim();
    const descricao = String(raw.descricao || "").trim();
    if (!codigo || !descricao) continue;
    if (raw.bloqueado) continue;
    const empresa = String(raw.empresa || "").trim();
    const filial = String(raw.filial || "").trim();
    unique.set(natureRowKey(empresa, filial, codigo), {
      empresa,
      filial,
      codigo,
      descricao,
      tipo_conta: raw.tipo_conta || null,
      c_custo: raw.c_custo || null,
      c_des_fat: raw.c_des_fat || null,
      tipo_natureza: raw.tipo_natureza === "sintetica" ? "sintetica" : "analitica",
      gera_lcdpr: Boolean(raw.gera_lcdpr),
      origem: "integrado",
      status: "ativo",
    });
  }

  const selected = [...unique.values()];
  const [existing, companies] = await Promise.all([
    entityStore.list("Nature", "codigo", 20000),
    entityStore.list("CompanyEntity", "entity_name", 5000),
  ]);
  const existingByKey = new Map(existing.map((row) => [natureRowKey(row.empresa, row.filial, row.codigo), row]));

  let created = 0;
  let updated = 0;
  let skipped_unmatched = 0;
  for (const item of selected) {
    const matched = attachEntityMatch(item, companies);
    if (!matched.entity_id) {
      skipped_unmatched += 1;
      continue;
    }
    const naturePayload = {
      ...item,
      entity_id: matched.entity_id,
      empresa: matched.entity_codigo || item.empresa,
      filial: "",
    };
    const current = findExistingNature(existingByKey, item);
    if (current) {
      await entityStore.update("Nature", current.id, naturePayload);
      updated += 1;
    } else {
      await entityStore.create("Nature", naturePayload, createdBy);
      created += 1;
    }
  }

  if (!created && !updated) {
    throw httpError(
      400,
      skipped_unmatched
        ? "Nenhuma natureza pôde ser importada. Informe o código da empresa Protheus na entidade correspondente."
        : "Selecione ao menos uma natureza para importar"
    );
  }

  return {
    created,
    updated,
    selected: selected.length,
    skipped_unmatched,
  };
}
