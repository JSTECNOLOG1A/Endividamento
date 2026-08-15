import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const applied = await pool.query("SELECT id FROM schema_migrations");
  const done = new Set(applied.rows.map((row) => row.id));

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    logger.info({ file }, "aplicando migração");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate.js")) {
  migrate()
    .then(() => {
      logger.info("migrações concluídas");
      return pool.end();
    })
    .catch((error) => {
      logger.error(error, "falha nas migrações");
      process.exit(1);
    });
}
