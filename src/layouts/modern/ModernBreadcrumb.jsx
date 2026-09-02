import React from "react";
import { ChevronRight } from "lucide-react";
import { getBreadcrumbSegments } from "@/config/navigation";
import { useLayoutMode } from "@/lib/LayoutContext";

export default function ModernBreadcrumb({ currentPageName }) {
  const { layoutMode } = useLayoutMode();
  const segments = getBreadcrumbSegments(currentPageName, layoutMode);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
      {segments.map((segment, index) => (
        <React.Fragment key={`${segment.label}-${index}`}>
          {index > 0 ? (
            <ChevronRight className="w-3.5 h-3.5 text-[#667085] shrink-0" aria-hidden />
          ) : null}
          <span
            className={
              index === segments.length - 1
                ? "font-medium text-[#06B6D4] truncate"
                : "text-[#667085] truncate"
            }
          >
            {segment.label}
          </span>
        </React.Fragment>
      ))}
    </nav>
  );
}
