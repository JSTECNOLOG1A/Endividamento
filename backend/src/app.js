import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { requestId } from "./middleware/requestId.js";
import { requireAuth } from "./middleware/auth.js";
import { attachTenant } from "./middleware/tenant.js";
import { requireCanWrite } from "./middleware/rbac.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./modules/health/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { entitiesRouter } from "./modules/entities/routes.js";
import { functionsRouter } from "./modules/functions/routes.js";
import { auditRouter } from "./modules/audit/routes.js";
import { integrationsRouter } from "./modules/integrations/routes.js";
import { schedulesRouter } from "./modules/schedules/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { signupRouter } from "./modules/signup/routes.js";
import { accountRouter } from "./modules/account/routes.js";
import { platformRouter } from "./modules/platform/routes.js";
import { billingRouter } from "./modules/billing/routes.js";
import { onboardingRouter } from "./modules/onboarding/routes.js";
import { openApiDocument } from "./openapi.js";
import * as store from "./modules/entities/store.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(config.uploadDir, req.user?.group_id || "orphan");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  // 50MB: contratos digitalizados/anexos costumam vir com várias páginas
  // escaneadas (imagem, não texto) e passam fácil dos 20MB antigos, que
  // geravam um "Erro interno" genérico em vez de avisar sobre o tamanho.
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Apenas PDF"));
  },
});

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.requestId }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "8mb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use("/uploads", (req, res, next) => {
    if (!req.headers.authorization && req.query.token) {
      req.headers.authorization = `Bearer ${String(req.query.token)}`;
    }
    next();
  }, requireAuth, attachTenant, (req, res, next) => {
    const filename = String(req.path || "").replace(/^\/+/, "");
    if (!filename || filename.includes("..") || filename.includes("/")) {
      res.status(404).json({ error: "Arquivo não encontrado", code: "NOT_FOUND" });
      return;
    }
    const tenantDir = req.user.group_id
      ? path.join(config.uploadDir, req.user.group_id)
      : null;
    if (tenantDir) {
      const tenantFile = path.join(tenantDir, filename);
      if (fs.existsSync(tenantFile)) {
        res.sendFile(path.resolve(tenantFile));
        return;
      }
    }
    if (req.user.platform_admin) {
      const root = config.uploadDir;
      const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(root, entry.name, filename);
        if (fs.existsSync(candidate)) {
          res.sendFile(path.resolve(candidate));
          return;
        }
      }
    }
    const legacyFile = path.join(config.uploadDir, filename);
    if (fs.existsSync(legacyFile) && (req.user.platform_admin || req.tenant?.group_id)) {
      res.sendFile(path.resolve(legacyFile));
      return;
    }
    next();
  });

  app.use("/api", healthRouter);
  app.get("/api/openapi.json", (_req, res) => res.json(openApiDocument));
  app.get("/api/docs", (_req, res) => {
    res.type("text").send("OpenAPI: GET /api/openapi.json");
  });
  app.use("/api/auth", authRouter);
  app.use("/api/public", signupRouter);
  app.use("/api/public", accountRouter);

  app.use("/api", requireAuth);
  app.use("/api", attachTenant);
  app.use("/api/platform", platformRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/onboarding", onboardingRouter);
  app.use("/api/entities", entitiesRouter);
  app.use("/api/functions", functionsRouter);
  app.use("/api/audit-events", auditRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/schedules", schedulesRouter);
  app.use("/api/users", usersRouter);

  const aliases = {
    groups: "Group",
    "company-entities": "CompanyEntity",
    banks: "Bank",
    "bank-accounts": "BankAccount",
    natures: "Nature",
    "chart-of-accounts": "ChartOfAccount",
    "payable-titles": "PayableTitle",
    "receivable-titles": "ReceivableTitle",
    contracts: "LoanContract",
    snapshots: "CalculationSnapshot",
    rates: "CDIRate",
    holidays: "Holiday",
    currencies: "Currency",
    tenants: "Tenant",
    "tenant-users": "TenantUser",
  };
  for (const [alias, name] of Object.entries(aliases)) {
    app.get(`/api/${alias}`, async (req, res, next) => {
      try {
        res.json(await store.list(name, req.query.sort, req.query.limit));
      } catch (error) {
        next(error);
      }
    });
  }

  app.post("/api/uploads", requireCanWrite, upload.single("file"), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Arquivo não enviado" });
      return;
    }
    res.json({ file_url: `/uploads/${req.file.filename}` });
  });

  app.use((req, res) => {
    res.status(404).json({
      error: `Rota não encontrada: ${req.method} ${req.path}`,
      code: "NOT_FOUND",
    });
  });

  app.use(errorHandler);
  return app;
}
