import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../middleware/audit.js";
import { loadTenantForEmail, loadTenantForEmailAndId, loadAllTenantsForEmail, isTenantBlocked } from "../tenants/access.js";
import { issueAuthResponse, issuePendingTenantSelectionToken, verifyPendingTenantSelectionToken } from "./token.js";
import { writeAccessLog } from "../platform/service.js";
import { markFirstLoginIfNeeded } from "../firstAccess/service.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// Finaliza o login (ou a seleção de tenant): emite o token, registra a auditoria e o primeiro acesso.
// Compartilhado entre /login (caminho direto, um só tenant possível) e /select-tenant (depois de escolher).
async function finalizeLogin(req, res, user, tenant) {
  await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  const auth = issueAuthResponse(user, tenant);
  req.user = {
    sub: user.id,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    tenant_id: tenant?.id || null,
    group_id: tenant?.group_id || null,
    platform_admin: user.platform_admin === true,
  };
  await writeAudit({
    req,
    action: user.platform_admin ? "PLATFORM_MASTER_LOGIN" : "LOGIN",
    resourceType: "User",
    resourceId: user.id,
    registro: user.email,
    after: {
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      tenant_id: tenant?.id || null,
      platform_admin: user.platform_admin === true,
    },
  });
  await markFirstLoginIfNeeded(req, user.id);
  if (user.platform_admin) {
    await writeAccessLog({ req, action: "PLATFORM_MASTER_LOGIN", tenant: null, purpose: "seguranca" });
  }
  res.json(auth);
}

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await pool.query(
      "SELECT id, email, password_hash, full_name, role, approval_level, status, blocked, platform_admin FROM users WHERE email = $1",
      [body.email.toLowerCase()]
    );
    const user = result.rows[0];
    const active = user && user.status === "active" && user.blocked !== true;
    const ok = active && await bcrypt.compare(body.password, user.password_hash);
    if (!ok) {
      const err = new Error("Credenciais inválidas");
      err.status = 401;
      err.code = "AUTH_FAILED";
      throw err;
    }

    if (user.platform_admin) {
      await finalizeLogin(req, res, user, null);
      return;
    }

    // Login com mais de um tenant (ex.: consultor externo que atende mais de um cliente da plataforma):
    // não escolhe mais sozinho — pergunta. Tenant suspenso/desabilitado nem entra na lista; só bloqueia de
    // verdade (como sempre) quando não sobra nenhum utilizável.
    const allTenants = await loadAllTenantsForEmail(user.email);
    const usable = allTenants.filter((t) => !isTenantBlocked(t));
    if (allTenants.length && !usable.length) {
      const err = new Error("O acesso da sua organização ao AllDebt está temporariamente suspenso.");
      err.status = 403;
      err.code = "TENANT_SUSPENDED";
      throw err;
    }
    if (usable.length > 1) {
      res.json({
        tenant_selection_required: true,
        pending_token: issuePendingTenantSelectionToken(user.id),
        tenants: usable.map((t) => ({ tenant_id: t.id, tenant_name: t.tenant_name, tenant_role: t.tenant_role })),
      });
      return;
    }
    await finalizeLogin(req, res, user, usable[0] || null);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // `message` é getter-only em ZodError (zod >=3.25) — atribuir direto
      // lança TypeError e derruba a resposta para 500 em vez do 400 esperado.
      const validationError = new Error("Payload de login inválido");
      validationError.status = 400;
      validationError.code = "VALIDATION";
      next(validationError);
      return;
    }
    next(error);
  }
});

const selectTenantSchema = z.object({
  pending_token: z.string().min(1),
  tenant_id: z.string().min(1),
});

// Segundo passo do login com mais de um tenant: confirma o token de seleção (curtíssimo, 5min, emitido só
// no /login acima) e que o tenant escolhido realmente pertence a esse usuário — nunca confia cegamente na
// escolha vinda do cliente.
authRouter.post("/select-tenant", loginLimiter, async (req, res, next) => {
  try {
    const body = selectTenantSchema.parse(req.body);
    const userId = verifyPendingTenantSelectionToken(body.pending_token);
    if (!userId) {
      const err = new Error("Sessão de login expirada — faça login novamente.");
      err.status = 401;
      err.code = "AUTH_INVALID";
      throw err;
    }
    const result = await pool.query(
      "SELECT id, email, full_name, role, approval_level, status, blocked, platform_admin FROM users WHERE id = $1",
      [userId]
    );
    const user = result.rows[0];
    if (!user || user.status !== "active" || user.blocked === true || user.platform_admin) {
      const err = new Error("Usuário bloqueado");
      err.status = 401;
      err.code = "AUTH_INVALID";
      throw err;
    }
    const tenant = await loadTenantForEmailAndId(user.email, body.tenant_id);
    if (!tenant) {
      const err = new Error("Você não tem mais acesso a este cliente.");
      err.status = 403;
      err.code = "TENANT_FORBIDDEN";
      throw err;
    }
    if (isTenantBlocked(tenant)) {
      const err = new Error("O acesso da sua organização ao AllDebt está temporariamente suspenso.");
      err.status = 403;
      err.code = "TENANT_SUSPENDED";
      throw err;
    }
    await finalizeLogin(req, res, user, tenant);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationError = new Error("Payload inválido");
      validationError.status = 400;
      validationError.code = "VALIDATION";
      next(validationError);
      return;
    }
    next(error);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, email, full_name, cargo, setor, role, approval_level, status, blocked, blocked_at, last_login_at, platform_admin FROM users WHERE id = $1",
      [req.user.sub]
    );
    const me = result.rows[0];
    if (!me || me.status !== "active" || me.blocked === true) {
      const err = new Error("Usuário bloqueado");
      err.status = 401;
      throw err;
    }
    const platformAdmin = me.platform_admin === true;
    // Mesma prioridade do attachTenant: o tenant que o token já fixou, não o recálculo do zero — senão
    // quem tem login em mais de um tenant veria o nome errado aqui mesmo estando corretamente escopado
    // nas chamadas de dados (que passam pelo attachTenant).
    const tenant = platformAdmin ? null : (
      (req.user?.tenant_id && await loadTenantForEmailAndId(me.email, req.user.tenant_id))
      || (await loadTenantForEmail(me.email))
    );
    res.json({
      id: me.id,
      email: me.email,
      full_name: me.full_name,
      cargo: me.cargo,
      setor: me.setor,
      role: me.role,
      approval_level: Number(me.approval_level || 0),
      status: me.status,
      blocked: me.blocked,
      blocked_at: me.blocked_at,
      last_login_at: me.last_login_at,
      platform_admin: platformAdmin,
      tenant_id: tenant?.id || null,
      group_id: tenant?.group_id || null,
      tenant_name: tenant?.tenant_name || null,
      tenant_domain: tenant?.domain || null,
      tenant_role: platformAdmin ? "PLATFORM" : (tenant?.tenant_role || null),
      permissions: tenant?.module_permissions || {},
      billing_status: tenant?.billing_status || null,
      plan: tenant?.plan || null,
      trial_ends_at: tenant?.trial_ends_at || null,
      onboarding_completed_at: tenant?.onboarding_completed_at || null,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await writeAudit({
      req,
      action: "LOGOUT",
      resourceType: "User",
      resourceId: req.user.sub,
      registro: req.user.email,
      before: { email: req.user.email, full_name: req.user.full_name, role: req.user.role },
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
