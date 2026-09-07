import {
  loadTenantById,
  loadTenantForEmail,
  loadUserById,
  runWithTenant,
} from "../modules/tenants/access.js";
import {
  getActiveSupportSession,
  writeAccessLog,
} from "../modules/platform/service.js";

function requestedTenantId(req) {
  const header = req.headers["x-tenant-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const raw = String(fromHeader || req.query.tenant_id || "").trim();
  if (!raw || raw === "all") return null;
  return raw;
}

function requestedSupportSessionId(req) {
  const header = req.headers["x-support-session-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return String(fromHeader || "").trim() || null;
}

const BLOCKED_LIFECYCLE = new Set(["SUSPENDED", "DISABLED", "CANCELLED"]);

export async function attachTenant(req, res, next) {
  try {
    const dbUser = await loadUserById(req.user?.sub);
    if (!dbUser || dbUser.status !== "active" || dbUser.blocked === true) {
      res.status(401).json({ error: "Usuário bloqueado", code: "AUTH_INVALID" });
      return;
    }

    const platformAdmin = dbUser.platform_admin === true;
    req.user = {
      ...req.user,
      sub: dbUser.id,
      email: dbUser.email,
      full_name: dbUser.full_name,
      role: dbUser.role,
      platform_admin: platformAdmin,
    };

    if (platformAdmin) {
      // Control plane: /api/platform/* não precisa de data plane.
      // Data plane só com SupportSession ativa (LGPD / least privilege).
      const supportId = requestedSupportSessionId(req);
      let tenant = null;
      let supportSession = null;

      if (supportId) {
        supportSession = await getActiveSupportSession(dbUser.id, supportId);
        if (!supportSession) {
          res.status(403).json({
            error: "Sessão de suporte inválida ou expirada",
            code: "SUPPORT_SESSION_INVALID",
          });
          return;
        }
        tenant = await loadTenantById(supportSession.tenant_id);
        if (!tenant) {
          res.status(404).json({ error: "Cliente não encontrado", code: "TENANT_NOT_FOUND" });
          return;
        }
        // Impede X-Tenant-Id divergente da sessão
        const headerTenant = requestedTenantId(req);
        if (headerTenant && headerTenant !== tenant.id) {
          res.status(403).json({
            error: "Tenant do header diverge da sessão de suporte",
            code: "SUPPORT_TENANT_MISMATCH",
          });
          return;
        }
      }

      req.supportSession = supportSession
        ? {
          id: supportSession.id,
          reason: supportSession.reason,
          expires_at: supportSession.expires_at,
          tenant_id: supportSession.tenant_id,
        }
        : null;
      req.tenant = tenant;
      req.user.tenant_id = tenant?.id || null;
      req.user.group_id = tenant?.group_id || null;
      req.user.tenant_role = "PLATFORM";
      req.user.support_session_id = supportSession?.id || null;

      runWithTenant(
        {
          userId: dbUser.id,
          platformAdmin: true,
          groupId: tenant?.group_id || null,
          tenantId: tenant?.id || null,
          email: dbUser.email,
          fullName: dbUser.full_name,
          role: dbUser.role,
          tenantRole: "PLATFORM",
          supportSessionId: supportSession?.id || null,
        },
        () => {
          if (tenant && supportSession && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
            writeAccessLog({
              req,
              action: "TENANT_WRITE",
              tenant,
              purpose: "suporte_operacional",
              supportSessionId: supportSession.id,
            }).catch(() => {});
          }
          next();
        }
      );
      return;
    }

    const tenant = await loadTenantForEmail(dbUser.email);
    if (!tenant) {
      res.status(403).json({
        error: "Usuário sem tenant. Conclua o cadastro da empresa ou peça acesso ao administrador.",
        code: "TENANT_REQUIRED",
      });
      return;
    }

    const lifecycle = tenant.lifecycle_status || (
      tenant.billing_status === "suspended" ? "SUSPENDED"
        : tenant.billing_status === "trial" ? "TRIAL"
          : "ACTIVE"
    );

    if (BLOCKED_LIFECYCLE.has(lifecycle) || tenant.billing_status === "suspended") {
      res.status(403).json({
        error: "O acesso da sua organização ao AllDebt está temporariamente suspenso.",
        code: "TENANT_SUSPENDED",
        lifecycle_status: lifecycle,
      });
      return;
    }

    req.tenant = tenant;
    req.user.tenant_id = tenant.id;
    req.user.group_id = tenant.group_id;
    req.user.tenant_role = tenant.tenant_role;
    runWithTenant(
      {
        userId: dbUser.id,
        groupId: tenant.group_id,
        tenantId: tenant.id,
        email: dbUser.email,
        fullName: dbUser.full_name,
        role: dbUser.role,
        tenantRole: tenant.tenant_role,
      },
      () => next()
    );
  } catch (error) {
    next(error);
  }
}

export function requirePlatformAdmin(req, res, next) {
  if (!req.user?.platform_admin) {
    res.status(403).json({ error: "Acesso restrito ao PLATFORM_MASTER", code: "PLATFORM_FORBIDDEN" });
    return;
  }
  next();
}
