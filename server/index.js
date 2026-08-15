import express from "express";
import cors from "cors";
import multer from "multer";
import { uploadsDir } from "./db.js";
import * as crud from "./crud.js";
import { handlers } from "./functions.js";

const app = express();
const PORT = Number(process.env.API_PORT || 3001);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, engine: "local-sqlite", time: new Date().toISOString() });
});

app.get("/api/auth/me", (_req, res) => {
  res.json(crud.LOCAL_USER);
});

app.post("/api/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/entities/:name", (req, res, next) => {
  try {
    res.json(crud.list(req.params.name, req.query.sort, req.query.limit));
  } catch (error) {
    next(error);
  }
});

app.post("/api/entities/:name/filter", (req, res, next) => {
  try {
    const { query, sort, limit } = req.body || {};
    res.json(crud.filter(req.params.name, query, sort, limit));
  } catch (error) {
    next(error);
  }
});

app.post("/api/entities/:name/bulk", (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body?.items || [];
    res.json(crud.bulkCreate(req.params.name, items));
  } catch (error) {
    next(error);
  }
});

app.get("/api/entities/:name/:id", (req, res, next) => {
  try {
    res.json(crud.getById(req.params.name, req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/entities/:name", (req, res, next) => {
  try {
    res.status(201).json(crud.create(req.params.name, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/entities/:name/:id", (req, res, next) => {
  try {
    res.json(crud.update(req.params.name, req.params.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.put("/api/entities/:name/:id", (req, res, next) => {
  try {
    res.json(crud.update(req.params.name, req.params.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/entities/:name/:id", (req, res, next) => {
  try {
    res.json(crud.remove(req.params.name, req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/uploads", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Arquivo não enviado" });
    return;
  }
  res.json({ file_url: `/uploads/${req.file.filename}` });
});

app.post("/api/functions/:name", async (req, res, next) => {
  try {
    const handler = handlers[req.params.name];
    if (!handler) {
      res.status(404).json({ error: `Função não encontrada: ${req.params.name}` });
      return;
    }
    const result = await handler(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error("[api]", error);
  res.status(status).json({ error: error.message || "Erro interno" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[api] http://127.0.0.1:${PORT}`);
  console.log(`[api] uploads: ${uploadsDir}`);
});
