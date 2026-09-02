import {
  loadTenantById,
  loadTenantForEmail,
  loadUserById,
  runWithTenant,
} from "../modules/tenants/access.js";
import { writeAccessLog } from "../modules/platform/service.js";

function requestedTenantId(req) {
  const header = req.headers["x-tenant-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const raw = String(fromHeader || req.query.tenant_id || "").trim();
  if (!raw || raw === "all") return null;
  return raw;
}

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
      const tenantId = requestedTenantId(req);
      let tenant = null;
      if (tenantId) {
        tenant = await loadTenantById(tenantId);
        if (!tenant) {
          res.status(404).json({ error: "Cliente não encontrado", code: "TENANT_NOT_FOUND" });
          return;
        }
      }
      req.tenant = tenant;
      req.user.tenant_id = tenant?.id || null;
      req.user.group_id = tenant?.group_id || null;
      req.user.tenant_role = "PLATFORM";
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
        },
        () => {
          if (tenant && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
            writeAccessLog({
              req,
              action: "TENANT_WRITE",
              tenant,
              purpose: "suporte_operacional",
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
    if (tenant.billing_status === "suspended") {
      res.status(403).json({
        error: "Acesso suspenso. Entre em contato com o suporte.",
        code: "TENANT_SUSPENDED",
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
    res.status(403).json({ error: "Acesso restrito ao usuário master", code: "PLATFORM_FORBIDDEN" });
    return;
  }
  next();
}
