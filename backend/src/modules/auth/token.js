import jwt from "jsonwebtoken";
import { config } from "../../config.js";

// Usuário com login em mais de um tenant (ex.: consultor externo que atende mais de um cliente da
// plataforma): o login não escolhe mais sozinho — devolve esse token de curtíssima duração (só carrega
// o id do usuário, nenhum escopo de tenant/grupo) e a pessoa escolhe em qual cliente quer entrar
// (POST /api/auth/select-tenant). Sem isso, ela ficaria travada sempre no mesmo tenant, sem como trocar.
// Exportada porque requireAuth (middleware/auth.js) precisa recusar esse token em qualquer rota que não
// seja /auth/select-tenant — sem isso, ele passaria no jwt.verify normal como um Bearer válido qualquer.
export const PENDING_TENANT_SELECTION = "pending_tenant_selection";

export function issuePendingTenantSelectionToken(userId) {
  return jwt.sign({ sub: userId, purpose: PENDING_TENANT_SELECTION }, config.jwtSecret, { expiresIn: "5m" });
}

/** @returns {string|null} o id do usuário, ou null se o token for inválido/expirado/de outro propósito. */
export function verifyPendingTenantSelectionToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload?.purpose === PENDING_TENANT_SELECTION ? payload.sub : null;
  } catch {
    return null;
  }
}

export function issueAuthResponse(user, tenant) {
  const platformAdmin = user.platform_admin === true;
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    tenant_id: tenant?.id || null,
    group_id: tenant?.group_id || null,
    platform_admin: platformAdmin,
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      approval_level: Number(user.approval_level || 0),
      platform_admin: platformAdmin,
      tenant_id: tenant?.id || null,
      group_id: tenant?.group_id || null,
      tenant_name: tenant?.tenant_name || null,
      tenant_domain: tenant?.domain || null,
      tenant_role: platformAdmin ? "PLATFORM" : (tenant?.tenant_role || null),
      permissions: tenant?.module_permissions || {},
      billing_status: tenant?.billing_status || null,
      plan: tenant?.plan || null,
      trial_ends_at: tenant?.trial_ends_at || null,
      onboarding_completed_at: tenant?.onboarding_completed_at || null,
    },
  };
}
