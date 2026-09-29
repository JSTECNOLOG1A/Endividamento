import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { PENDING_TENANT_SELECTION } from "../modules/auth/token.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Autenticação obrigatória", code: "AUTH_REQUIRED" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    // Token de "escolha de tenant" (5min, emitido só pelo /auth/login quando há mais de um): não é uma
    // sessão de verdade, serve só pra POST /auth/select-tenant (que o lê direto, sem passar por requireAuth).
    // Sem essa recusa aqui, ele passaria como um Bearer normal em qualquer rota, com um sub válido.
    if (payload?.purpose === PENDING_TENANT_SELECTION) {
      res.status(401).json({ error: "Token inválido ou expirado", code: "AUTH_INVALID" });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado", code: "AUTH_INVALID" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Permissão insuficiente", code: "FORBIDDEN" });
      return;
    }
    next();
  };
}
