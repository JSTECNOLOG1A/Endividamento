import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { config } from "../../config.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../middleware/audit.js";

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
      "SELECT id, email, password_hash, full_name, role, status FROM users WHERE email = $1",
      [body.email.toLowerCase()]
    );
    const user = result.rows[0];
    const ok = user && user.status === "active" && await bcrypt.compare(body.password, user.password_hash);
    if (!ok) {
      const err = new Error("Credenciais inválidas");
      err.status = 401;
      err.code = "AUTH_FAILED";
      throw err;
    }
    await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, full_name: user.full_name },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    req.user = { sub: user.id, email: user.email, role: user.role, full_name: user.full_name };
    await writeAudit({
      req,
      action: "LOGIN",
      resourceType: "User",
      resourceId: user.id,
      registro: user.email,
      after: { email: user.email, full_name: user.full_name, role: user.role },
    });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    });
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
      "SELECT id, email, full_name, role, status, last_login_at FROM users WHERE id = $1",
      [req.user.sub]
    );
    if (!result.rows[0] || result.rows[0].status !== "active") {
      const err = new Error("Usuário inativo");
      err.status = 401;
      throw err;
    }
    res.json(result.rows[0]);
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
