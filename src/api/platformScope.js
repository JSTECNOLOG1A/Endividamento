const KEY = "endividamento_platform_tenant";

export function getPlatformTenantId() {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(KEY) || "";
}

export function setPlatformTenantId(id) {
  if (typeof localStorage === "undefined") return;
  if (!id || id === "all") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, id);
}
