import path from "node:path";

export const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.API_PORT || 3001),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me-min-32-characters!!",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  credentialsEncryptionKey:
    process.env.CREDENTIALS_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "dev-only-change-me-min-32-characters!!",
  adminEmail: (process.env.ADMIN_EMAIL || "admin@endividamento.local").toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || "Endividamento!Local1",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  bcryptRounds: 12,
  uploadDir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads"),
  // Base pública do front-end, usada só pra montar links dentro de
  // e-mails/notificações (ex.: "acesse o link para revisar").
  appBaseUrl: (process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, ""),
};
