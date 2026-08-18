import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import ProcessingOverlay from "@/components/ProcessingOverlay";

const ProcessingContext = createContext(null);

export function ProcessingProvider({ children }) {
  const [state, setState] = useState({ count: 0, message: "" });

  const startProcessing = useCallback((message = "Processando…") => {
    setState((current) => ({
      count: current.count + 1,
      message: message || current.message || "Processando…",
    }));
  }, []);

  const stopProcessing = useCallback(() => {
    setState((current) => ({
      count: Math.max(0, current.count - 1),
      message: current.count <= 1 ? "" : current.message,
    }));
  }, []);

  const withProcessing = useCallback(async (message, fn) => {
    startProcessing(message);
    try {
      return await fn();
    } finally {
      stopProcessing();
    }
  }, [startProcessing, stopProcessing]);

  const value = useMemo(() => ({
    isProcessing: state.count > 0,
    message: state.message,
    startProcessing,
    stopProcessing,
    withProcessing,
  }), [state.count, state.message, startProcessing, stopProcessing, withProcessing]);

  return (
    <ProcessingContext.Provider value={value}>
      {children}
      <ProcessingOverlay open={state.count > 0} message={state.message} />
    </ProcessingContext.Provider>
  );
}

export function useProcessing() {
  const context = useContext(ProcessingContext);
  if (!context) {
    throw new Error("useProcessing precisa estar dentro de ProcessingProvider");
  }
  return context;
}
