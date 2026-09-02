import React from "react";
import { Layers } from "lucide-react";
import { useGroup } from "@/lib/GroupContext";
import { usePlatform } from "@/lib/PlatformContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function EmptyHint({ collapsed, message }) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            className="w-full flex items-center justify-center rounded-lg p-2.5 text-slate-500 opacity-60"
            aria-label={message}
          >
            <Layers className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{message}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <p className="text-[11px] text-slate-500 px-1 leading-snug">
      {message}
    </p>
  );
}

export default function ModernGroupSelector({ collapsed = false, className }) {
  const { viewingAll } = usePlatform();
  const { groups, groupId, currentGroup, loading, enabled, selectGroup } = useGroup();

  if (viewingAll) {
    return (
      <EmptyHint
        collapsed={collapsed}
        message="Selecione um cliente para escolher o grupo econômico."
      />
    );
  }

  if (!enabled) return null;

  if (loading && !groups.length) {
    return (
      <EmptyHint collapsed={collapsed} message="Carregando grupos..." />
    );
  }

  if (!groups.length) {
    return (
      <EmptyHint
        collapsed={collapsed}
        message="Nenhum grupo econômico cadastrado."
      />
    );
  }

  if (collapsed) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "w-full flex items-center justify-center rounded-lg p-2.5",
                  "text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors",
                  groupId && "text-[#67E8F9]"
                )}
                aria-label="Grupo econômico"
              >
                <Layers className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">
            {currentGroup?.group_name || "Grupo econômico"}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Grupo econômico
          </DropdownMenuLabel>
          {groups.map((group) => (
            <DropdownMenuItem
              key={group.id}
              onClick={() => selectGroup(group.id)}
              className={cn(group.id === groupId && "font-medium text-[#0891B2]")}
            >
              {group.group_name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 px-1">
        Grupo econômico
      </label>
      <Select value={groupId || undefined} onValueChange={selectGroup}>
        <SelectTrigger className="h-9 w-full border-white/10 bg-white/[0.06] text-white text-xs hover:bg-white/[0.08] focus:ring-[#06B6D4]/30">
          <SelectValue placeholder="Selecione o grupo" />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.group_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
