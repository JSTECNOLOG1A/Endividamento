import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { platformApi } from "@/api/platform";
import {
  clearSupportSession,
  getPlatformTenantId,
  getSupportSession,
  setPlatformTenantId,
  setSupportSession as persistSupportSession,
} from "@/api/platformScope";
import { queryClientInstance } from "@/lib/query-client";

const PlatformContext = createContext(null);

export function PlatformProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const isMaster = Boolean(user?.platform_admin);
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState(() => getPlatformTenantId());
  const [supportSession, setSupportSessionState] = useState(() => getSupportSession());
  const [loading, setLoading] = useState(false);

  const refreshSupport = useCallback(async () => {
    if (!isMaster) {
      clearSupportSession();
      setSupportSessionState(null);
      return null;
    }
    try {
      const current = await platformApi.currentSupportSession();
      if (current?.id) {
        persistSupportSession(current);
        setSupportSessionState(current);
        setPlatformTenantId(current.tenant_id);
        setTenantId(current.tenant_id);
        return current;
      }
      clearSupportSession();
      setSupportSessionState(null);
      return null;
    } catch {
      const local = getSupportSession();
      setSupportSessionState(local);
      return local;
    }
  }, [isMaster]);

  useEffect(() => {
    if (!isAuthenticated || !isMaster) {
      setPlatformTenantId("");
      setTenantId("");
      setTenants([]);
      clearSupportSession();
      setSupportSessionState(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    platformApi.listTenants()
      .then((rows) => {
        if (!cancelled) setTenants(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setTenants([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    refreshSupport();
    return () => { cancelled = true; };
  }, [isAuthenticated, isMaster, user?.email, refreshSupport]);

  const selectTenant = useCallback(async (nextId) => {
    // Preferência de control plane — NÃO concede data plane sozinha.
    const normalized = !nextId || nextId === "all" ? "" : nextId;
    setPlatformTenantId(normalized);
    setTenantId(normalized);
    try {
      await platformApi.setContext(normalized || null);
    } catch {
      /* log LGPD não bloqueia */
    }
  }, []);

  const startSupport = useCallback(async (targetTenantId, payload) => {
    const session = await platformApi.startSupportSession(targetTenantId, payload);
    persistSupportSession(session);
    setSupportSessionState(session);
    setPlatformTenantId(session.tenant_id);
    setTenantId(session.tenant_id);
    queryClientInstance.invalidateQueries();
    return session;
  }, []);

  const endSupport = useCallback(async () => {
    const current = getSupportSession();
    if (current?.id) {
      try {
        await platformApi.endSupportSession(current.id);
      } catch {
        /* encerra local mesmo se API falhar */
      }
    }
    clearSupportSession();
    setSupportSessionState(null);
    queryClientInstance.invalidateQueries();
  }, []);

  const stepUp = useCallback(async (password) => {
    return platformApi.stepUp(password);
  }, []);

  const currentTenant = useMemo(
    () => tenants.find((item) => item.id === tenantId) || null,
    [tenants, tenantId]
  );

  const value = {
    isMaster,
    tenants,
    tenantId,
    currentTenant,
    loading,
    selectTenant,
    viewingAll: isMaster && !supportSession,
    supportSession,
    inSupportMode: Boolean(supportSession?.id),
    startSupport,
    endSupport,
    refreshSupport,
    stepUp,
    refreshTenants: async () => {
      const rows = await platformApi.listTenants();
      setTenants(Array.isArray(rows) ? rows : []);
      return rows;
    },
  };

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  return useContext(PlatformContext) || {
    isMaster: false,
    tenants: [],
    tenantId: "",
    currentTenant: null,
    loading: false,
    selectTenant: async () => {},
    viewingAll: false,
    supportSession: null,
    inSupportMode: false,
    startSupport: async () => null,
    endSupport: async () => {},
    refreshSupport: async () => null,
    stepUp: async () => {},
    refreshTenants: async () => [],
  };
}
