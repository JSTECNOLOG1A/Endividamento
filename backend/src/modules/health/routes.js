import { Router } from "express";
import { pool } from "../../db/pool.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "endividamento-api",
    engine: "postgresql",
    time: new Date().toISOString(),
  });
});

healthRouter.get("/ready", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "up" });
  } catch (error) {
    error.status = 503;
    next(error);
  }
});
