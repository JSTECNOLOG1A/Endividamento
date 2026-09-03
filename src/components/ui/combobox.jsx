import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Select com filtro por digitação — mesmo comportamento visual/de valor do
// <Select> (shadcn) usado no resto do formulário, mas com uma caixa de busca
// no topo da lista. Feito pra campos cuja lista de opções pode ficar grande
// (Banco Credor com as ~110 instituições do BACEN, Grupo Econômico, Entidade
// Componente) — em listas curtas e fixas (Categoria da Operação, Garantia,
// Indexador etc.) o <Select> comum continua sendo a escolha certa, digitar
// pra filtrar 3 opções só atrapalha.
//
// options: [{ value: string, label: string }]
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Selecione",
  searchPlaceholder = "Digite para buscar...",
  emptyText = "Nenhum resultado encontrado.",
  disabled = false,
  className,
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options?.find((o) => o.value === value);
  const displayLabel = selected?.label || (value ? String(value) : null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between font-normal",
            !displayLabel && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{displayLabel || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            // itemValue é o `value` do CommandItem (setamos como o label, não
            // o id) — assim a busca acha pelo texto que a pessoa está vendo,
            // não pelo id interno.
            return itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options?.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
