// Ordem de exclusão dos dados de um grupo na limpeza do ambiente local (cleanupLocal.js): dependentes antes das
// tabelas para as quais apontam. Separado do script para ser conferido em teste sem executar a limpeza.
export const DELETE_ORDER = [
  "scheduled_job_runs",
  "scheduled_jobs",
  "accounting_journal_entries",
  "accounting_event_mappings",
  "contract_settlements",
  "accounting_closings",
  // Gestão Tributária: dos dependentes para o parcelamento (o parcelamento aponta para a empresa).
  "tax_guide_sends",
  "tax_payable_titles",
  "tax_installment_guides",
  "tax_installments",
  "tax_agreements",
  "payable_titles",
  "receivable_titles",
  "calculation_snapshots",
  "loan_contracts",
  "natures",
  "bank_accounts",
  "chart_of_accounts",
  "integrations",
  "company_entities",
  "tenant_users",
  "tenants",
  "audit_events",
];
