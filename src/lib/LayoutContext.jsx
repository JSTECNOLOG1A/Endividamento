import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  // Só o primeiro resolve bloqueia a UI. Refresh posterior (troca de tenant,
  // parâmetros, etc.) NÃO pode setLoading(true) — o AppLayout desmonta as
  // páginas e a Calculadora perde o contrato aberto para edição.
  const bootedRef = useRef(false);

  const refreshLayout = useCallback(async () => {
    if (!isAuthenticated || isLoadingAuth || platformLoading) {
      if (!isAuthenticated) {
        setLayoutMode("classic");
        setLoading(false);
        bootedRef.current = false;
      }
      return;
    }

    if (user?.platform_admin && !getPlatformTenantId()) {
      setLayoutMode("classic");
      setLoading(false);
      bootedRef.current = true;
      return;
    }

    const cached = groupId ? readLayoutCache(groupId) : "classic";
    setLayoutMode(cached);
    if (!bootedRef.current) setLoading(true);

    try {
      const result = await parametersApi.get("appearance.default_layout");
      const resolved = resolveLayoutMode(result?.data?.value);
      setLayoutMode(resolved);
      if (groupId) writeLayoutCache(groupId, resolved);
    } catch {
      setLayoutMode(groupId ? readLayoutCache(groupId) : "classic");
    } finally {
      bootedRef.current = true;
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
