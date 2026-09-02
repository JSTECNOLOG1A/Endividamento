import { createHash, randomBytes } from "node:crypto";
import { pool } from "../../db/pool.js";

const TTL = {
  password_reset: 2 * 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
};

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export function hashToken(raw) {
  return createHash("sha256").update(String(raw || "")).digest("hex");
}

export function newRawToken() {
  return randomBytes(32).toString("hex");
}

export async function issueAccountToken({ kind, userId, createdBy }) {
  const raw = newRawToken();
  const expiresAt = new Date(Date.now() + (TTL[kind] || TTL.password_reset));
  await pool.query(
    `UPDATE account_tokens SET consumed_at = now()
     WHERE user_id = $1 AND kind = $2 AND consumed_at IS NULL`,
    [userId, kind]
  );
  await pool.query(
    `INSERT INTO account_tokens (kind, user_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [kind, userId, hashToken(raw), expiresAt.toISOString(), createdBy || null]
  );
  return { raw, expiresAt };
}

export async function loadAccountToken(rawToken) {
  const result = await pool.query(
    `SELECT t.id, t.kind, t.user_id, t.expires_at, t.consumed_at,
            u.email, u.full_name, u.status, u.blocked
     FROM account_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1`,
    [hashToken(rawToken)]
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, "Link inválido ou expirado", "TOKEN_NOT_FOUND");
  if (row.consumed_at) throw httpError(409, "Este link já foi usado", "TOKEN_CONSUMED");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw httpError(410, "Este link expirou. Solicite outro.", "TOKEN_EXPIRED");
  }
  if (row.blocked === true || row.status === "disabled") {
    throw httpError(403, "Usuário bloqueado", "USER_BLOCKED");
  }
  return row;
}

export async function consumeAccountToken(tokenId) {
  await pool.query(
    `UPDATE account_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
    [tokenId]
  );
}

export async function hasOpenInvite(userId) {
  const result = await pool.query(
    `SELECT 1 FROM account_tokens
     WHERE user_id = $1 AND kind = 'invite' AND consumed_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [userId]
  );
  return Boolean(result.rows[0]);
}
