import { pool } from "../../db/pool.js";

// Cada checagem consulta uma evidência real já existente no sistema — nunca
// "a tela foi aberta". ctx = { groupId, tenantId, tenantCreatedDate }.
//
// 1.3 e 1.7 exigem, além de existir a linha em system_parameters, que ela
// tenha sido alterada por um usuário DEPOIS da criação do tenant (não pelo
// backfill da migração 049, que semeou "appearance.default_layout" pra
// tenants pré-existentes com updated_by = 'migration_049') — evita marcar
// como concluído só porque o valor padrão do catálogo existe.
async function existsQuery(text, params) {
  const result = await pool.query(text, params);
  return result.rowCount > 0;
}

export const AUTO_CHECKS = {
  tenant_created: async (ctx) =>
    existsQuery("SELECT 1 FROM tenants WHERE id = $1", [ctx.tenantId]),

  users_invited: async (ctx) =>
    existsQuery(
      "SELECT 1 FROM tenant_users WHERE group_id = $1 AND role <> 'OWNER' LIMIT 1",
      [ctx.groupId]
    ),

  usage_mode_set: async (ctx) =>
    existsQuery(
      `SELECT 1 FROM system_parameters
       WHERE scope = 'TENANT' AND group_id = $1 AND param_key = 'integrations.external_erp_enabled'
         AND updated_by IS DISTINCT FROM 'migration_049' AND updated_date > $2
       LIMIT 1`,
      [ctx.groupId, ctx.tenantCreatedDate]
    ),

  rest_address_set: async (ctx) =>
    existsQuery(
      "SELECT 1 FROM integrations WHERE group_id = $1 AND btrim(base_url) <> '' LIMIT 1",
      [ctx.groupId]
    ),

  endpoints_created: async (ctx) =>
    existsQuery(
      `SELECT 1 FROM integration_endpoints ie
       JOIN integrations i ON i.id = ie.integration_id
       WHERE i.group_id = $1 LIMIT 1`,
      [ctx.groupId]
    ),

  erp_informed: async (ctx) =>
    existsQuery(
      "SELECT 1 FROM integrations WHERE group_id = $1 AND btrim(coalesce(erp_nome, '')) <> '' LIMIT 1",
      [ctx.groupId]
    ),

  visual_params_set: async (ctx) =>
    existsQuery(
      `SELECT 1 FROM system_parameters
       WHERE group_id = $1 AND param_key LIKE 'appearance.%'
         AND updated_by IS DISTINCT FROM 'migration_049' AND updated_date > $2
       LIMIT 1`,
      [ctx.groupId, ctx.tenantCreatedDate]
    ),

  main_title_type_set: async (ctx) => paramExists(ctx.groupId, "finance.main_title_type"),
  interest_title_type_set: async (ctx) => paramExists(ctx.groupId, "finance.interest_title_type"),
  provisional_title_type_set: async (ctx) => paramExists(ctx.groupId, "finance.provisional_title_type"),
  main_title_nature_set: async (ctx) => paramExists(ctx.groupId, "finance.main_title_nature"),
  interest_title_nature_set: async (ctx) => paramExists(ctx.groupId, "finance.interest_title_nature"),

  schedules_created: async (ctx) =>
    existsQuery("SELECT 1 FROM scheduled_jobs WHERE group_id = $1 LIMIT 1", [ctx.groupId]),

  accounting_mappings_set: async (ctx) =>
    existsQuery(
      `SELECT 1 FROM accounting_event_mappings
       WHERE group_id = $1 AND debit_account_id IS NOT NULL AND credit_account_id IS NOT NULL
       LIMIT 1`,
      [ctx.groupId]
    ),

  approval_levels_set: async (ctx) =>
    existsQuery(
      `SELECT 1 FROM tenant_users tu
       JOIN users u ON lower(u.email) = lower(tu.user_email)
       WHERE tu.group_id = $1 AND u.approval_level > 0 LIMIT 1`,
      [ctx.groupId]
    ),

  approvers_set: async (ctx) =>
    existsQuery(
      `SELECT 1 FROM tenant_users tu
       JOIN users u ON lower(u.email) = lower(tu.user_email)
       WHERE tu.group_id = $1 AND u.approval_level = 2 LIMIT 1`,
      [ctx.groupId]
    ),

  contracts_created: async (ctx) =>
    existsQuery("SELECT 1 FROM loan_contracts WHERE group_id = $1 LIMIT 1", [ctx.groupId]),

  contract_approved: async (ctx) =>
    existsQuery(
      "SELECT 1 FROM loan_contracts WHERE group_id = $1 AND status IN ('aprovado', 'quitado') LIMIT 1",
      [ctx.groupId]
    ),

  payables_created: async (ctx) =>
    existsQuery(
      "SELECT 1 FROM loan_contracts WHERE group_id = $1 AND exported_to_payables IS TRUE LIMIT 1",
      [ctx.groupId]
    ),

  receivables_created: async (ctx) =>
    existsQuery(
      "SELECT 1 FROM loan_contracts WHERE group_id = $1 AND exported_to_receivables IS TRUE LIMIT 1",
      [ctx.groupId]
    ),

  erp_integration_confirmed: async (ctx) =>
    existsQuery(
      `SELECT 1 FROM payable_titles WHERE group_id = $1 AND erp_status = 'integrado'
       UNION ALL
       SELECT 1 FROM receivable_titles WHERE group_id = $1 AND erp_status = 'integrado'
       LIMIT 1`,
      [ctx.groupId]
    ),
};

function paramExists(groupId, paramKey) {
  return existsQuery(
    "SELECT 1 FROM system_parameters WHERE scope = 'TENANT' AND group_id = $1 AND param_key = $2 LIMIT 1",
    [groupId, paramKey]
  );
}

export async function runAutoCheck(key, ctx) {
  const fn = AUTO_CHECKS[key];
  if (!fn) return false;
  return fn(ctx);
}
