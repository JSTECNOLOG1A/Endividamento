/** Resolução segura do modo de layout (testável). */
export const LAYOUT_MODES = ["classic", "modern"];

export function resolveLayoutMode(raw) {
  if (raw === "modern") return "modern";
  return "classic";
}

export function layoutCacheKey(groupId) {
  return groupId ? `alldebt:layout:${groupId}` : "alldebt:layout:anonymous";
}

export function readLayoutCache(groupId) {
  try {
    const value = localStorage.getItem(layoutCacheKey(groupId));
    return resolveLayoutMode(value);
  } catch {
    return "classic";
  }
}

export function writeLayoutCache(groupId, mode) {
  try {
    localStorage.setItem(layoutCacheKey(groupId), resolveLayoutMode(mode));
  } catch {
    // ignore quota / private mode
  }
}

export function sidebarCollapseKey(userId) {
  return userId ? `alldebt:sidebar-collapsed:${userId}` : "alldebt:sidebar-collapsed";
}

export function readSidebarCollapsed(userId) {
  try {
    return localStorage.getItem(sidebarCollapseKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(userId, collapsed) {
  try {
    localStorage.setItem(sidebarCollapseKey(userId), collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}
