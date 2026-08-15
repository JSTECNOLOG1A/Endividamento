import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireRole } from "../../middleware/auth.js";

export const auditRouter = Router();

auditRouter.get("/", requireRole("admin"), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const result = await pool.query(
      `SELECT id, occurred_at, request_id, actor_email, action, resource_type, resource_id, ip_address
       FROM audit_events
       ORDER BY occurred_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});
