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
  appPublicUrl: (process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, ""),
  appBaseUrl: (process.env.APP_BASE_URL || process.env.APP_PUBLIC_URL || "http://localhost:5173").replace(/\/+$/, ""),
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "Endividamento <noreply@localhost>",
};
