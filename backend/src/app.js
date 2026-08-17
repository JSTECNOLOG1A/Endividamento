import fs from "node:fs";
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
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./modules/health/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { entitiesRouter } from "./modules/entities/routes.js";
import { functionsRouter } from "./modules/functions/routes.js";
import { auditRouter } from "./modules/audit/routes.js";
import { integrationsRouter } from "./modules/integrations/routes.js";
import { schedulesRouter } from "./modules/schedules/routes.js";
import { openApiDocument } from "./openapi.js";
import * as store from "./modules/entities/store.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
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
  app.use("/uploads", express.static(config.uploadDir));

  app.use("/api", healthRouter);
  app.get("/api/openapi.json", (_req, res) => res.json(openApiDocument));
  app.get("/api/docs", (_req, res) => {
    res.type("text").send("OpenAPI: GET /api/openapi.json");
  });
  app.use("/api/auth", authRouter);

  app.use("/api", requireAuth);
  app.use("/api/entities", entitiesRouter);
  app.use("/api/functions", functionsRouter);
  app.use("/api/audit-events", auditRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/schedules", schedulesRouter);

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

  app.post("/api/uploads", upload.single("file"), (req, res) => {
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
