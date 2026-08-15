export const ENTITIES = {
  Group: {
    table: "groups",
    columns: ["group_name", "cnpj_group", "description", "status"],
    booleans: [],
    numbers: [],
  },
  CompanyEntity: {
    table: "company_entities",
    columns: ["group_id", "entity_name", "document_number", "document_type", "entity_type", "status"],
    booleans: [],
    numbers: [],
  },
  Bank: {
    table: "banks",
    columns: ["bank_code", "bank_name", "bank_type", "status"],
    booleans: [],
    numbers: [],
  },
  LoanContract: {
    table: "loan_contracts",
    columns: [
      "group_id", "entity_id", "bank_id", "contract_number", "operation_category", "operation_type",
      "operation_value", "amount_foreign", "exchange_rate_closing", "signal_value", "iof_value",
      "iof_financed", "encargo_garantia_value", "encargo_garantia_financed", "other_fees",
      "other_fees_financed", "mip_value", "mip_embedded", "dfi_value",
      "dfi_embedded", "other_insurance_value", "other_insurance_embedded", "fixed_rate", "indexer",
      "indexer_spread", "currency_id", "exchange_lag", "exchange_rates", "operation_date",
      "first_payment_date", "total_term_months", "final_maturity_date", "principal_grace_months",
      "interest_grace_months", "grace_action", "grace_interest_behavior", "amortization_trigger",
      "principal_installments", "interest_installments", "principal_frequency", "interest_frequency",
      "calculation_system", "amortization_percentages", "percentage_base", "schedule_data",
      "contract_pdf_url", "status", "status_history", "approved_by", "approved_date",
      "rejection_comments", "exported_to_payables", "current_snapshot_id", "approved_snapshot_id",
      "last_recalculated_at",
    ],
    booleans: [
      "iof_financed", "encargo_garantia_financed", "other_fees_financed", "mip_embedded", "dfi_embedded",
      "other_insurance_embedded", "exported_to_payables",
    ],
    numbers: [
      "operation_value", "amount_foreign", "exchange_rate_closing", "signal_value", "iof_value",
      "encargo_garantia_value", "other_fees", "mip_value", "dfi_value", "other_insurance_value",
      "fixed_rate", "indexer_spread",
      "exchange_lag", "total_term_months", "principal_grace_months", "interest_grace_months",
      "principal_installments", "interest_installments",
    ],
  },
  CalculationSnapshot: {
    table: "calculation_snapshots",
    columns: [
      "contract_id", "contract_number", "engine_version", "engine_build_id",
      "calculation_hash_strict", "calculation_hash_instance", "schedule_snapshot",
      "disclosure_snapshot", "risk_flags_snapshot", "audit_log_snapshot", "currency",
      "principal", "total_interest", "total_paid", "trigger_event", "calculation_parameters",
      "metadata", "immutable_flag",
    ],
    booleans: ["immutable_flag"],
    numbers: ["principal", "total_interest", "total_paid"],
    immutable: true,
  },
  CDIRate: {
    table: "cdi_rates",
    columns: ["rate_date", "annual_rate", "daily_factor", "rate_type"],
    booleans: [],
    numbers: ["annual_rate", "daily_factor"],
  },
  Holiday: {
    table: "holidays",
    columns: ["holiday_date", "holiday_name", "day_of_week"],
    booleans: [],
    numbers: [],
  },
  Currency: {
    table: "currencies",
    columns: ["currency_code", "currency_name", "exchange_rate", "rate_date", "status"],
    booleans: [],
    numbers: ["exchange_rate"],
  },
  Tenant: {
    table: "tenants",
    columns: [
      "group_id", "tenant_name", "plan", "billing_status", "trial_ends_at",
      "contract_limit", "contracts_used", "owner_email", "metadata",
    ],
    booleans: [],
    numbers: ["contract_limit", "contracts_used"],
  },
  TenantUser: {
    table: "tenant_users",
    columns: [
      "tenant_id", "group_id", "user_email", "role", "permissions", "invited_by", "joined_at",
    ],
    booleans: [],
    numbers: [],
  },
};

export const SYSTEM_FIELDS = ["id", "created_date", "updated_date", "created_by", "extra_json"];

export function getEntity(name) {
  const entity = ENTITIES[name];
  if (!entity) {
    const err = new Error(`Entidade desconhecida: ${name}`);
    err.status = 404;
    throw err;
  }
  return entity;
}

export function allowedColumns(entity) {
  return new Set([...SYSTEM_FIELDS, ...entity.columns]);
}
