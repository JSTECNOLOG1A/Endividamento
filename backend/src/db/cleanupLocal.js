import bcrypt from "bcryptjs";
import { pool } from "./pool.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const DELETE_ORDER = [
  "scheduled_job_runs",
  "scheduled_jobs",
  "accounting_journal_entries",
  "accounting_event_mappings",
  "contract_settlements",
  "accounting_closings",
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

async function tableExists(name) {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return Boolean(result.rows[0]);
}

async function deleteOrphanGroups() {
  const orphans = await pool.query(
    `SELECT g.id, g.group_name
     FROM groups g
     WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.group_id = g.id)`
  );
  if (!orphans.rows.length) {
    logger.info("nenhum grupo órfão");
    return [];
  }
  for (const group of orphans.rows) {
    logger.info({ id: group.id, name: group.group_name }, "removendo grupo sem tenant");
    await pool.query("BEGIN");
    try {
      await pool.query("ALTER TABLE audit_events DISABLE TRIGGER ALL");
      await pool.query("ALTER TABLE calculation_snapshots DISABLE TRIGGER ALL");
      for (const table of DELETE_ORDER) {
        if (!(await tableExists(table))) continue;
        await pool.query(`DELETE FROM ${table} WHERE group_id = $1`, [group.id]);
      }
      await pool.query("DELETE FROM groups WHERE id = $1", [group.id]);
      await pool.query("ALTER TABLE calculation_snapshots ENABLE TRIGGER ALL");
      await pool.query("ALTER TABLE audit_events ENABLE TRIGGER ALL");
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
  return orphans.rows;
}

async function resetMasterPassword() {
  const hash = await bcrypt.hash(config.adminPassword, config.bcryptRounds);
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1, updated_date = now()
     WHERE platform_admin IS TRUE
     RETURNING email`,
    [hash]
  );
  return result.rows.map((row) => row.email);
}

async function main() {
  const removed = await deleteOrphanGroups();
  const masters = await resetMasterPassword();
  logger.info({
    removed_groups: removed.map((row) => ({ id: row.id, name: row.group_name })),
    master_emails: masters,
    master_password_source: "ADMIN_PASSWORD",
  }, "limpeza local concluída");
  await pool.end();
}

main().catch(async (error) => {
  logger.error(error, "falha na limpeza local");
  await pool.end();
  process.exit(1);
});
