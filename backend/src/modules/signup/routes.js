import { Router } from "express";
import rateLimit from "express-rate-limit";
import { writeAudit } from "../../middleware/audit.js";
import * as service from "./service.js";

export const signupRouter = Router();

const lookupLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
});

function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const details = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.join(".") || "body";
    if (!details[field]) details[field] = issue.message;
  }
  const err = new Error(Object.values(details)[0] || "Payload inválido");
  err.status = 400;
  err.code = "VALIDATION";
  err.details = details;
  throw err;
}

signupRouter.get("/cnpj/:cnpj", lookupLimiter, async (req, res, next) => {
  try {
    res.json(await service.lookupCompany(req.params.cnpj));
  } catch (error) {
    next(error);
  }
});

signupRouter.post("/signup", signupLimiter, async (req, res, next) => {
  try {
    const body = parseOrThrow(service.signupSchema, req.body || {});
    const created = await service.startSignup(body);
    await writeAudit({
      req,
      action: "CREATE",
      resourceType: "TenantSignup",
      rotina: "Cadastro",
      registro: created.email,
      after: {
        email: created.email,
        company_name: created.company_name,
        domain: created.domain,
      },
      origem: "automatico",
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

signupRouter.get("/signup/:token", async (req, res, next) => {
  try {
    res.json(await service.getSignupByToken(req.params.token));
  } catch (error) {
    next(error);
  }
});

signupRouter.post("/signup/:token/password", signupLimiter, async (req, res, next) => {
  try {
    const body = parseOrThrow(service.passwordSchema, req.body || {});
    const result = await service.completeSignup(req.params.token, body);
    req.user = {
      sub: result.user.id,
      email: result.user.email,
      role: result.user.role,
      full_name: result.user.full_name,
    };
    await writeAudit({
      req,
      action: "CREATE",
      resourceType: "Tenant",
      resourceId: result.user.tenant_id,
      rotina: "Cadastro",
      registro: result.user.email,
      after: result.user,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
