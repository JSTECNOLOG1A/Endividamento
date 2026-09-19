import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { platformApi } from "@/api/platform";
import { getPlatformTenantId, setPlatformTenantId } from "@/api/platformScope";
import { queryClientInstance } from "@/lib/query-client";

const PlatformContext = createContext(null);

export function PlatformProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const isMaster = Boolean(user?.platform_admin);
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState(() => getPlatformTenantId());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !isMaster) {
      setPlatformTenantId("");
      setTenantId("");
      setTenants([]);
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
    platformApi.setContext(getPlatformTenantId() || null).catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthenticated, isMaster, user?.email]);

  const selectTenant = useCallback((nextId) => {
    const normalized = !nextId || nextId === "all" ? "" : nextId;
    if (normalized === getPlatformTenantId()) return;
    // O header X-Tenant-Id passa a valer na hora (localStorage). Cancela o que
    // estava em voo do tenant anterior e zera o cache — senão a tela continua
    // mostrando dados do tenant antigo até alguém refazer a consulta. Só o
    // usuário logado não é escopado por tenant: esse apenas revalida.
    queryClientInstance.cancelQueries();
    setPlatformTenantId(normalized);
    queryClientInstance.resetQueries({ predicate: (q) => q.queryKey[0] !== "current-user" });
    setTenantId(normalized);
    // O registro de acesso (LGPD) é só auditoria: não bloqueia a troca.
    platformApi.setContext(normalized || null).catch(() => {});
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
    viewingAll: isMaster && !tenantId,
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
  };
}
