import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { loadTenantForEmail } from "../tenants/access.js";
import { issueAuthResponse } from "../auth/token.js";
import { digitsOnly, formatCnpj, isValidCnpj, lookupCnpj, publicCompany } from "./cnpj.js";
import { confirmationEmail, sendMail } from "./mailer.js";

const SIGNUP_TTL_MS = 48 * 60 * 60 * 1000;

function httpError(status, message, code, details) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  if (details) err.details = details;
  return err;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function newIds(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function normalizeDomain(value) {
  let domain = String(value || "").trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.split("/")[0].split(":")[0].replace(/\.$/, "");
  return domain;
}

function isValidDomain(domain) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain);
}

const companySchema = z.object({
  cnpj: z.string().min(14),
  razao_social: z.string().trim().max(255).optional().default(""),
  nome_fantasia: z.string().trim().max(255).optional().default(""),
  situacao: z.string().trim().max(80).optional().default(""),
  data_abertura: z.string().trim().max(40).optional().default(""),
  natureza_juridica: z.string().trim().max(255).optional().default(""),
  porte: z.string().trim().max(80).optional().default(""),
  capital_social: z.union([z.string(), z.number()]).optional().default(""),
  cnae: z.string().trim().max(255).optional().default(""),
  cnae_codigo: z.string().trim().max(40).optional().default(""),
  logradouro: z.string().trim().max(255).optional().default(""),
  numero: z.string().trim().max(40).optional().default(""),
  complemento: z.string().trim().max(255).optional().default(""),
  bairro: z.string().trim().max(120).optional().default(""),
  municipio: z.string().trim().max(120).optional().default(""),
  uf: z.string().trim().max(2).optional().default(""),
  cep: z.string().trim().max(16).optional().default(""),
  telefone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(255).optional().default(""),
  endereco: z.string().trim().max(500).optional().default(""),
}).passthrough();

export const signupSchema = z.object({
  full_name: z.string().trim().min(2, "Informe o nome completo").max(255),
  email: z.string().trim().email("Informe um e-mail válido").max(255),
  company_name: z.string().trim().min(2, "Informe a empresa principal").max(255),
  domain: z.string().trim().min(3, "Informe o domínio da empresa").max(255),
  cnpj: z.string().min(14, "Informe um CNPJ válido"),
  company: companySchema.optional(),
});

export const passwordSchema = z.object({
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres").max(128),
  password_confirm: z.string().min(1, "Confirme a senha"),
}).superRefine((data, ctx) => {
  if (data.password !== data.password_confirm) {
    ctx.addIssue({ code: "custom", path: ["password_confirm"], message: "As senhas não coincidem" });
  }
});

async function domainTaken(domain, client = pool) {
  const tenant = await client.query(
    `SELECT id FROM tenants WHERE lower(btrim(COALESCE(domain, ''))) = $1`,
    [domain]
  );
  if (tenant.rows[0]) return true;
  const group = await client.query(
    `SELECT id FROM groups
     WHERE lower(btrim(COALESCE(extra_json->>'domain', ''))) = $1`,
    [domain]
  );
  return Boolean(group.rows[0]);
}

function mapSignupUnique(error) {
  const constraint = String(error.constraint || error.detail || "");
  if (constraint.includes("domain")) {
    return httpError(409, "Este domínio já está cadastrado", "DOMAIN_TAKEN");
  }
  if (constraint.includes("email") || constraint.includes("users")) {
    return httpError(409, "Já existe uma conta com este e-mail", "EMAIL_TAKEN");
  }
  if (constraint.includes("cnpj")) {
    return httpError(409, "Este CNPJ já possui uma conta no sistema", "CNPJ_TAKEN");
  }
  return httpError(409, "Já existe uma conta com estes dados", "CONFLICT");
}

async function assertAvailable({ email, domain, cnpj, excludeSignupId }, client = pool) {
  const user = await client.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  if (user.rows[0]) throw httpError(409, "Já existe uma conta com este e-mail", "EMAIL_TAKEN");

  if (await domainTaken(domain, client)) {
    throw httpError(409, "Este domínio já está cadastrado", "DOMAIN_TAKEN");
  }

  const entity = await client.query(
    `SELECT id FROM company_entities
     WHERE document_type = 'CNPJ'
       AND regexp_replace(document_number, '[^0-9]', '', 'g') = $1`,
    [cnpj]
  );
  if (entity.rows[0]) throw httpError(409, "Este CNPJ já possui uma conta no sistema", "CNPJ_TAKEN");

  const group = await client.query(
    `SELECT id FROM groups
     WHERE regexp_replace(COALESCE(cnpj_group, ''), '[^0-9]', '', 'g') = $1`,
    [cnpj]
  );
  if (group.rows[0]) throw httpError(409, "Este CNPJ já possui uma conta no sistema", "CNPJ_TAKEN");

  const pending = await client.query(
    `SELECT id, email, domain, cnpj FROM tenant_signups
     WHERE consumed_at IS NULL
       AND (
         lower(email) = lower($1)
         OR lower(domain) = $2
         OR cnpj = $3
       )
       AND ($4::uuid IS NULL OR id <> $4)`,
    [email, domain, cnpj, excludeSignupId || null]
  );
  const clash = pending.rows[0];
  if (clash) {
    if (clash.cnpj === cnpj) throw httpError(409, "Já existe um cadastro em andamento para este CNPJ", "CNPJ_PENDING");
    if (clash.domain === domain) throw httpError(409, "Este domínio já está cadastrado", "DOMAIN_TAKEN");
    throw httpError(409, "Já existe um cadastro em andamento para este e-mail", "EMAIL_PENDING");
  }
}

export async function lookupCompany(cnpj) {
  return publicCompany(await lookupCnpj(cnpj));
}

export async function startSignup(input) {
  const email = input.email.toLowerCase();
  const domain = normalizeDomain(input.domain);
  const cnpj = digitsOnly(input.cnpj);
  if (!isValidDomain(domain)) {
    throw httpError(400, "Informe um domínio válido, por exemplo empresa.com.br", "INVALID_DOMAIN");
  }
  if (!isValidCnpj(cnpj)) {
    throw httpError(400, "CNPJ inválido", "INVALID_CNPJ");
  }

  let company = publicCompany(input.company || {});
  if (!company.razao_social) {
    company = { ...await lookupCompany(cnpj), ...company };
  }
  company = { ...company, cnpj: formatCnpj(cnpj) };
  const companyName = input.company_name || company.razao_social;
  if (!companyName) {
    throw httpError(400, "Informe a empresa principal", "COMPANY_REQUIRED");
  }

  const existing = await pool.query(
    `SELECT id FROM tenant_signups WHERE lower(email) = lower($1) AND consumed_at IS NULL`,
    [email]
  );
  await assertAvailable({ email, domain, cnpj, excludeSignupId: existing.rows[0]?.id || null });

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SIGNUP_TTL_MS);
  const confirmUrl = `${config.appPublicUrl.replace(/\/$/, "")}/concluir-cadastro?token=${rawToken}`;

  try {
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE tenant_signups
         SET full_name = $2, company_name = $3, domain = $4, cnpj = $5, cnpj_data = $6::jsonb,
             token_hash = $7, expires_at = $8, updated_date = now()
         WHERE id = $1`,
        [
          existing.rows[0].id,
          input.full_name,
          companyName,
          domain,
          cnpj,
          JSON.stringify(company),
          tokenHash,
          expiresAt.toISOString(),
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO tenant_signups (
           email, full_name, company_name, domain, cnpj, cnpj_data, token_hash, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [email, input.full_name, companyName, domain, cnpj, JSON.stringify(company), tokenHash, expiresAt.toISOString()]
      );
    }
  } catch (error) {
    if (error?.code === "23505") throw mapSignupUnique(error);
    throw error;
  }

  const mail = confirmationEmail({
    fullName: input.full_name,
    companyName,
    confirmUrl,
  });
  const sent = await sendMail({ to: email, ...mail });
  logger.info({ email, domain, cnpj, emailSent: sent.sent }, "cadastro de tenant iniciado");

  return {
    email,
    company_name: companyName,
    domain,
    expires_at: expiresAt.toISOString(),
    email_sent: sent.sent,
    confirm_url: sent.sent ? undefined : confirmUrl,
  };
}

export async function getSignupByToken(rawToken) {
  const tokenHash = hashToken(String(rawToken || ""));
  const result = await pool.query(
    `SELECT id, email, full_name, company_name, domain, cnpj, cnpj_data, expires_at, consumed_at
     FROM tenant_signups WHERE token_hash = $1`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, "Link de cadastro inválido", "SIGNUP_NOT_FOUND");
  if (row.consumed_at) throw httpError(409, "Este cadastro já foi concluído", "SIGNUP_CONSUMED");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw httpError(410, "Este link expirou. Inicie o cadastro novamente.", "SIGNUP_EXPIRED");
  }
  return {
    email: row.email,
    full_name: row.full_name,
    company_name: row.company_name,
    domain: row.domain,
    cnpj: formatCnpj(row.cnpj),
    company: publicCompany(row.cnpj_data),
    expires_at: row.expires_at,
  };
}

export async function completeSignup(rawToken, passwords) {
  const tokenHash = hashToken(String(rawToken || ""));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM tenant_signups WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash]
    );
    const signup = result.rows[0];
    if (!signup) throw httpError(404, "Link de cadastro inválido", "SIGNUP_NOT_FOUND");
    if (signup.consumed_at) throw httpError(409, "Este cadastro já foi concluído", "SIGNUP_CONSUMED");
    if (new Date(signup.expires_at).getTime() < Date.now()) {
      throw httpError(410, "Este link expirou. Inicie o cadastro novamente.", "SIGNUP_EXPIRED");
    }

    const email = signup.email.toLowerCase();
    const domain = signup.domain;
    const cnpj = digitsOnly(signup.cnpj);
    await assertAvailable({ email, domain, cnpj, excludeSignupId: signup.id }, client);

    const passwordHash = await bcrypt.hash(passwords.password, config.bcryptRounds);
    const userId = randomUUID();
    const groupId = newIds("grp");
    const entityId = newIds("ent");
    const tenantId = newIds("tnt");
    const tenantUserId = newIds("tuser");
    const company = signup.cnpj_data || {};
    const formattedCnpj = formatCnpj(cnpj);
    const trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await client.query(
      `INSERT INTO users (
         id, email, password_hash, full_name, cargo, setor, role, status, blocked, created_by
       ) VALUES ($1,$2,$3,$4,'','','admin','active', FALSE, $2)`,
      [userId, email, passwordHash, signup.full_name]
    );
    await client.query(
      `INSERT INTO groups (
         id, group_name, cnpj_group, description, status, extra_json, created_by
       ) VALUES ($1,$2,$3,$4,'ativo',$5::jsonb,$6)`,
      [
        groupId,
        signup.company_name,
        formattedCnpj,
        `Tenant ${domain}`,
        JSON.stringify({ domain, cnpj: formattedCnpj }),
        email,
      ]
    );
    await client.query(
      `INSERT INTO company_entities (
         id, group_id, entity_name, document_number, document_type, entity_type,
         codigo_empresa, codigo_filial, status, extra_json, created_by
       ) VALUES ($1,$2,$3,$4,'CNPJ','empresa','01','01','ativa',$5::jsonb,$6)`,
      [
        entityId,
        groupId,
        company.nome_fantasia || signup.company_name,
        formattedCnpj,
        JSON.stringify({ ...company, domain, empresa_principal: signup.company_name }),
        email,
      ]
    );
    await client.query(
      `INSERT INTO tenants (
         id, group_id, tenant_name, plan, billing_status, trial_ends_at, contract_limit,
         contracts_used, owner_email, domain, extra_json, created_by
       ) VALUES ($1,$2,$3,'STARTER','trial',$4,10,0,$5,$6,$7::jsonb,$5)`,
      [
        tenantId,
        groupId,
        signup.company_name,
        trialEnds,
        email,
        domain,
        JSON.stringify({ cnpj: formattedCnpj, domain }),
      ]
    );
    await client.query(
      `INSERT INTO tenant_users (
         id, tenant_id, group_id, user_email, role, joined_at, created_by
       ) VALUES ($1,$2,$3,$4,'OWNER', now(), $4)`,
      [tenantUserId, tenantId, groupId, email]
    );
    await client.query(
      `UPDATE tenant_signups SET consumed_at = now(), updated_date = now() WHERE id = $1`,
      [signup.id]
    );
    await client.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
    await client.query("COMMIT");

    const tenant = await loadTenantForEmail(email);
    return issueAuthResponse(
      { id: userId, email, full_name: signup.full_name, role: "admin" },
      { ...tenant, tenant_role: "OWNER" }
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    if (error?.code === "23505") {
      throw mapSignupUnique(error);
    }
    throw error;
  } finally {
    client.release();
  }
}
