import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";
import { parametersApi } from "@/api/parameters";
import { getPlatformTenantId } from "@/api/platformScope";
import { readLayoutCache, resolveLayoutMode, writeLayoutCache } from "@/lib/layoutMode";

const LayoutContext = createContext(null);

export function LayoutProvider({ children }) {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const { currentTenant, loading: platformLoading } = usePlatform();
  const groupId = user?.group_id || currentTenant?.group_id || null;
  const [layoutMode, setLayoutMode] = useState("classic");
  const [loading, setLoading] = useState(true);

  const refreshLayout = useCallback(async () => {
    if (!isAuthenticated || isLoadingAuth || platformLoading) {
      if (!isAuthenticated) {
        setLayoutMode("classic");
        setLoading(false);
      }
      return;
    }

    if (user?.platform_admin && !getPlatformTenantId()) {
      setLayoutMode("classic");
      setLoading(false);
      return;
    }

    const cached = groupId ? readLayoutCache(groupId) : "classic";
    setLayoutMode(cached);
    setLoading(true);

    try {
      const result = await parametersApi.get("appearance.default_layout");
      const resolved = resolveLayoutMode(result?.data?.value);
      setLayoutMode(resolved);
      if (groupId) writeLayoutCache(groupId, resolved);
    } catch {
      setLayoutMode(groupId ? readLayoutCache(groupId) : "classic");
    } finally {
      setLoading(false);
    }
  }, [groupId, isAuthenticated, isLoadingAuth, platformLoading, user?.platform_admin]);

  useEffect(() => {
    refreshLayout();
  }, [refreshLayout]);

  const value = useMemo(() => ({
    layoutMode,
    loading,
    refreshLayout,
  }), [layoutMode, loading, refreshLayout]);

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayoutMode() {
  const ctx = useContext(LayoutContext);
  if (!ctx) {
    return { layoutMode: "classic", loading: false, refreshLayout: async () => {} };
  }
  return ctx;
}
