const TENANT_KEY = "endividamento_platform_tenant";
const SUPPORT_KEY = "endividamento_support_session";

export function getPlatformTenantId() {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(TENANT_KEY) || "";
}

export function setPlatformTenantId(id) {
  if (typeof localStorage === "undefined") return;
  if (!id || id === "all") localStorage.removeItem(TENANT_KEY);
  else localStorage.setItem(TENANT_KEY, id);
}

export function getSupportSessionId() {
  if (typeof localStorage === "undefined") return "";
  try {
    const raw = localStorage.getItem(SUPPORT_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.expires_at) return "";
    if (new Date(parsed.expires_at).getTime() <= Date.now()) {
      localStorage.removeItem(SUPPORT_KEY);
      return "";
    }
    return parsed.id;
  } catch {
    return "";
  }
}

export function getSupportSession() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SUPPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id || new Date(parsed.expires_at).getTime() <= Date.now()) {
      localStorage.removeItem(SUPPORT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setSupportSession(session) {
  if (typeof localStorage === "undefined") return;
  if (!session) localStorage.removeItem(SUPPORT_KEY);
  else localStorage.setItem(SUPPORT_KEY, JSON.stringify(session));
}

export function clearSupportSession() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(SUPPORT_KEY);
}
