import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { config } from "../../config.js";
import { passwordSchema } from "../signup/service.js";
import { resetPasswordEmail, sendMail } from "../signup/mailer.js";
import { consumeAccountToken, issueAccountToken, loadAccountToken } from "./tokens.js";
import { logger } from "../../logger.js";

export const accountRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
});

function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const err = new Error(parsed.error.issues[0]?.message || "Payload inválido");
  err.status = 400;
  err.code = "VALIDATION";
  throw err;
}

const forgotSchema = z.object({
  email: z.string().trim().email(),
});

function publicUrl(path, token) {
  return `${config.appPublicUrl.replace(/\/$/, "")}${path}?token=${token}`;
}

accountRouter.post("/forgot-password", limiter, async (req, res, next) => {
  try {
    const { email } = parseOrThrow(forgotSchema, req.body || {});
    const result = await pool.query(
      `SELECT id, email, full_name, status, blocked FROM users WHERE lower(email) = lower($1)`,
      [email]
    );
    const user = result.rows[0];
    let resetUrl;
    let emailSent = false;
    if (user && user.status === "active" && user.blocked !== true) {
      const token = await issueAccountToken({ kind: "password_reset", userId: user.id, createdBy: user.email });
      resetUrl = publicUrl("/redefinir-senha", token.raw);
      const mail = resetPasswordEmail({ fullName: user.full_name, resetUrl });
      const sent = await sendMail({ to: user.email, ...mail });
      emailSent = sent.sent;
      if (!emailSent) {
        logger.warn({ email: user.email, smtp: Boolean(config.smtpHost) }, "reset de senha sem entrega SMTP");
      }
    }
    res.json({
      ok: true,
      message: "Se a conta existir, as instruções serão enviadas.",
    });
  } catch (error) {
    next(error);
  }
});

accountRouter.get("/account-token/:token", async (req, res, next) => {
  try {
    const row = await loadAccountToken(req.params.token);
    res.json({
      kind: row.kind,
      email: row.email,
      full_name: row.full_name,
      expires_at: row.expires_at,
    });
  } catch (error) {
    next(error);
  }
});

accountRouter.post("/account-token/:token/password", limiter, async (req, res, next) => {
  try {
    const body = parseOrThrow(passwordSchema, req.body || {});
    const row = await loadAccountToken(req.params.token);
    const hash = await bcrypt.hash(body.password, config.bcryptRounds);
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_date = now() WHERE id = $2`,
      [hash, row.user_id]
    );
    await consumeAccountToken(row.id);
    res.json({ ok: true, email: row.email, kind: row.kind });
  } catch (error) {
    next(error);
  }
});
