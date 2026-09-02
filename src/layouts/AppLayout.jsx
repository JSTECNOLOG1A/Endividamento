import React from "react";
import { useLayoutMode } from "@/lib/LayoutContext";
import ClassicLayout from "./classic/ClassicLayout";
import ModernLayout from "./modern/ModernLayout";

export default function AppLayout({ children, currentPageName }) {
  const { layoutMode, loading } = useLayoutMode();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F9FC]">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#06B6D4] rounded-full animate-spin" />
      </div>
    );
  }

  if (layoutMode === "modern") {
    return (
      <ModernLayout currentPageName={currentPageName}>
        {children}
      </ModernLayout>
    );
  }

  return (
    <ClassicLayout currentPageName={currentPageName}>
      {children}
    </ClassicLayout>
  );
}
