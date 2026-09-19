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

// Ao trocar de tenant (ou abrir/encerrar sessão de suporte) o cache inteiro
// deixa de valer: cancela o que estava em voo e zera as consultas, senão a tela
// atual continua mostrando dados do contexto anterior até alguém navegar. Só o
// usuário logado não é escopado por tenant.
function resetTenantScopedQueries() {
  queryClientInstance.cancelQueries();
  queryClientInstance.resetQueries({ predicate: (q) => q.queryKey[0] !== "current-user" });
}

export function PlatformProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const isMaster = Boolean(user?.platform_admin);
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState(() => getPlatformTenantId());
  const [supportSession, setSupportSessionState] = useState(() => getSupportSession());
  const [loading, setLoading] = useState(false);
  // Cliente para o qual o master escolheu trocar e ainda falta abrir a sessão de
  // suporte (motivo + duração) — a tela do modal é montada em App.jsx.
  const [accessRequest, setAccessRequest] = useState(null);

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

  // Trocar de cliente no seletor: no modelo de sessão de suporte o master só vê
  // dados de um cliente dentro de uma sessão auditada (o servidor recusa
  // X-Tenant-Id sem sessão ou diferente dela). Então o seletor abre o pedido de
  // acesso do cliente escolhido — e, ao confirmar, a tela atual é refeita no
  // lugar, sem navegar. "Todos os clientes" encerra a sessão.
  const selectTenant = useCallback(async (nextId) => {
    const normalized = !nextId || nextId === "all" ? "" : nextId;
    const current = getSupportSession();
    if (!normalized) {
      setAccessRequest(null);
      if (current?.id) {
        try {
          await platformApi.endSupportSession(current.id);
        } catch {
          /* encerra local mesmo se a API falhar */
        }
      }
      clearSupportSession();
      setSupportSessionState(null);
      setPlatformTenantId("");
      resetTenantScopedQueries();
      setTenantId("");
      return;
    }
    if (current?.id && current.tenant_id === normalized) return;
    const target = tenants.find((item) => item.id === normalized);
    if (target) setAccessRequest(target);
  }, [tenants]);

  const clearAccessRequest = useCallback(() => setAccessRequest(null), []);

  const startSupport = useCallback(async (targetTenantId, payload) => {
    const session = await platformApi.startSupportSession(targetTenantId, payload);
    persistSupportSession(session);
    setSupportSessionState(session);
    setPlatformTenantId(session.tenant_id);
    resetTenantScopedQueries();
    setTenantId(session.tenant_id);
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
    resetTenantScopedQueries();
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
    accessRequest,
    clearAccessRequest,
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
    accessRequest: null,
    clearAccessRequest: () => {},
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
