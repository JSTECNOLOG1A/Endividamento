import React from "react";
import { LOGIN } from "./loginTheme";

function DotGrid({ className }) {
  return (
    <svg className={className} viewBox="0 0 180 180" fill="none" aria-hidden>
      {Array.from({ length: 8 }).map((_, row) =>
        Array.from({ length: 8 }).map((__, col) => (
          <circle
            key={`${row}-${col}`}
            cx={10 + col * 22}
            cy={10 + row * 22}
            r="1.6"
            fill={LOGIN.blue}
            opacity={0.18 - (row + col) * 0.008}
          />
        ))
      )}
    </svg>
  );
}

function ChartBars({ className }) {
  return (
    <svg className={className} viewBox="0 0 160 100" fill="none" aria-hidden>
      <rect x="12" y="58" width="18" height="32" rx="4" fill={LOGIN.blue} opacity="0.12" />
      <rect x="40" y="42" width="18" height="48" rx="4" fill={LOGIN.blue} opacity="0.16" />
      <rect x="68" y="28" width="18" height="62" rx="4" fill={LOGIN.blue} opacity="0.2" />
      <rect x="96" y="36" width="18" height="54" rx="4" fill={LOGIN.blue} opacity="0.14" />
      <rect x="124" y="18" width="18" height="72" rx="4" fill={LOGIN.blue} opacity="0.22" />
      <path
        d="M20 62 C48 58, 62 34, 90 38 C118 42, 128 22, 142 16"
        stroke={LOGIN.blue}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.28"
      />
    </svg>
  );
}

/**
 * Fundo decorativo da autenticação — elementos sutis, não competem com o card.
 */
export default function LoginBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Glow suave */}
      <div
        className="absolute -top-32 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{
          background: `radial-gradient(ellipse at center, ${LOGIN.blue}18 0%, transparent 70%)`,
        }}
      />

      <DotGrid className="absolute left-6 top-8 h-40 w-40 sm:left-10 sm:top-12 sm:h-48 sm:w-48" />

      {/* Forma geométrica — canto superior direito */}
      <div
        className="absolute -right-16 -top-10 h-64 w-64 rotate-12 rounded-[2rem] border opacity-[0.35] sm:right-8 sm:top-16 sm:h-72 sm:w-72"
        style={{ borderColor: `${LOGIN.blue}33`, background: `${LOGIN.blue}08` }}
      />
      <div
        className="absolute right-4 top-28 h-40 w-40 rotate-[28deg] rounded-full border opacity-30 sm:right-24 sm:top-40"
        style={{ borderColor: `${LOGIN.blue}28` }}
      />

      {/* Forma abstrata — canto inferior esquerdo */}
      <div
        className="absolute -bottom-24 -left-20 h-72 w-72 rounded-full opacity-50 blur-2xl"
        style={{
          background: `radial-gradient(circle at 40% 40%, ${LOGIN.blue}14 0%, transparent 65%)`,
        }}
      />
      <div
        className="absolute bottom-16 left-8 h-24 w-24 rounded-3xl border opacity-25 rotate-[-18deg] hidden sm:block"
        style={{ borderColor: LOGIN.border, background: `${LOGIN.white}aa` }}
      />

      <ChartBars className="absolute bottom-10 right-6 h-24 w-40 opacity-90 sm:bottom-14 sm:right-16 sm:h-28 sm:w-48" />

      {/* Textos decorativos laterais — desktop */}
      <p
        className="absolute left-6 top-1/2 hidden -translate-y-1/2 select-none text-[11px] font-semibold uppercase leading-[1.85] tracking-[0.28em] xl:block"
        style={{ color: `${LOGIN.blue}26` }}
      >
        Soluções
        <br />
        para um
        <br />
        amanhã
        <br />
        mais
        <br />
        saudável
      </p>
      <p
        className="absolute right-6 top-1/2 hidden -translate-y-1/2 select-none text-right text-[11px] font-semibold uppercase leading-[1.85] tracking-[0.28em] xl:block"
        style={{ color: `${LOGIN.blue}26` }}
      >
        Dados
        <br />
        pessoas
        <br />
        resultados
        <br />
        confiança
      </p>
    </div>
  );
}
