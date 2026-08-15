import { pool } from "../db/pool.js";
import { logger } from "../logger.js";

export async function writeAudit({ req, action, resourceType, resourceId, payload }) {
  try {
    await pool.query(
      `INSERT INTO audit_events
        (request_id, actor_id, actor_email, action, resource_type, resource_id, ip_address, user_agent, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.requestId || null,
        req.user?.sub || null,
        req.user?.email || null,
        action,
        resourceType,
        resourceId || null,
        req.ip || null,
        req.headers["user-agent"] || null,
        payload ? JSON.stringify(payload) : null,
      ]
    );
  } catch (error) {
    logger.error({ err: error }, "falha ao gravar auditoria");
  }
}
