import React from "react";
import { createPortal } from "react-dom";
import { Calculator } from "lucide-react";

export default function ProcessingOverlay({ open, message }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] cursor-wait"
      role="alertdialog"
      aria-busy="true"
      aria-live="assertive"
      aria-modal="true"
      aria-label={message || "Processando"}
    >
      <div className="absolute top-0 left-0 right-0 h-1 overflow-hidden bg-blue-100">
        <div className="processing-bar h-full w-1/3 rounded-full bg-gradient-to-r from-blue-400 via-blue-600 to-blue-400" />
      </div>

      <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white px-6 py-7 text-center shadow-2xl shadow-slate-900/15">
        <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-blue-100 border-t-blue-600 animate-spin" />
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow-md shadow-blue-600/30">
            <Calculator className="h-5 w-5 text-white" />
          </div>
        </div>
        <p className="text-sm font-semibold text-slate-900">{message || "Processando…"}</p>
        <p className="mt-1 text-xs text-slate-600">Aguarde, o sistema está trabalhando. Isso pode levar alguns segundos.</p>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="processing-bar h-full w-2/5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600" />
        </div>
      </div>
    </div>,
    document.body
  );
}
