import path from "node:path";
import net from "node:net";

const IS_PROD = (process.env.NODE_ENV || "development") === "production";

// Valida um CIDR (ou IP puro) para o DENY interno do ERP. Entrada presente e
// malformada deve derrubar o boot — nunca ser descartada em silêncio (o DENY
// viraria vazio sem ninguém notar). Ausência continua opcional (DENY vazio).
function isValidCidrOrIp(str) {
  const s = String(str).trim();
  const slash = s.indexOf("/");
  const addr = slash >= 0 ? s.slice(0, slash) : s;
  const version = net.isIP(addr);
  if (!version) return false;
  if (slash < 0) return true;
  const prefix = Number(s.slice(slash + 1));
  const max = version === 4 ? 32 : 128;
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= max;
}

function parseDenyCidrs(raw) {
  const entries = String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = entries.filter((entry) => !isValidCidrOrIp(entry));
  if (invalid.length) {
    throw new Error(
      `ERP_INTERNAL_DENY_CIDRS contém CIDR inválido: ${invalid.join(", ")}. ` +
      "Use faixas como 172.16.0.0/12 (ou deixe a variável vazia para não aplicar DENY interno)."
    );
  }
  return entries;
}
const DEV_JWT = "dev-only-change-me-min-32-characters!!";
const DEV_ADMIN_PASSWORD = "Endividamento!Local1";

export const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.API_PORT || 3001),
  // Saltos de proxy confiáveis à frente da API (valor do `trust proxy` do
  // Express). Decide de quantos hops o X-Forwarded-For é descascado para obter
  // req.ip — a chave do rate limit de login. FIXADO POR COMPOSE conforme a
  // topologia de proxies (fato de implantação, não botão de operador): 1 = um
  // proxy direto (nginx, como em docker-compose.yml/prod.yml, que seguem no
  // default sem a chave); 2 = Traefik→nginx→api (docker-compose.traefik.yml, que
  // define TRUST_PROXY_HOPS=2). Valor alto demais torna o req.ip falsificável via
  // X-Forwarded-For e fura o limitador. Piso 1: ausente, vazio, inválido, 0 ou
  // negativo resultam sempre em 1.
  trustProxyHops: Math.max(1, Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "", 10) || 1),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || (IS_PROD ? "" : DEV_JWT),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  credentialsEncryptionKey:
    process.env.CREDENTIALS_ENCRYPTION_KEY ||
    (IS_PROD ? "" : (process.env.JWT_SECRET || DEV_JWT)),
  adminEmail: (process.env.ADMIN_EMAIL || "admin@endividamento.local").toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || (IS_PROD ? "" : DEV_ADMIN_PASSWORD),
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
  // emails-api — serviço central de e-mail da Clarity, dono do texto e do envio
  // do convite de usuário. Ambos opcionais de propósito: sem eles a API sobe
  // normalmente e o convite só não é enviado (email_sent: false), como já
  // acontecia sem SMTP. Não entram em validateSecrets.js.
  emailServiceUrl: (process.env.EMAIL_SERVICE_URL || "").replace(/\/+$/, ""),
  emailServiceApiKey: process.env.EMAIL_SERVICE_API_KEY || "",
  // Faixas de rede internas da Clarity (Docker/host) que NUNCA podem ser
  // alcançadas pelas chamadas ao ERP, mesmo que um OWNER as cadastre na lista de
  // endereços permitidos do tenant. DENY absoluto, acima da allowlist. Em
  // produção, apontar para a sub-rede dos containers (ex.: "172.16.0.0/12").
  // Loopback/link-local/metadata já são bloqueados de forma fixa.
  erpInternalDenyCidrs: parseDenyCidrs(process.env.ERP_INTERNAL_DENY_CIDRS),
};
