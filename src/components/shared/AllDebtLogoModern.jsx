import React from "react";
import { cn } from "@/lib/utils";
import { MODERN_CYAN } from "@/layouts/modern/theme";

function Mark({ gradientId, className }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67E8F9" />
          <stop stopColor={MODERN_CYAN} />
          <stop offset="1" stopColor="#0891B2" />
        </linearGradient>
      </defs>
      <path
        d="M32 4L54 16.5V39.5L32 52L10 39.5V16.5L32 4Z"
        stroke={`url(#${gradientId})`}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M32 4L54 16.5V39.5L32 52"
        stroke={`url(#${gradientId})`}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="22" y="34" width="5" height="10" rx="1" fill={`url(#${gradientId})`} />
      <rect x="29.5" y="28" width="5" height="16" rx="1" fill={`url(#${gradientId})`} />
      <rect x="37" y="22" width="5" height="22" rx="1" fill={`url(#${gradientId})`} />
    </svg>
  );
}

/**
 * Marca AllDebt para o shell Modern.
 * variant: "brand" (sidebar) | "icon" (recolhida) | "full" (centralizado)
 */
export default function AllDebtLogoModern({ variant = "brand", subtitle, className }) {
  const gradientId = React.useId().replace(/:/g, "");

  if (variant === "icon") {
    return (
      <div className={cn("flex items-center justify-center", className)} aria-label="AllDebt BACEN">
        <Mark gradientId={gradientId} className="h-full w-full" />
      </div>
    );
  }

  if (variant === "brand") {
    return (
      <div className={cn("flex items-center gap-3 min-w-0", className)} aria-label="AllDebt BACEN">
        <Mark gradientId={gradientId} className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[1.05rem] font-bold leading-tight text-white truncate">
            All<span className="text-[#67E8F9]">Debt</span>
          </p>
          {subtitle ? (
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 truncate mt-0.5">
              {subtitle}
            </p>
          ) : (
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 mt-0.5">
              BACEN
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col items-center justify-center text-center", className)}
      aria-label="AllDebt BACEN"
    >
      <Mark gradientId={gradientId} className="h-[88px] w-[88px] shrink-0" />
      <p className="mt-3 text-[1.35rem] font-bold leading-none tracking-tight text-white">
        All<span style={{ color: MODERN_CYAN }}>Debt</span>
      </p>
      <p className="mt-2 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[#67E8F9]/90">
        BACEN
      </p>
    </div>
  );
}
