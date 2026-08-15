import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pool } from "./pool.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export async function seed() {
  const users = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (users.rows[0].n === 0) {
    const hash = await bcrypt.hash(config.adminPassword, config.bcryptRounds);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, created_by)
       VALUES ($1, $2, $3, $4, 'admin', 'active', 'system')`,
      [randomUUID(), config.adminEmail.toLowerCase(), hash, "Administrador"]
    );
    logger.info({ email: config.adminEmail }, "usuário admin criado");
  }

  const groups = await pool.query("SELECT COUNT(*)::int AS n FROM groups");
  if (groups.rows[0].n > 0) return;

  const now = new Date().toISOString();
  const createdBy = config.adminEmail;
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO groups (id, group_name, cnpj_group, description, status, created_date, updated_date, created_by)
       VALUES ('grp_demo', 'Grupo Demo', '00.000.000/0001-00', 'Grupo econômico local', 'ativo', $1, $1, $2)`,
      [now, createdBy]
    );
    await pool.query(
      `INSERT INTO company_entities (id, group_id, entity_name, document_number, document_type, entity_type, status, created_date, updated_date, created_by)
       VALUES ('ent_demo', 'grp_demo', 'Empresa Demo Ltda', '00.000.000/0001-00', 'CNPJ', 'empresa', 'ativa', $1, $1, $2)`,
      [now, createdBy]
    );
    await pool.query(
      `INSERT INTO banks (id, bank_code, bank_name, bank_type, status, created_date, updated_date, created_by) VALUES
       ('bank_001', '001', 'Banco do Brasil', 'publico', 'ativo', $1, $1, $2),
       ('bank_341', '341', 'Itaú Unibanco', 'privado', 'ativo', $1, $1, $2),
       ('bank_237', '237', 'Bradesco', 'privado', 'ativo', $1, $1, $2)`,
      [now, createdBy]
    );
    await pool.query(
      `INSERT INTO currencies (id, currency_code, currency_name, exchange_rate, rate_date, status, created_date, updated_date, created_by) VALUES
       ('cur_brl', 'BRL', 'Real Brasileiro', 1, CURRENT_DATE, 'ativa', $1, $1, $2),
       ('cur_usd', 'USD', 'Dólar Americano', 5.5, CURRENT_DATE, 'ativa', $1, $1, $2),
       ('cur_eur', 'EUR', 'Euro', 6.1, CURRENT_DATE, 'ativa', $1, $1, $2)`,
      [now, createdBy]
    );
    await pool.query(
      `INSERT INTO tenants (id, group_id, tenant_name, plan, billing_status, trial_ends_at, contract_limit, contracts_used, owner_email, created_date, updated_date, created_by)
       VALUES ('tnt_demo', 'grp_demo', 'Tenant Local', 'ENTERPRISE', 'active', '2099-12-31', 999999, 0, $2, $1, $1, $2)`,
      [now, createdBy]
    );
    await pool.query(
      `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, joined_at, created_date, updated_date, created_by)
       VALUES ('tuser_admin', 'tnt_demo', 'grp_demo', $2, 'OWNER', $1, $1, $1, $2)`,
      [now, createdBy]
    );
    await pool.query("COMMIT");
    logger.info("seed de governança aplicado");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}
