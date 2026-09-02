import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { allowedColumns, getEntity, SYSTEM_FIELDS } from "./catalog.js";
import { entityMatchesNature, normalizeEmpresaCode } from "../natures/entityMatch.js";
import { normalizeBankCode } from "../bankAccounts/bankMatch.js";
import { groupIdOrNull, groupIdOrThrow, isPlatformAdmin } from "../tenants/access.js";
import {
  assertCanCreateContract,
  assertCanWrite,
  assertOwner,
  bumpContractsUsed,
  actorEmail,
  assertCanApproveContract,
  resolveContractReopen,
} from "../tenants/policy.js";
import {
  CREATE_BLOCKED,
  ENTITY_SCOPE,
  WRITE_BLOCKED,
  assertContractInTenant,
  assertEntityInTenant,
  combineWhere,
  stampGroupId,
  tenantClause,
} from "../tenants/scope.js";

export const CONTRACT_WORKFLOW_FIELDS = [
  "status",
  "approved_by",
  "approved_date",
  "status_history",
  "exported_to_payables",
  "exported_to_receivables",
  "reopen_requested_by",
  "reopen_requested_at",
  "current_snapshot_id",
  "approved_snapshot_id",
];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function mapDbError(error) {
  if (error?.code === "23502") {
    if (error.column === "group_id") return httpError(400, "Selecione o grupo econômico");
    if (error.column === "entity_id") return httpError(400, "Selecione a entidade componente");
    return httpError(400, "Preencha todos os campos obrigatórios");
  }
  if (error?.code === "23503") {
    const constraint = String(error.constraint || "");
    if (constraint.includes("payable_titles_entity")) {
      return httpError(409, "Não é possível excluir a entidade enquanto houver títulos a pagar vinculados");
    }
    if (constraint.includes("payable_titles_contract")) {
      return httpError(409, "Não é possível excluir o contrato enquanto houver títulos a pagar vinculados");
    }
    if (constraint.includes("group")) {
      return httpError(400, "O grupo econômico informado não existe");
    }
    if (constraint.includes("entity")) {
      return httpError(400, "A entidade informada não existe");
    }
    if (constraint.includes("bank_accounts_bank")) {
      return httpError(409, "Não é possível excluir o banco enquanto houver contas vinculadas");
    }
    if (constraint.includes("bank_accounts_entity")) {
      return httpError(409, "Não é possível excluir a entidade enquanto houver contas bancárias vinculadas");
    }
    if (constraint.includes("bank_id") || constraint.includes("banks")) {
      return httpError(400, "O banco informado não existe");
    }
    if (constraint.includes("currency")) {
      return httpError(400, "A moeda informada não existe");
    }
    return httpError(400, "Registro relacionado não encontrado");
  }
  if (error?.code === "23505") {
    const constraint = String(error.constraint || "");
    if (constraint.includes("codigo_empresa") || constraint.includes("empresa_filial")) {
      return httpError(409, "Já existe uma entidade com essa empresa e filial Protheus neste grupo");
    }
    if (constraint.includes("natures_empresa")) {
      return httpError(409, "Já existe uma natureza com esse código nesta empresa e filial");
    }
    if (constraint.includes("bank_accounts")) {
      return httpError(409, "Já existe uma conta com essa agência e número neste banco e empresa");
    }
    if (constraint.includes("payable_titles_contract")) {
      return httpError(409, "Já existe um título para esta parcela do contrato");
    }
    if (constraint.includes("account_code") || constraint.includes("chart_of_accounts")) {
      return httpError(409, "Já existe uma conta com esse código no plano de contas");
    }
    return httpError(409, "Já existe um registro com esses dados");
  }
  return error;
}

const DATE_FIELDS = new Set([
  "operation_date", "first_payment_date", "final_maturity_date", "rate_date",
  "holiday_date", "trial_ends_at", "emissao", "vencimento", "approved_date",
  "integrado_erp_em", "erp_consultado_em",
]);

function toDbValue(entity, key, value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") {
    if (key.endsWith("_id") || DATE_FIELDS.has(key) || key.endsWith("_url")) return null;
  }
  if (entity.booleans.includes(key)) return Boolean(value);
  if (entity.numbers.includes(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}

function fromDbValue(entity, key, value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) {
    if (["operation_date", "first_payment_date", "final_maturity_date", "rate_date", "holiday_date", "trial_ends_at", "emissao", "vencimento"].includes(key)) {
      return value.toISOString().slice(0, 10);
    }
    return value.toISOString();
  }
  if (entity.booleans.includes(key)) return Boolean(value);
  if (entity.numbers.includes(key) && value !== null) return Number(value);
  if (key === "currency_code" || key === "currency") return value ? String(value).trim() : value;
  return value;
}

function splitPayload(entity, data = {}) {
  const known = allowedColumns(entity);
  const row = {};
  const extra = {};
  for (const [key, value] of Object.entries(data)) {
    if (SYSTEM_FIELDS.includes(key) && key !== "created_by") continue;
    if (known.has(key)) row[key] = toDbValue(entity, key, value);
    else extra[key] = value;
  }
  if (Object.keys(extra).length > 0) row.extra_json = extra;
  return row;
}

function rowToObject(entity, row) {
  if (!row) return null;
  const obj = {};
  let extra = null;
  for (const [key, value] of Object.entries(row)) {
    if (key === "extra_json") {
      extra = value && typeof value === "object" ? value : null;
      continue;
    }
    obj[key] = fromDbValue(entity, key, value);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (obj[key] === undefined || obj[key] === null || obj[key] === "") obj[key] = value;
    }
  }
  return obj;
}

function parseSort(entity, sort) {
  const allowed = allowedColumns(entity);
  if (!sort) return { column: "created_date", dir: "DESC" };
  const desc = sort.startsWith("-");
  const column = desc ? sort.slice(1) : sort;
  if (!allowed.has(column)) return { column: "created_date", dir: "DESC" };
  return { column, dir: desc ? "DESC" : "ASC" };
}

function buildFilter(entity, query = {}) {
  const allowed = allowedColumns(entity);
  const where = [];
  const params = [];
  let i = 1;
  for (const [key, value] of Object.entries(query || {})) {
    if (!allowed.has(key)) continue;
    if (value && typeof value === "object" && Array.isArray(value.$in)) {
      if (value.$in.length === 0) {
        where.push("1 = 0");
        continue;
      }
      const slots = value.$in.map(() => `$${i++}`);
      where.push(`${key} IN (${slots.join(", ")})`);
      params.push(...value.$in);
    } else {
      where.push(`${key} = $${i++}`);
      params.push(toDbValue(entity, key, value));
    }
  }
  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export async function list(name, sort, limit = 100) {
  const entity = getEntity(name);
  const { column, dir } = parseSort(entity, sort);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 20000);
  const scope = tenantClause(name);
  const result = await pool.query(
    `SELECT * FROM ${entity.table} WHERE ${scope.sql} ORDER BY ${column} ${dir} LIMIT $${scope.params.length + 1}`,
    [...scope.params, safeLimit]
  );
  return result.rows.map((row) => rowToObject(entity, row));
}

export async function filter(name, query, sort, limit = 100) {
  const entity = getEntity(name);
  const { column, dir } = parseSort(entity, sort);
  const safeQuery = { ...(query || {}) };
  const scopedGroup = groupIdOrNull();
  if (safeQuery.group_id) {
    if (scopedGroup && safeQuery.group_id !== scopedGroup) {
      return [];
    }
    if (scopedGroup || !isPlatformAdmin()) {
      delete safeQuery.group_id;
    }
  }
  const { sql, params } = buildFilter(entity, safeQuery);
  const scope = tenantClause(name, { startIndex: params.length + 1 });
  const where = combineWhere(sql, scope.sql);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 20000);
  const result = await pool.query(
    `SELECT * FROM ${entity.table} ${where} ORDER BY ${column} ${dir} LIMIT $${params.length + scope.params.length + 1}`,
    [...params, ...scope.params, safeLimit]
  );
  return result.rows.map((row) => rowToObject(entity, row));
}

export async function getById(name, id) {
  const entity = getEntity(name);
  const scope = tenantClause(name, { startIndex: 2 });
  const result = await pool.query(
    `SELECT * FROM ${entity.table} WHERE id = $1 AND ${scope.sql}`,
    [id, ...scope.params]
  );
  if (!result.rows[0]) throw httpError(404, `${name} não encontrado`);
  return rowToObject(entity, result.rows[0]);
}

async function stampNatureFromEntity(row) {
  const entityId = String(row.entity_id || "").trim();
  if (!entityId) {
    throw httpError(400, "Selecione a entidade componente");
  }
  row.entity_id = entityId;
  let company;
  try {
    company = await getById("CompanyEntity", entityId);
  } catch (error) {
    if (error?.status === 404) throw httpError(400, "A entidade informada não existe");
    throw error;
  }
  const empresa = normalizeEmpresaCode(company.codigo_empresa);
  if (!empresa) {
    throw httpError(400, "Informe o código da empresa Protheus na entidade para vincular a natureza");
  }
  if (!entityMatchesNature(company, row.empresa, row.filial)) {
    throw httpError(400, "A natureza não pertence à empresa Protheus desta entidade");
  }
  row.empresa = empresa;
  row.filial = "";
}

async function stampBankAccountFromEntity(row) {
  const entityId = String(row.entity_id || "").trim();
  const bankId = String(row.bank_id || "").trim();
  if (!entityId) {
    throw httpError(400, "Selecione a entidade componente");
  }
  if (!bankId) {
    throw httpError(400, "Selecione o banco");
  }
  row.entity_id = entityId;
  row.bank_id = bankId;

  let company;
  try {
    company = await getById("CompanyEntity", entityId);
  } catch (error) {
    if (error?.status === 404) throw httpError(400, "A entidade informada não existe");
    throw error;
  }
  const empresa = normalizeEmpresaCode(company.codigo_empresa);
  if (!empresa) {
    throw httpError(400, "Informe o código da empresa Protheus na entidade para vincular a conta");
  }
  if (!entityMatchesNature(company, row.empresa, row.filial)) {
    throw httpError(400, "A conta não pertence à empresa Protheus desta entidade");
  }

  let bank;
  try {
    bank = await getById("Bank", bankId);
  } catch (error) {
    if (error?.status === 404) throw httpError(400, "O banco informado não existe");
    throw error;
  }
  const bankCode = normalizeBankCode(bank.bank_code);
  if (!bankCode) {
    throw httpError(400, "Informe o código COMPE do banco");
  }
  if (row.bank_code && normalizeBankCode(row.bank_code) !== bankCode) {
    throw httpError(400, "A conta não pertence a este banco");
  }

  const agencia = String(row.agencia || "").trim();
  const conta = String(row.conta || "").trim();
  const nome = String(row.nome || "").trim();
  if (!agencia || !conta) {
    throw httpError(400, "Informe agência e conta");
  }
  if (!nome) {
    throw httpError(400, "Informe o nome da conta");
  }

  row.empresa = empresa;
  row.filial = "";
  row.bank_code = bankCode;
  row.agencia = agencia;
  row.conta = conta;
  row.nome = nome;
  if (row.digito !== undefined) row.digito = String(row.digito || "").trim();
}

function normalizeCompanyEntityRow(row) {
  if (row.codigo_empresa !== undefined) {
    row.codigo_empresa = normalizeEmpresaCode(row.codigo_empresa);
  }
  if (row.codigo_filial !== undefined) {
    row.codigo_filial = normalizeEmpresaCode(row.codigo_filial);
  }
}

async function syncNaturesForEntity(entityId, codigoEmpresa, codigoFilial) {
  const empresa = normalizeEmpresaCode(codigoEmpresa);
  const filial = normalizeEmpresaCode(codigoFilial);
  if (!entityId) return;

  await pool.query(
    `UPDATE natures SET entity_id = NULL, updated_date = now() WHERE entity_id = $1 AND group_id = $2`,
    [entityId, groupIdOrThrow()]
  );

  if (!empresa) return;

  await pool.query(
    `UPDATE natures
     SET entity_id = $1, empresa = $2, filial = '', updated_date = now()
     WHERE entity_id IS NULL
       AND group_id = $3
       AND (
         lpad(regexp_replace(COALESCE(empresa, ''), '[^0-9]', '', 'g'), 2, '0') = $2
         OR (
           COALESCE(empresa, '') = ''
           AND regexp_replace(COALESCE(filial, ''), '[^0-9]', '', 'g') <> ''
           AND lpad(regexp_replace(filial, '[^0-9]', '', 'g'), 2, '0') = $2
         )
       )`,
    [entityId, empresa, groupIdOrThrow()]
  );
}

async function syncBankAccountsForEntity(entityId, codigoEmpresa) {
  const empresa = normalizeEmpresaCode(codigoEmpresa);
  if (!entityId) return;

  await pool.query(
    `UPDATE bank_accounts SET entity_id = NULL, updated_date = now() WHERE entity_id = $1 AND group_id = $2`,
    [entityId, groupIdOrThrow()]
  );

  if (!empresa) return;

  await pool.query(
    `UPDATE bank_accounts
     SET entity_id = $1, empresa = $2, filial = '', updated_date = now()
     WHERE entity_id IS NULL
       AND group_id = $3
       AND (
         lpad(regexp_replace(COALESCE(empresa, ''), '[^0-9]', '', 'g'), 2, '0') = $2
         OR (
           COALESCE(empresa, '') = ''
           AND regexp_replace(COALESCE(filial, ''), '[^0-9]', '', 'g') <> ''
           AND lpad(regexp_replace(filial, '[^0-9]', '', 'g'), 2, '0') = $2
         )
       )`,
    [entityId, empresa, groupIdOrThrow()]
  );
}

async function syncBankAccountsForBank(bankId, bankCode) {
  if (!bankId) return;
  const code = normalizeBankCode(bankCode);
  if (!code) return;
  await pool.query(
    `UPDATE bank_accounts SET bank_code = $1, updated_date = now() WHERE bank_id = $2 AND group_id = $3`,
    [code, bankId, groupIdOrThrow()]
  );
}

export async function create(name, data, createdBy) {
  if (CREATE_BLOCKED.has(name)) {
    throw httpError(403, "Este cadastro não pode ser criado por esta via");
  }
  if (name === "LoanContract") await assertCanCreateContract();
  else await assertCanWrite();
  const entity = getEntity(name);
  const row = splitPayload(entity, data);
  const spec = ENTITY_SCOPE[name];
  stampGroupId(row, { shared: spec?.type === "shared" });
  if (name === "LoanContract") {
    for (const key of CONTRACT_WORKFLOW_FIELDS) delete row[key];
    row.status = "rascunho";
  }
  if (row.entity_id) await assertEntityInTenant(row.entity_id);
  if (row.contract_id && (name === "AccountMovement" || name === "NotificationLog" || name === "CalculationSnapshot")) {
    const contract = await assertContractInTenant(row.contract_id);
    row.group_id = contract.group_id;
  }
  if (name === "CompanyEntity") normalizeCompanyEntityRow(row);
  if (name === "Bank" && row.bank_code !== undefined) {
    row.bank_code = normalizeBankCode(row.bank_code);
  }
  if (name === "Nature") await stampNatureFromEntity(row);
  if (name === "BankAccount") await stampBankAccountFromEntity(row);
  if (name === "LoanContract" && row.entity_id) {
    const company = await assertEntityInTenant(row.entity_id);
    row.group_id = company.group_id;
  }
  if (name === "CalculationSnapshot" && row.contract_id) {
    const contract = await getById("LoanContract", row.contract_id);
    row.group_id = contract.group_id;
  }
  row.id = randomUUID();
  row.created_by = name === "LoanContract" ? (actorEmail() || createdBy) : (data?.created_by || createdBy);
  const keys = Object.keys(row);
  const values = keys.map((key) => row[key]);
  const slots = keys.map((_, idx) => `$${idx + 1}`);
  try {
    await pool.query(
      `INSERT INTO ${entity.table} (${keys.join(", ")}) VALUES (${slots.join(", ")})`,
      values
    );
  } catch (error) {
    throw mapDbError(error);
  }
  if (name === "CompanyEntity") {
    await syncNaturesForEntity(row.id, row.codigo_empresa, row.codigo_filial);
    await syncBankAccountsForEntity(row.id, row.codigo_empresa);
  }
  if (name === "LoanContract") await bumpContractsUsed(1);
  return getById(name, row.id);
}

export async function bulkCreate(name, items = [], createdBy) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = [];
    for (const item of items) {
      created.push(await create(name, item, createdBy));
    }
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function parseStatusHistory(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function applyLoanContractRules(previous, data) {
  const nextStatus = data.status;
  if (nextStatus && nextStatus !== previous.status) {
    if (nextStatus === "aprovado") {
      assertCanApproveContract(previous);
      data.approved_by = actorEmail();
      data.approved_date = new Date().toISOString().slice(0, 10);
    }
    if (previous.status === "aprovado" && nextStatus !== "aprovado") {
      const decision = await resolveContractReopen(previous);
      if (decision.action === "request") {
        delete data.status;
        delete data.exported_to_payables;
        delete data.exported_to_receivables;
        data.reopen_requested_by = decision.requestedBy;
        data.reopen_requested_at = new Date().toISOString();
        const history = parseStatusHistory(previous.status_history);
        history.push({
          from: previous.status,
          to: previous.status,
          event: "reopen_requested",
          by: decision.requestedBy,
          at: data.reopen_requested_at,
        });
        data.status_history = JSON.stringify(history);
        return data;
      }
      data.reopen_requested_by = null;
      data.reopen_requested_at = null;
    }
  }
  return data;
}

export async function update(name, id, data) {
  if (WRITE_BLOCKED.has(name)) {
    throw httpError(403, "Este cadastro não pode ser alterado por esta via");
  }
  await assertCanWrite();
  const entity = getEntity(name);
  if (entity.immutable) throw httpError(409, `${name} é imutável`);
  const previous = await getById(name, id);
  if (ENTITY_SCOPE[name]?.type === "shared" && !previous.group_id) {
    throw httpError(403, "O catálogo compartilhado não pode ser alterado");
  }
  if (name === "AccountingClosing" && previous.status === "aprovado" && data?.status !== "reaberto") {
    throw httpError(409, "Fechamento aprovado — reabra o período (admin, com justificativa) antes de alterar.");
  }
  if (name === "LoanContract") {
    const incoming = { ...(data || {}) };
    for (const key of CONTRACT_WORKFLOW_FIELDS) {
      if (key !== "status") delete incoming[key];
    }
    data = await applyLoanContractRules(previous, incoming);
  }
  const row = splitPayload(entity, data);
  delete row.group_id;
  delete row.id;
  if (row.entity_id) await assertEntityInTenant(row.entity_id);
  if (name === "CompanyEntity") normalizeCompanyEntityRow(row);
  if (name === "Bank" && row.bank_code !== undefined) {
    row.bank_code = normalizeBankCode(row.bank_code);
  }
  if (name === "Nature") await stampNatureFromEntity(row);
  if (name === "BankAccount") await stampBankAccountFromEntity(row);
  if (
    name === "LoanContract"
    && previous.status === "aprovado"
    && data?.status
    && data.status !== "aprovado"
  ) {
    const { reverseTitlesForContractReopen } = await import("../contracts/reverseOnReopen.js");
    await reverseTitlesForContractReopen(id);
    row.exported_to_payables = false;
    row.exported_to_receivables = false;
  }
  row.updated_date = new Date().toISOString();
  const keys = Object.keys(row);
  if (keys.length === 1 && keys[0] === "updated_date") return getById(name, id);
  const assignments = keys.map((key, idx) => `${key} = $${idx + 1}`).join(", ");
  const scope = tenantClause(name, { startIndex: keys.length + 2 });
  try {
    await pool.query(
      `UPDATE ${entity.table} SET ${assignments} WHERE id = $${keys.length + 1} AND ${scope.sql}`,
      [...keys.map((key) => row[key]), id, ...scope.params]
    );
  } catch (error) {
    throw mapDbError(error);
  }
  if (name === "CompanyEntity") {
    const saved = await getById(name, id);
    await syncNaturesForEntity(id, saved.codigo_empresa, saved.codigo_filial);
    await syncBankAccountsForEntity(id, saved.codigo_empresa);
    return saved;
  }
  if (name === "Bank") {
    const saved = await getById(name, id);
    await syncBankAccountsForBank(id, saved.bank_code);
    return saved;
  }
  const saved = await getById(name, id);
  if (name === "LoanContract" && saved.status === "aprovado" && previous.status !== "aprovado") {
    try {
      const { generatePayableTitlesForContract } = await import("../payables/generate.js");
      await generatePayableTitlesForContract(saved, saved.created_by || "system");
    } catch (error) {
      logger.error({ err: error, contractId: saved.id }, "falha ao gerar contas a pagar do contrato aprovado");
    }
    try {
      const { generateReceivableTitlesForContract } = await import("../receivables/generate.js");
      await generateReceivableTitlesForContract(saved, saved.created_by || "system");
    } catch (error) {
      logger.error({ err: error, contractId: saved.id }, "falha ao gerar contas a receber do contrato aprovado");
    }
  }
  if (name === "LoanContract" && previous.status !== "cancelado" && saved.status === "cancelado") {
    await bumpContractsUsed(-1);
  }
  if (name === "LoanContract" && saved.status !== previous.status) {
    try {
      const { notifyContractStatusChange } = await import("../notifications/contractNotifications.js");
      await notifyContractStatusChange(saved, previous.status);
    } catch (error) {
      logger.error({ err: error, contractId: saved.id }, "falha ao notificar mudança de status do contrato");
    }
  }
  return saved;
}

export async function remove(name, id) {
  if (WRITE_BLOCKED.has(name) || CREATE_BLOCKED.has(name)) {
    throw httpError(403, "Este cadastro não pode ser excluído por esta via");
  }
  if (name === "CompanyEntity" || name === "Group") await assertOwner("Apenas o proprietário pode excluir empresa ou filial.");
  else await assertCanWrite();
  const entity = getEntity(name);
  if (entity.immutable) throw httpError(409, `${name} é imutável`);
  const existing = await getById(name, id);
  if (ENTITY_SCOPE[name]?.type === "shared" && !existing.group_id) {
    throw httpError(403, "O catálogo compartilhado não pode ser excluído");
  }
  const scope = tenantClause(name, { startIndex: 2 });
  await pool.query(`DELETE FROM ${entity.table} WHERE id = $1 AND ${scope.sql}`, [id, ...scope.params]);
  if (name === "LoanContract" && existing.status !== "cancelado") await bumpContractsUsed(-1);
  return existing;
}
