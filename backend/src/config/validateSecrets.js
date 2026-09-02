const DEV_JWT = "dev-only-change-me-min-32-characters!!";
const DEV_ADMIN_PASSWORD = "Endividamento!Local1";

function looksInsecure(value) {
  const text = String(value || "");
  if (!text) return true;
  if (text.length < 32) return true;
  if (text === DEV_JWT) return true;
  if (/change-this|change-me|dev-only|localhost|secret123/i.test(text)) return true;
  return false;
}

export function validateProductionSecrets(env = process.env) {
  if ((env.NODE_ENV || "development") !== "production") return { ok: true, errors: [] };

  const errors = [];
  if (looksInsecure(env.JWT_SECRET)) {
    errors.push("JWT_SECRET ausente, curto ou é valor de desenvolvimento");
  }
  if (looksInsecure(env.CREDENTIALS_ENCRYPTION_KEY)) {
    errors.push("CREDENTIALS_ENCRYPTION_KEY ausente, curta ou insegura");
  }
  const adminPassword = String(env.ADMIN_PASSWORD || "");
  if (!adminPassword || adminPassword === DEV_ADMIN_PASSWORD || adminPassword.length < 12) {
    errors.push("ADMIN_PASSWORD ausente ou é o valor de desenvolvimento");
  }
  if (errors.length) {
    const error = new Error(`Secrets de produção inválidos: ${errors.join("; ")}`);
    error.code = "INSECURE_SECRETS";
    error.errors = errors;
    throw error;
  }
  return { ok: true, errors: [] };
}
