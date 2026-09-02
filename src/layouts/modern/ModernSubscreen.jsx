import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLayoutMode } from "@/lib/LayoutContext";
import { cn } from "@/lib/utils";

export function useIsModernSubscreen() {
  const { layoutMode } = useLayoutMode();
  return layoutMode === "modern";
}

export function SubscreenDialogContent({ className, children, ...props }) {
  const modern = useIsModernSubscreen();
  return (
    <DialogContent
      className={cn(
        "max-w-6xl max-h-[90vh] overflow-hidden flex flex-col",
        modern && "gap-0 rounded-2xl border-[#E5E7EB] p-0 shadow-xl",
        className
      )}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

export function SubscreenHeader({ className, children }) {
  const modern = useIsModernSubscreen();
  return (
    <DialogHeader
      className={cn(
        modern && "px-6 pt-6 pb-4 border-b border-[#E5E7EB] bg-white text-left shrink-0 space-y-1.5",
        className
      )}
    >
      {children}
    </DialogHeader>
  );
}

export function SubscreenTitle({ className, children }) {
  const modern = useIsModernSubscreen();
  return (
    <DialogTitle
      className={cn(modern && "text-xl font-bold text-[#172033] tracking-tight", className)}
    >
      {children}
    </DialogTitle>
  );
}

export function SubscreenDescription({ className, children }) {
  const modern = useIsModernSubscreen();
  return (
    <DialogDescription
      className={cn(modern && "text-sm text-[#667085] leading-relaxed", className)}
    >
      {children}
    </DialogDescription>
  );
}

export function SubscreenBody({ className, children }) {
  const modern = useIsModernSubscreen();
  return (
    <div
      className={cn(
        "min-h-0 flex-1 flex flex-col overflow-hidden",
        modern ? "px-6 py-4 space-y-4" : "space-y-3",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SubscreenMeta({ children }) {
  const modern = useIsModernSubscreen();
  if (!children) return null;
  return (
    <p className={cn("text-xs", modern ? "text-[#667085]" : "text-slate-600")}>
      {children}
    </p>
  );
}

export function SubscreenAlert({ children }) {
  const modern = useIsModernSubscreen();
  return (
    <p
      className={cn(
        "text-xs rounded-lg px-3 py-2.5 border leading-relaxed",
        modern
          ? "text-[#0891B2] bg-[#06B6D4]/10 border-[#06B6D4]/25"
          : "text-amber-800 bg-amber-50 border-amber-200"
      )}
    >
      {children}
    </p>
  );
}

export function SubscreenFilterPanel({ children }) {
  const modern = useIsModernSubscreen();
  return (
    <div
      className={cn(
        "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3",
        modern && "rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm"
      )}
    >
      {children}
    </div>
  );
}

export function SubscreenFilterSelect({ label, value, onValueChange, children }) {
  const modern = useIsModernSubscreen();
  return (
    <div className="space-y-1 min-w-0">
      <Label
        className={cn(
          "text-xs font-semibold uppercase tracking-wider",
          modern ? "text-[#667085]" : "text-slate-600 font-medium"
        )}
      >
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={cn("h-9", modern && "border-[#E5E7EB] bg-[#F7F9FC]/80")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

export function SubscreenSearchRow({ children }) {
  const modern = useIsModernSubscreen();
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        modern && "rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-sm"
      )}
    >
      {children}
    </div>
  );
}

export function SubscreenSearchInput(props) {
  const modern = useIsModernSubscreen();
  return (
    <Input
      {...props}
      className={cn("h-9", modern && "border-[#E5E7EB] bg-[#F7F9FC]/80 focus-visible:ring-[#06B6D4]/25", props.className)}
    />
  );
}

export function SubscreenSelectionHint({ children }) {
  const modern = useIsModernSubscreen();
  return (
    <p className={cn("text-xs", modern ? "text-[#667085] font-medium" : "text-slate-600")}>
      {children}
    </p>
  );
}

export function SubscreenTableShell({ children }) {
  const modern = useIsModernSubscreen();
  return (
    <div
      className={cn(
        "overflow-auto max-h-[46vh] min-h-0",
        modern
          ? "rounded-xl border border-[#E5E7EB] bg-white shadow-sm"
          : "border border-slate-200 rounded-lg"
      )}
    >
      {children}
    </div>
  );
}

export function SubscreenLoading({ children }) {
  const modern = useIsModernSubscreen();
  return (
    <div className={cn("py-12 text-center", modern ? "px-6" : "")}>
      {modern ? (
        <div className="inline-block w-6 h-6 border-2 border-[#E5E7EB] border-t-[#06B6D4] rounded-full animate-spin mb-3" />
      ) : null}
      <p className={cn("text-sm", modern ? "text-[#667085]" : "text-slate-600")}>{children}</p>
    </div>
  );
}

export function SubscreenFooter({ className, children }) {
  const modern = useIsModernSubscreen();
  return (
    <DialogFooter
      className={cn(
        modern && "px-6 py-4 border-t border-[#E5E7EB] bg-[#F7F9FC] shrink-0 sm:justify-end gap-2",
        className
      )}
    >
      {children}
    </DialogFooter>
  );
}

export function SubscreenCancelButton(props) {
  const modern = useIsModernSubscreen();
  return (
    <Button
      variant="outline"
      {...props}
      className={cn(modern && "border-[#E5E7EB] bg-white hover:bg-[#F7F9FC]", props.className)}
    />
  );
}

export function SubscreenPrimaryButton(props) {
  const modern = useIsModernSubscreen();
  return (
    <Button
      {...props}
      className={cn(modern && "bg-[#06B6D4] hover:bg-[#0891b2] text-white shadow-sm", props.className)}
    />
  );
}
