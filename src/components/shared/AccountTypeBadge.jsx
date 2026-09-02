import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function isSintetica(value) {
  return String(value || "").toLowerCase() === "sintetica";
}

export default function AccountTypeBadge({ value, className }) {
  const sintetica = isSintetica(value);
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px] font-semibold tracking-wide border px-2 py-0.5",
        sintetica
          ? "border-violet-200 bg-violet-50 text-violet-800 account-type-badge account-type-badge--sintetica"
          : "border-cyan-200 bg-cyan-50 text-cyan-800 account-type-badge account-type-badge--analitica",
        className
      )}
    >
      {sintetica ? "Sintética" : "Analítica"}
    </Badge>
  );
}
