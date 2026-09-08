import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { firstAccessApi } from "@/api/firstAccess";
import { useAuth } from "@/lib/AuthContext";
import { LOGIN } from "@/components/auth/loginTheme";

const FirstAccessContext = createContext(null);

export function FirstAccessProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tourMode, setTourMode] = useState(null); // null | 'auto' | 'manual'
  const bootedRef = useRef(false);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!isAuthenticated || !user) {
      setState(null);
      setLoading(false);
      bootedRef.current = false;
      setTourMode(null);
      return null;
    }
    // Só o primeiro fetch bloqueia a UI. Refresh no meio do tour/legal
    // NÃO pode setLoading(true) — desmonta rotas e causa flicker.
    if (!silent && !bootedRef.current) setLoading(true);
    setError(null);
    try {
      const data = await firstAccessApi.getOnboarding();
      setState(data);
      return data;
    } catch (err) {
      setError(err.message || "Falha ao carregar primeiro acesso");
      setState(null);
      return null;
    } finally {
      bootedRef.current = true;
      setLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state || loading) return;
    if (state.gate?.needsLegal) {
      setTourMode(null);
      return;
    }
    // Auto-start uma única vez enquanto o gate ainda pede tour.
    if (state.gate?.needsTour) {
      setTourMode((current) => (current == null ? "auto" : current));
    }
  }, [state, loading]);

  const startManualTour = useCallback(() => {
    setTourMode("manual");
  }, []);

  const endTourUi = useCallback(() => {
    setTourMode(null);
  }, []);

  const value = useMemo(
    () => ({
      state,
      loading,
      error,
      refresh,
      tourMode,
      setTourMode,
      startManualTour,
      endTourUi,
      needsLegal: Boolean(state?.gate?.needsLegal),
      needsTour: Boolean(state?.gate?.needsTour),
    }),
    [state, loading, error, refresh, tourMode, startManualTour, endTourUi]
  );

  return (
    <FirstAccessContext.Provider value={value}>
      {children}
    </FirstAccessContext.Provider>
  );
}

export function useFirstAccess() {
  const ctx = useContext(FirstAccessContext);
  if (!ctx) throw new Error("useFirstAccess must be used within FirstAccessProvider");
  return ctx;
}

/** Loading leve entre auth e app — evita flicker do tour. */
export function FirstAccessBootScreen({ message = "Preparando seu acesso…" }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{ backgroundColor: LOGIN.bg }}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-9 w-9 rounded-full border-2 border-slate-200 animate-spin"
          style={{ borderTopColor: LOGIN.blue }}
        />
        <p className="text-sm" style={{ color: LOGIN.muted }}>
          {message}
        </p>
      </div>
    </div>
  );
}
