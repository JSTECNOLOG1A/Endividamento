/**
 * Permissões explícitas do control plane (PLATFORM_MASTER).
 * Evita "if platform_admin → tudo" sem declaração.
 */
export const PLATFORM_PERMISSIONS = Object.freeze({
  TENANTS_READ: "platform.tenants.read",
  TENANTS_CREATE: "platform.tenants.create",
  TENANTS_UPDATE: "platform.tenants.update",
  TENANTS_SUSPEND: "platform.tenants.suspend",
  TENANTS_REACTIVATE: "platform.tenants.reactivate",
  TENANTS_DISABLE: "platform.tenants.disable",
  TENANTS_CANCEL: "platform.tenants.cancel",
  BILLING_READ: "platform.billing.read",
  BILLING_MANAGE: "platform.billing.manage",
  AUDIT_READ: "platform.audit.read",
  SUPPORT_START: "platform.support.start",
  SUPPORT_END: "platform.support.end",
  SETTINGS_READ: "platform.settings.read",
  SETTINGS_UPDATE: "platform.settings.update",
  USERS_READ: "platform.users.read",
  OVERVIEW_READ: "platform.overview.read",
});

/** Conjunto completo atribuído a platform_admin (PLATFORM_MASTER). */
export const PLATFORM_MASTER_PERMISSIONS = Object.freeze(Object.values(PLATFORM_PERMISSIONS));

export function permissionsForUser(user) {
  if (user?.platform_admin === true) return [...PLATFORM_MASTER_PERMISSIONS];
  return [];
}

export function hasPlatformPermission(user, permission) {
  return permissionsForUser(user).includes(permission);
}

export function requirePlatformPermission(permission) {
  return (req, res, next) => {
    if (!req.user?.platform_admin) {
      res.status(403).json({ error: "Acesso restrito ao PLATFORM_MASTER", code: "PLATFORM_FORBIDDEN" });
      return;
    }
    if (!hasPlatformPermission(req.user, permission)) {
      res.status(403).json({
        error: "Permissão insuficiente",
        code: "PLATFORM_PERMISSION_DENIED",
        permission,
      });
      return;
    }
    next();
  };
}
