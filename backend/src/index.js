import { config } from "./config.js";
import { logger } from "./logger.js";
import { migrate } from "./db/migrate.js";
import { seed } from "./db/seed.js";
import { createApp } from "./app.js";
import { pool } from "./db/pool.js";
import { startScheduler, stopScheduler } from "./modules/schedules/runner.js";

async function main() {
  await migrate();
  await seed();
  const app = createApp();
  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info({ port: config.port }, "API iniciada");
  });
  startScheduler();
  const shutdown = async () => {
    stopScheduler();
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  logger.fatal(error, "falha ao iniciar API");
  process.exit(1);
});
