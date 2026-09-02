function storageKey(scope) {
  return `endividamento_selected_group:${scope || "default"}`;
}

export function getSelectedGroupId(scope) {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(storageKey(scope)) || "";
}

export function setSelectedGroupId(scope, groupId) {
  if (typeof localStorage === "undefined") return;
  if (!groupId) localStorage.removeItem(storageKey(scope));
  else localStorage.setItem(storageKey(scope), groupId);
}

export function resolveGroupScope({ isMaster, tenantId, userTenantId }) {
  if (isMaster) return tenantId || "";
  return userTenantId || "default";
}
