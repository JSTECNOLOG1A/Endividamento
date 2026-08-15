import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL é obrigatório");
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function query(text, params = []) {
  return pool.query(text, params);
}
