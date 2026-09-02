import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { config } from "../../config.js";
import { getTenantScope, groupIdOrThrow, isPlatformAdmin, scopedGroupSql } from "../tenants/access.js";
import { assertCanCreateUser, assertCanWrite, assertTenantAdmin } from "../tenants/policy.js";
import { issueAccountToken } from "../account/tokens.js";
import { inviteEmail, sendMail } from "../signup/mailer.js";

export function publicInvitePayload(sent, inviteUrl) {
  const payload = { email_sent: Boolean(sent), invite_pending: true };
  if (!sent && config.env !== "production" && inviteUrl) {
    payload.invite_url = inviteUrl;
  }
  return payload;
}

function httpError(status, message, detailsOrCode) {
  const err = new Error(message);
  err.status = status;
  if (typeof detailsOrCode === "string") err.code = detailsOrCode;
  else if (detailsOrCode) err.details = detailsOrCode;
  return err;
}

const ROLES = ["admin", "user", "viewer"];

const optionalText = z.string().trim().max(255).optional().transform((value) => value || "");

export const createSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido").max(255),
  full_name: z.string().trim().min(2, "Informe o nome completo").max(255),
  cargo: optionalText,
  setor: optionalText,
  role: z.enum(ROLES),
  blocked: z.boolean().optional().default(false),
});

export const updateSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido").max(255).optional(),
  full_name: z.string().trim().min(2, "Informe o nome completo").max(255).optional(),
  cargo: optionalText,
  setor: optionalText,
  role: z.enum(ROLES).optional(),
  blocked: z.boolean().optional(),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres").max(128).optional(),
  password_confirm: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.password && data.password !== (data.password_confirm || "")) {
    ctx.addIssue({ code: "custom", path: ["password_confirm"], message: "As senhas não coincidem" });
  }
});

const USER_COLUMNS = `u.id, u.email, u.full_name, u.cargo, u.setor, u.role, u.status, u.blocked, u.blocked_at,
  u.last_login_at, u.created_date, u.updated_date, u.created_by`;
const USER_RETURNING = `id, email, full_name, cargo, setor, role, status, blocked, blocked_at,
  last_login_at, created_date, updated_date, created_by`;

function publicUser(row) {
  if (!row) return null;
  const blocked = row.blocked === true || row.status === "disabled";
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    cargo: row.cargo || "",
    setor: row.setor || "",
    role: row.role,
    blocked,
    blocked_at: blocked ? row.blocked_at : null,
    last_login_at: row.last_login_at,
    status: blocked ? "disabled" : "active",
    created_date: row.created_date,
    updated_date: row.updated_date,
    created_by: row.created_by,
    tenant_name: row.tenant_name || null,
    tenant_id: row.tenant_id || null,
    tenant_role: row.tenant_role || null,
    is_owner: row.tenant_role === "OWNER",
    invite_pending: Boolean(row.invite_pending),
  };
}

function blockedState(blocked, current = {}) {
  const nextBlocked = Boolean(blocked);
  return {
    blocked: nextBlocked,
    status: nextBlocked ? "disabled" : "active",
    blocked_at: nextBlocked
      ? (current.blocked && current.blocked_at ? current.blocked_at : new Date().toISOString())
      : null,
  };
}

async function countActiveAdmins(excludeId = null) {
  const groupId = groupIdOrThrow();
  const sql = excludeId
    ? `SELECT COUNT(*)::int AS n FROM users u
       JOIN tenant_users tu ON lower(tu.user_email) = lower(u.email)
       WHERE tu.group_id = $1 AND u.role = 'admin' AND u.status = 'active' AND u.blocked IS NOT TRUE AND u.id <> $2`
    : `SELECT COUNT(*)::int AS n FROM users u
       JOIN tenant_users tu ON lower(tu.user_email) = lower(u.email)
       WHERE tu.group_id = $1 AND u.role = 'admin' AND u.status = 'active' AND u.blocked IS NOT TRUE`;
  const result = excludeId
    ? await pool.query(sql, [groupId, excludeId])
    : await pool.query(sql, [groupId]);
  return result.rows[0]?.n || 0;
}

export async function list() {
  const scope = scopedGroupSql("tu.group_id");
  const result = await pool.query(
    `SELECT ${USER_COLUMNS}, t.id AS tenant_id, t.tenant_name, tu.role AS tenant_role,
            EXISTS (
              SELECT 1 FROM account_tokens at
              WHERE at.user_id = u.id AND at.kind = 'invite'
                AND at.consumed_at IS NULL AND at.expires_at > now()
            ) AS invite_pending
     FROM users u
     JOIN tenant_users tu ON lower(tu.user_email) = lower(u.email)
     JOIN tenants t ON t.id = tu.tenant_id
     WHERE ${scope.sql} AND u.platform_admin IS NOT TRUE
     ORDER BY t.tenant_name ASC, u.full_name ASC, u.email ASC`,
    scope.params
  );
  return result.rows.map(publicUser);
}

export async function getById(id) {
  const scope = scopedGroupSql("tu.group_id", 2);
  const result = await pool.query(
    `SELECT ${USER_COLUMNS}, t.id AS tenant_id, t.tenant_name, tu.role AS tenant_role,
            EXISTS (
              SELECT 1 FROM account_tokens at
              WHERE at.user_id = u.id AND at.kind = 'invite'
                AND at.consumed_at IS NULL AND at.expires_at > now()
            ) AS invite_pending
     FROM users u
     JOIN tenant_users tu ON lower(tu.user_email) = lower(u.email)
     JOIN tenants t ON t.id = tu.tenant_id
     WHERE u.id = $1 AND ${scope.sql} AND u.platform_admin IS NOT TRUE`,
    [id, ...scope.params]
  );
  const user = publicUser(result.rows[0]);
  if (!user) throw httpError(404, "Usuário não encontrado");
  return user;
}

export async function create(data, createdBy) {
  await assertCanCreateUser();
  if (isPlatformAdmin() && !getTenantScope()?.groupId) {
    throw httpError(400, "Selecione o cliente para cadastrar o usuário");
  }
  const email = data.email.toLowerCase();
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows[0]) throw httpError(409, "Já existe um usuário com este e-mail");

  const hash = await bcrypt.hash(randomBytes(24).toString("hex"), config.bcryptRounds);
  const block = blockedState(data.blocked);
  const groupId = groupIdOrThrow();
  const members = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tenant_users WHERE group_id = $1`,
    [groupId]
  );
  const firstUser = (members.rows[0]?.n || 0) === 0;
  const role = firstUser ? "admin" : data.role;
  const tenantRole = firstUser ? "OWNER" : (data.role === "viewer" ? "VIEWER" : "ADMIN");
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO users (
       id, email, password_hash, full_name, cargo, setor, role, status, blocked, blocked_at, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${USER_RETURNING}`,
    [
      id,
      email,
      hash,
      data.full_name,
      data.cargo || "",
      data.setor || "",
      role,
      block.status,
      block.blocked,
      block.blocked_at,
      createdBy || "system",
    ]
  );
  const scope = getTenantScope();
  await pool.query(
    `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, joined_at, created_by)
     VALUES ($1, $2, $3, $4, $5, now(), $6)`,
    [
      `tuser_${id.replaceAll("-", "").slice(0, 12)}`,
      scope?.tenantId,
      groupId,
      email,
      tenantRole,
      createdBy || email,
    ]
  );
  const user = publicUser({
    ...result.rows[0],
    tenant_role: tenantRole,
    tenant_id: scope?.tenantId,
    invite_pending: true,
  });
  return { ...user, ...(await sendInvite({ userId: id, email, fullName: data.full_name, createdBy })) };
}

async function sendInvite({ userId, email, fullName, createdBy }) {
  const token = await issueAccountToken({ kind: "invite", userId, createdBy });
  const inviteUrl = `${config.appPublicUrl.replace(/\/$/, "")}/aceitar-convite?token=${token.raw}`;
  const mail = inviteEmail({ fullName, inviteUrl, invitedBy: createdBy });
  const sent = await sendMail({ to: email, ...mail });
  return publicInvitePayload(sent.sent, inviteUrl);
}

export async function resendInvite(id, createdBy) {
  await assertTenantAdmin();
  const user = await getById(id);
  if (user.blocked) throw httpError(409, "Usuário bloqueado não pode receber convite");
  return { ...user, ...(await sendInvite({ userId: user.id, email: user.email, fullName: user.full_name, createdBy })) };
}

export async function update(id, data, actorId) {
  await assertCanWrite();
  const current = await getById(id);
  if (current.is_owner) {
    if (data.role && data.role !== "admin") {
      throw httpError(409, "O primeiro usuário do cliente tem acesso total e não pode ser rebaixado", "OWNER_LOCKED");
    }
    if (data.blocked === true) {
      throw httpError(409, "O primeiro usuário do cliente não pode ser bloqueado", "OWNER_LOCKED");
    }
  }
  const nextBlocked = data.blocked != null ? Boolean(data.blocked) : current.blocked;
  const block = blockedState(nextBlocked, current);
  const next = {
    email: data.email != null ? data.email.toLowerCase() : current.email,
    full_name: data.full_name ?? current.full_name,
    cargo: data.cargo != null ? data.cargo : current.cargo,
    setor: data.setor != null ? data.setor : current.setor,
    role: data.role ?? current.role,
    ...block,
  };

  const demotingAdmin = current.role === "admin" && !current.blocked
    && (next.role !== "admin" || next.blocked);
  if (demotingAdmin && (await countActiveAdmins(id)) < 1) {
    throw httpError(409, "Não é possível bloquear ou rebaixar o último administrador ativo");
  }
  if (actorId && String(actorId) === String(id) && next.blocked) {
    throw httpError(409, "Você não pode bloquear o próprio usuário");
  }

  if (next.email !== current.email) {
    const clash = await pool.query(`SELECT id FROM users WHERE email = $1 AND id <> $2`, [next.email, id]);
    if (clash.rows[0]) throw httpError(409, "Já existe um usuário com este e-mail");
  }

  const assignments = [
    "email = $1",
    "full_name = $2",
    "cargo = $3",
    "setor = $4",
    "role = $5",
    "status = $6",
    "blocked = $7",
    "blocked_at = $8",
    "updated_date = now()",
  ];
  const params = [
    next.email,
    next.full_name,
    next.cargo || "",
    next.setor || "",
    next.role,
    next.status,
    next.blocked,
    next.blocked_at,
  ];
  if (data.password) {
    assignments.push(`password_hash = $${params.length + 1}`);
    params.push(await bcrypt.hash(data.password, config.bcryptRounds));
  }
  params.push(id);

  const result = await pool.query(
    `UPDATE users SET ${assignments.join(", ")}
     WHERE id = $${params.length}
     RETURNING ${USER_RETURNING}`,
    params
  );
  if (next.email !== current.email) {
    await pool.query(
      `UPDATE tenant_users SET user_email = $1, updated_date = now()
       WHERE lower(user_email) = lower($2) AND group_id = $3`,
      [next.email, current.email, groupIdOrThrow()]
    );
  }
  return publicUser({
    ...result.rows[0],
    tenant_role: current.tenant_role,
    tenant_id: current.tenant_id,
    tenant_name: current.tenant_name,
  });
}
