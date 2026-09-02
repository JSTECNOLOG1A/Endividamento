import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import { getTenantScope } from "../modules/tenants/access.js";
import {
  actionLabel,
  diffRecords,
  processingTypeFor,
  registroFrom,
  rotinaFor,
  sanitizeRecord,
} from "../modules/audit/format.js";

export async function writeAudit({
  req,
  action,
  resourceType,
  resourceId,
  rotina,
  processingType,
  registro,
  before,
  after,
  payload,
  origem,
} = {}) {
  try {
    const safeBefore = before ? sanitizeRecord(before) : null;
    const safeAfter = after ? sanitizeRecord(after) : null;
    const recordLabel = registro
      || registroFrom(resourceType, safeAfter || safeBefore, resourceId);
    const extra = payload ? sanitizeRecord(payload) : null;
    const auditPayload = getTenantScope()?.platformAdmin
      ? { ...(extra && typeof extra === "object" ? extra : {}), platform_admin: true, purpose: "suporte_operacional" }
      : extra;
    await pool.query(
      `INSERT INTO audit_events (
         request_id, actor_id, actor_email, actor_name, action, resource_type, resource_id,
         ip_address, user_agent, payload, processing_type, rotina, registro, before_json, after_json, group_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        req?.requestId || null,
        req?.user?.sub || null,
        req?.user?.email || (origem === "automatico" ? "sistema" : null),
        req?.user?.full_name || (origem === "automatico" ? "Sistema" : null),
        action,
        resourceType,
        resourceId || null,
        req?.ip || null,
        req?.headers?.["user-agent"] || null,
        auditPayload,
        processingTypeFor(action, processingType, origem),
        rotinaFor(resourceType, rotina),
        recordLabel,
        safeBefore,
        safeAfter,
        req?.user?.group_id || req?.tenant?.group_id || getTenantScope()?.groupId || null,
      ]
    );
  } catch (error) {
    logger.error({ err: error }, "falha ao gravar auditoria");
  }
}

export { actionLabel, diffRecords };
