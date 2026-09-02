export const ENTITIES = {
  Group: {
    table: "groups",
    columns: ["group_name", "cnpj_group", "description", "status"],
    booleans: [],
    numbers: [],
  },
  CompanyEntity: {
    table: "company_entities",
    columns: [
      "group_id", "entity_name", "document_number", "document_type", "entity_type", "codigo_empresa", "codigo_filial", "status",
      "accounting_mode", "payment_source", "posting_approval",
    ],
    booleans: [],
    numbers: [],
  },
  Bank: {
    table: "banks",
    columns: ["group_id", "bank_code", "bank_name", "bank_type", "status"],
    booleans: [],
    numbers: [],
  },
  BankAccount: {
    table: "bank_accounts",
    columns: [
      "group_id", "entity_id", "bank_id", "empresa", "filial", "bank_code", "agencia", "conta",
      "digito", "nome", "tipo", "moeda", "conta_contabil", "natureza", "origem", "status",
    ],
    booleans: [],
    numbers: [],
  },
  Nature: {
    table: "natures",
    columns: ["group_id", "entity_id", "empresa", "filial", "codigo", "descricao", "tipo_conta", "c_custo", "c_des_fat", "tipo_natureza", "gera_lcdpr", "origem", "status"],
    booleans: ["gera_lcdpr"],
    numbers: [],
  },
  ChartOfAccount: {
    table: "chart_of_accounts",
    columns: ["group_id", "account_code", "account_name", "account_class", "account_type", "account_nature", "origem", "status"],
    booleans: [],
    numbers: [],
  },
  PayableTitle: {
    table: "payable_titles",
    columns: [
      "group_id", "entity_id", "contract_id", "parcela", "titulo_numero", "tipo", "prefixo",
      "emissao", "vencimento", "valor", "saldo", "natureza", "historico", "status", "origem",
      "fornecedor", "fornecedor_loja", "fornecedor_nome", "filial", "filial_origem",
      "integrado_erp", "integrado_erp_em", "erp_mensagem", "erp_status", "erp_consultado_em",
      "converted_pr_tx_em",
    ],
    booleans: ["integrado_erp"],
    numbers: ["valor", "saldo"],
  },
  ReceivableTitle: {
    table: "receivable_titles",
    columns: [
      "group_id", "entity_id", "contract_id", "parcela", "titulo_numero", "tipo", "prefixo",
      "emissao", "vencimento", "valor", "saldo", "natureza", "historico", "status", "origem",
      "cliente", "cliente_loja", "cliente_nome", "filial", "filial_origem",
      "integrado_erp", "integrado_erp_em", "erp_mensagem", "erp_status", "erp_consultado_em",
    ],
    booleans: ["integrado_erp"],
    numbers: ["valor", "saldo"],
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
      "rejection_comments", "exported_to_payables", "exported_to_receivables",
      "reopen_requested_by", "reopen_requested_at",
      "current_snapshot_id", "approved_snapshot_id",
      "last_recalculated_at", "guarantee_real_type", "guarantee_personal_type",
    ],
    booleans: [
      "iof_financed", "encargo_garantia_financed", "other_fees_financed", "mip_embedded", "dfi_embedded",
      "other_insurance_embedded", "exported_to_payables", "exported_to_receivables",
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
      "group_id", "contract_id", "contract_number", "engine_version", "engine_build_id",
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
    columns: ["group_id", "rate_date", "annual_rate", "daily_factor", "rate_type"],
    booleans: [],
    numbers: ["annual_rate", "daily_factor"],
  },
  Holiday: {
    table: "holidays",
    columns: ["group_id", "holiday_date", "holiday_name", "day_of_week"],
    booleans: [],
    numbers: [],
  },
  Currency: {
    table: "currencies",
    columns: ["group_id", "currency_code", "currency_name", "exchange_rate", "rate_date", "status"],
    booleans: [],
    numbers: ["exchange_rate"],
  },
  AccountingClosing: {
    table: "accounting_closings",
    columns: [
      "group_id", "entity_id", "competencia", "data_base", "previous_closing_id", "status",
      "opening_snapshot", "events_snapshot", "journal_snapshot", "engine_version",
      "total_debito", "total_credito", "calculated_by", "calculated_at",
      "approved_by", "approved_at", "reopened_by", "reopened_at", "reopened_reason",
    ],
    booleans: [],
    numbers: ["total_debito", "total_credito"],
  },
  ContractSettlement: {
    table: "contract_settlements",
    columns: [
      "group_id", "contract_id", "closing_id", "parcela", "scheduled_date", "actual_payment_date", "scheduled_amount",
      "principal_paid", "interest_paid", "penalty_paid", "fee_paid", "discount_amount",
      "rounding_adjustment", "other_amount", "total_paid", "bank_account_id",
      "extraordinary_amortization", "triggers_recalculation", "recalculation_snapshot_id",
      "proof_url", "observacao", "status",
    ],
    booleans: ["extraordinary_amortization", "triggers_recalculation"],
    numbers: [
      "scheduled_amount", "principal_paid", "interest_paid", "penalty_paid", "fee_paid",
      "discount_amount", "rounding_adjustment", "other_amount", "total_paid",
    ],
  },
  AccountMovement: {
    table: "account_movements",
    columns: ["group_id", "contract_id", "movement_date", "movement_type", "amount", "observacao"],
    booleans: [],
    numbers: ["amount"],
  },
  AccountingEventMapping: {
    table: "accounting_event_mappings",
    columns: ["group_id", "entity_id", "event_type", "operation_category", "debit_account_id", "credit_account_id", "status"],
    booleans: [],
    numbers: [],
  },
  AccountingJournalEntry: {
    table: "accounting_journal_entries",
    columns: [
      "group_id", "closing_id", "contract_id", "event_type", "entry_date",
      "account_id", "side", "amount", "historico",
    ],
    booleans: [],
    numbers: ["amount"],
  },
  NotificationLog: {
    table: "notification_log",
    columns: ["group_id", "event_type", "contract_id", "to_email", "subject", "body", "status", "error_message"],
    booleans: [],
    numbers: [],
  },
  Tenant: {
    table: "tenants",
    columns: [
      "group_id", "tenant_name", "plan", "billing_status", "trial_ends_at",
      "contract_limit", "contracts_used", "owner_email", "domain", "metadata",
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
