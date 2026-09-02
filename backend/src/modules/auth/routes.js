import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../middleware/audit.js";
import { loadTenantForEmail } from "../tenants/access.js";
import { issueAuthResponse } from "./token.js";
import { writeAccessLog } from "../platform/service.js";

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

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await pool.query(
      "SELECT id, email, password_hash, full_name, role, status, blocked, platform_admin FROM users WHERE email = $1",
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
    await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    const tenant = user.platform_admin ? null : await loadTenantForEmail(user.email);
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
      action: "LOGIN",
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
    if (user.platform_admin) {
      await writeAccessLog({ req, action: "LOGIN", tenant: null });
    }
    res.json(auth);
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

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, email, full_name, cargo, setor, role, status, blocked, blocked_at, last_login_at, platform_admin FROM users WHERE id = $1",
      [req.user.sub]
    );
    const me = result.rows[0];
    if (!me || me.status !== "active" || me.blocked === true) {
      const err = new Error("Usuário bloqueado");
      err.status = 401;
      throw err;
    }
    const platformAdmin = me.platform_admin === true;
    const tenant = platformAdmin ? null : await loadTenantForEmail(me.email);
    res.json({
      id: me.id,
      email: me.email,
      full_name: me.full_name,
      cargo: me.cargo,
      setor: me.setor,
      role: me.role,
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
