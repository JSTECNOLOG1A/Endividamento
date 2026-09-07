import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { firstAccessApi } from "@/api/firstAccess";
import { LOGIN } from "@/components/auth/loginTheme";
import { useFirstAccess } from "@/lib/FirstAccessContext";
import { TOUR_STEPS } from "./tourSteps";

const PAD = 8;

function findTarget(selector) {
  if (!selector) return null;
  return document.querySelector(`[data-tour="${selector}"]`);
}

function computePlacement(rect, cardW, cardH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw < 640;

  if (isMobile) {
    return {
      top: Math.max(12, vh - cardH - 16),
      left: 12,
      width: vw - 24,
      placement: "bottom-sheet",
    };
  }

  const below = rect.bottom + PAD + 12;
  const above = rect.top - cardH - PAD - 12;
  let top = below + cardH < vh - 16 ? below : Math.max(16, above);
  let left = Math.min(Math.max(16, rect.left), vw - cardW - 16);
  if (rect.width < cardW) {
    left = Math.min(Math.max(16, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 16);
  }
  return { top, left, width: cardW, placement: "popover" };
}

export default function ProductTour() {
  const navigate = useNavigate();
  const { tourMode, endTourUi, refresh } = useFirstAccess();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const cardRef = useRef(null);
  const startedRef = useRef(false);

  const active = Boolean(tourMode);
  const step = TOUR_STEPS[index];
  const total = TOUR_STEPS.length;

  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    });
  }, [step]);

  const goToStep = useCallback(
    async (nextIndex) => {
      const next = TOUR_STEPS[nextIndex];
      if (!next) return;
      setReady(false);
      setIndex(nextIndex);
      if (next.route) {
        navigate(next.route);
      }
      // Aguarda montagem da página / alvo
      let attempts = 0;
      const wait = () => {
        attempts += 1;
        const el = findTarget(next.target);
        if (el || attempts > 40) {
          measure();
          setReady(true);
          return;
        }
        window.setTimeout(wait, 50);
      };
      window.setTimeout(wait, 80);
    },
    [navigate, measure]
  );

  useEffect(() => {
    if (!active) {
      startedRef.current = false;
      setIndex(0);
      setReady(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      if (tourMode === "auto" && !startedRef.current) {
        startedRef.current = true;
        try {
          await firstAccessApi.startTour();
          await refresh();
        } catch {
          /* tour visual ainda pode seguir; shown pode já existir */
        }
      }
      if (!cancelled) {
        goToStep(0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, tourMode, goToStep, refresh]);

  useLayoutEffect(() => {
    if (!active || !ready) return undefined;
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [active, ready, measure, index]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  const finish = async (kind) => {
    if (busy) return;
    setBusy(true);
    try {
      if (tourMode === "auto") {
        if (kind === "complete") await firstAccessApi.completeTour();
        else await firstAccessApi.skipTour();
        await refresh();
      }
    } finally {
      setBusy(false);
      endTourUi();
      navigate("/Simulator");
    }
  };

  const handleSkip = () => finish("skip");
  const handleComplete = () => finish("complete");

  const handleNext = () => {
    if (index >= total - 1) handleComplete();
    else goToStep(index + 1);
  };

  const handlePrev = () => {
    if (index <= 0) return;
    goToStep(index - 1);
  };

  if (!active || !step) return null;

  const cardW = 360;
  const cardH = 200;
  const placement = rect
    ? computePlacement(rect, cardW, cardH)
    : { top: 80, left: 24, width: Math.min(cardW, window.innerWidth - 48), placement: "fallback" };

  const hole = rect
    ? {
      top: Math.max(0, rect.top - PAD),
      left: Math.max(0, rect.left - PAD),
      width: rect.width + PAD * 2,
      height: rect.height + PAD * 2,
    }
    : null;

  return (
    <div className="fixed inset-0 z-[95]" role="dialog" aria-modal="true" aria-label="Tour do sistema">
      {hole ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-[#155EEF]/80 transition-all duration-200"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.48)",
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-slate-900/45" />
      )}

      <div className="absolute inset-0" aria-hidden />

      <div
        ref={cardRef}
        className="absolute z-[96] rounded-2xl border bg-white p-5 shadow-xl transition-all duration-200"
        style={{
          top: placement.top,
          left: placement.left,
          width: placement.width,
          borderColor: LOGIN.border,
          maxWidth: "calc(100vw - 24px)",
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: LOGIN.blue }}>
              {index + 1} de {total}
            </p>
            <h2 className="mt-1 text-base font-bold" style={{ color: LOGIN.title }}>
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/40"
            aria-label="Fechar tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm leading-relaxed" style={{ color: LOGIN.muted }}>
          {step.description}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="text-sm font-medium text-[#64748B] hover:text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/35 rounded px-1"
          >
            Pular tour
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={index === 0 || busy}
              className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm font-medium text-[#334155] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/35"
              style={{ borderColor: LOGIN.border }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Anterior
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#155EEF]/45"
              style={{ backgroundColor: LOGIN.blue }}
            >
              {index >= total - 1 ? "Concluir" : "Próximo"}
              {index < total - 1 ? <ArrowRight className="h-3.5 w-3.5" /> : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
