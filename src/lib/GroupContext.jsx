import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getSelectedGroupId, resolveGroupScope, setSelectedGroupId } from "@/api/groupScope";
import { useAuth } from "@/lib/AuthContext";
import { usePlatform } from "@/lib/PlatformContext";

const GroupContext = createContext(null);

function activeGroups(rows) {
  return (rows || []).filter((item) => !item.status || item.status === "ativo");
}

export function GroupProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const { isMaster, tenantId, viewingAll } = usePlatform();
  const scope = resolveGroupScope({
    isMaster,
    tenantId,
    userTenantId: user?.tenant_id,
  });
  const enabled = isAuthenticated && Boolean(scope) && !viewingAll;
  const [groupId, setGroupId] = useState(() => (enabled ? getSelectedGroupId(scope) : ""));

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["groups", scope],
    queryFn: () => base44.entities.Group.list("-created_date", 100),
    enabled,
    initialData: [],
  });

  const options = useMemo(() => activeGroups(groups), [groups]);

  useEffect(() => {
    if (!enabled) {
      setGroupId("");
      return;
    }
    const stored = getSelectedGroupId(scope);
    if (stored && options.some((item) => item.id === stored)) {
      setGroupId(stored);
      return;
    }
    if (options.length === 1) {
      setSelectedGroupId(scope, options[0].id);
      setGroupId(options[0].id);
      return;
    }
    setGroupId("");
  }, [enabled, scope, options]);

  const selectGroup = useCallback((nextId) => {
    const normalized = nextId && nextId !== "__none__" ? nextId : "";
    setSelectedGroupId(scope, normalized);
    setGroupId(normalized);
  }, [scope]);

  const currentGroup = useMemo(
    () => options.find((item) => item.id === groupId) || null,
    [options, groupId]
  );

  const value = useMemo(() => ({
    groups: options,
    groupId,
    currentGroup,
    loading: enabled && isLoading,
    enabled,
    selectGroup,
    viewingAll,
  }), [options, groupId, currentGroup, enabled, isLoading, selectGroup, viewingAll]);

  return (
    <GroupContext.Provider value={value}>
      {children}
    </GroupContext.Provider>
  );
}

export function useGroup() {
  return useContext(GroupContext) || {
    groups: [],
    groupId: "",
    currentGroup: null,
    loading: false,
    enabled: false,
    selectGroup: () => {},
    viewingAll: false,
  };
}
