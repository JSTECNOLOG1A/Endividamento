import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.join(__dirname, "data");
export const uploadsDir = path.join(__dirname, "uploads");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const dbPath = path.join(dataDir, "endividamento.sqlite");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  cnpj_group TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS company_entities (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  entity_name TEXT NOT NULL,
  document_number TEXT NOT NULL,
  document_type TEXT NOT NULL,
  entity_type TEXT,
  status TEXT NOT NULL DEFAULT 'ativa',
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS banks (
  id TEXT PRIMARY KEY,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_type TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS loan_contracts (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES groups(id),
  entity_id TEXT REFERENCES company_entities(id),
  bank_id TEXT REFERENCES banks(id),
  contract_number TEXT,
  operation_category TEXT,
  operation_type TEXT,
  operation_value REAL,
  amount_foreign REAL,
  exchange_rate_closing REAL,
  signal_value REAL,
  iof_value REAL,
  iof_financed INTEGER DEFAULT 0,
  other_fees REAL,
  other_fees_financed INTEGER DEFAULT 0,
  mip_value REAL,
  mip_embedded INTEGER DEFAULT 0,
  dfi_value REAL,
  dfi_embedded INTEGER DEFAULT 0,
  other_insurance_value REAL,
  other_insurance_embedded INTEGER DEFAULT 0,
  fixed_rate REAL,
  indexer TEXT,
  indexer_spread REAL,
  currency_id TEXT,
  exchange_lag INTEGER DEFAULT 1,
  exchange_rates TEXT,
  operation_date TEXT,
  first_payment_date TEXT,
  total_term_months REAL,
  final_maturity_date TEXT,
  principal_grace_months REAL,
  interest_grace_months REAL,
  grace_action TEXT,
  grace_interest_behavior TEXT,
  amortization_trigger TEXT,
  principal_installments REAL,
  interest_installments REAL,
  principal_frequency TEXT,
  interest_frequency TEXT,
  calculation_system TEXT,
  amortization_percentages TEXT,
  percentage_base TEXT DEFAULT 'saldo_devedor',
  schedule_data TEXT,
  contract_pdf_url TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho',
  status_history TEXT,
  approved_by TEXT,
  approved_date TEXT,
  rejection_comments TEXT,
  exported_to_payables INTEGER DEFAULT 0,
  current_snapshot_id TEXT,
  approved_snapshot_id TEXT,
  last_recalculated_at TEXT,
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS calculation_snapshots (
  id TEXT PRIMARY KEY,
  contract_id TEXT REFERENCES loan_contracts(id),
  contract_number TEXT,
  engine_version TEXT,
  engine_build_id TEXT,
  calculation_hash_strict TEXT,
  calculation_hash_instance TEXT,
  schedule_snapshot TEXT,
  disclosure_snapshot TEXT,
  risk_flags_snapshot TEXT,
  audit_log_snapshot TEXT,
  currency TEXT,
  principal REAL,
  total_interest REAL,
  total_paid REAL,
  trigger_event TEXT,
  calculation_parameters TEXT,
  metadata TEXT,
  immutable_flag INTEGER DEFAULT 1,
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS cdi_rates (
  id TEXT PRIMARY KEY,
  rate_date TEXT NOT NULL,
  annual_rate REAL NOT NULL,
  daily_factor REAL,
  rate_type TEXT NOT NULL,
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(rate_date, rate_type)
);

CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY,
  holiday_date TEXT NOT NULL,
  holiday_name TEXT NOT NULL,
  day_of_week TEXT,
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS currencies (
  id TEXT PRIMARY KEY,
  currency_code TEXT NOT NULL,
  currency_name TEXT NOT NULL,
  exchange_rate REAL,
  rate_date TEXT,
  status TEXT NOT NULL DEFAULT 'ativa',
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  tenant_name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'STARTER',
  billing_status TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TEXT,
  contract_limit REAL,
  contracts_used REAL DEFAULT 0,
  owner_email TEXT,
  metadata TEXT,
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS tenant_users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'VIEWER',
  permissions TEXT,
  invited_by TEXT,
  joined_at TEXT,
  extra_json TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_company_entities_group ON company_entities(group_id);
CREATE INDEX IF NOT EXISTS idx_loan_contracts_group ON loan_contracts(group_id);
CREATE INDEX IF NOT EXISTS idx_loan_contracts_status ON loan_contracts(status);
CREATE INDEX IF NOT EXISTS idx_snapshots_contract ON calculation_snapshots(contract_id);
CREATE INDEX IF NOT EXISTS idx_cdi_rates_type_date ON cdi_rates(rate_type, rate_date);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_currencies_code_date ON currencies(currency_code, rate_date);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM groups").get().n;
  if (count > 0) return;

  const now = nowIso();
  const createdBy = "admin@local";

  const groupId = "grp_demo";
  const entityId = "ent_demo";
  const tenantId = "tnt_demo";

  const insertGroup = db.prepare(`
    INSERT INTO groups (id, group_name, cnpj_group, description, status, created_date, updated_date, created_by)
    VALUES (?, ?, ?, ?, 'ativo', ?, ?, ?)
  `);
  const insertEntity = db.prepare(`
    INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, status, created_date, updated_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'ativa', ?, ?, ?)
  `);
  const insertBank = db.prepare(`
    INSERT INTO banks (id, bank_code, bank_name, bank_type, status, created_date, updated_date, created_by)
    VALUES (?, ?, ?, ?, 'ativo', ?, ?, ?)
  `);
  const insertCurrency = db.prepare(`
    INSERT INTO currencies (id, currency_code, currency_name, exchange_rate, rate_date, status, created_date, updated_date, created_by)
    VALUES (?, ?, ?, ?, ?, 'ativa', ?, ?, ?)
  `);
  const insertTenant = db.prepare(`
    INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, trial_ends_at, contract_limit, contracts_used, owner_email, created_date, updated_date, created_by)
    VALUES (?, ?, ?, 'ENTERPRISE', 'active', ?, 999999, 0, ?, ?, ?, ?)
  `);
  const insertTenantUser = db.prepare(`
    INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, joined_at, created_date, updated_date, created_by)
    VALUES (?, ?, ?, ?, 'OWNER', ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertGroup.run(groupId, "Grupo Demo", "00.000.000/0001-00", "Grupo econômico local de desenvolvimento", now, now, createdBy);
    insertEntity.run(entityId, groupId, "Empresa Demo Ltda", "00.000.000/0001-00", "CNPJ", "empresa", now, now, createdBy);
    insertBank.run("bank_001", "001", "Banco do Brasil", "publico", now, now, createdBy);
    insertBank.run("bank_341", "341", "Itaú Unibanco", "privado", now, now, createdBy);
    insertBank.run("bank_237", "237", "Bradesco", "privado", now, now, createdBy);
    insertCurrency.run("cur_brl", "BRL", "Real Brasileiro", 1, now.slice(0, 10), now, now, createdBy);
    insertCurrency.run("cur_usd", "USD", "Dólar Americano", 5.5, now.slice(0, 10), now, now, createdBy);
    insertTenant.run(tenantId, groupId, "Tenant Local", "2099-12-31", createdBy, now, now, createdBy);
    insertTenantUser.run("tuser_admin", tenantId, groupId, createdBy, now, now, now, createdBy);
  });

  tx();
  console.log("[db] Seed inicial aplicado:", dbPath);
}

seedIfEmpty();
console.log("[db] SQLite:", dbPath);
