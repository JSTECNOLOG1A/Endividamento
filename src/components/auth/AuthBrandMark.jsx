import React from "react";
import { cn } from "@/lib/utils";
import { LOGIN } from "./loginTheme";

function Mark({ className }) {
  const gradientId = React.useId().replace(/:/g, "");

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
          <stop stopColor="#60A5FA" />
          <stop offset="0.45" stopColor={LOGIN.blue} />
          <stop offset="1" stopColor={LOGIN.blueHover} />
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

/** Marca AllDebt para telas de auth em fundo claro. */
export default function AuthBrandMark({ className }) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center text-center", className)}
      aria-label="AllDebt SaaS"
    >
      <div className="flex items-center gap-2.5">
        <Mark className="h-10 w-10 shrink-0" />
        <div className="flex items-baseline gap-1.5">
          <span className="text-[1.35rem] font-bold tracking-tight" style={{ color: LOGIN.title }}>
            All<span style={{ color: LOGIN.blue }}>Debt</span>
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]"
            style={{
              color: LOGIN.blue,
              background: `${LOGIN.blue}12`,
              border: `1px solid ${LOGIN.blue}22`,
            }}
          >
            SaaS
          </span>
        </div>
      </div>
    </div>
  );
}
