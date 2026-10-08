import React, { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PLANNING_DURATIONS, PLANNING_SPHERES, hasNarrowingFilters, monthName, planningFilterOptions, startMonthOptions } from "@/lib/taxPlanning";

const ALL = "todas";

function FilterSelect({ id, label, value, onChange, allLabel, options, disabled }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</Label>
      <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? "" : next)} disabled={disabled}>
        <SelectTrigger id={id} className="h-9 bg-white"><SelectValue /></SelectTrigger>
        <SelectContent>
          {allLabel ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
          {options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Filtros do planejamento: período (a partir de qual mês e por quantos meses), empresa, esfera, tributo e órgão.
 * As opções vêm dos parcelamentos ativos; se não carregarem, os filtros ficam travados com o aviso (o período segue).
 */
export default function TaxPlanningFilters({ filters, currentMonth, sources, onChange, onClear }) {
  const monthOptions = useMemo(() => {
    const options = startMonthOptions(currentMonth);
    // Mês vindo de um link fora da faixa oferecida continua visível no campo.
    return options.some((item) => item.value === filters.inicio)
      ? options
      : [{ value: filters.inicio, label: monthName(filters.inicio) }, ...options];
  }, [currentMonth, filters.inicio]);
  const durationOptions = PLANNING_DURATIONS.map((value) => ({ value: String(value), label: `${value} meses` }));
  const options = useMemo(
    () => planningFilterOptions(sources.agreements, sources.entities, { esfera: filters.esfera }),
    [sources.agreements, sources.entities, filters.esfera]
  );
  const optionsUnavailable = Boolean(sources.error) || sources.isLoading;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <FilterSelect id="planejamento-inicio" label="A partir de" value={filters.inicio} onChange={(value) => onChange({ inicio: value })} options={monthOptions} />
        <FilterSelect
          id="planejamento-meses"
          label="Período"
          value={String(filters.meses)}
          onChange={(value) => onChange({ meses: value })}
          options={durationOptions}
        />
        <FilterSelect
          id="planejamento-empresa"
          label="Empresa"
          value={filters.empresa}
          onChange={(value) => onChange({ empresa: value })}
          allLabel="Todas as empresas"
          options={options.empresas}
          disabled={optionsUnavailable}
        />
        <FilterSelect
          id="planejamento-esfera"
          label="Esfera"
          value={filters.esfera}
          // O órgão depende da esfera: trocar a esfera limpa o órgão escolhido.
          onChange={(value) => onChange({ esfera: value, orgao: "" })}
          allLabel="Federal e estadual"
          options={PLANNING_SPHERES}
        />
        <FilterSelect
          id="planejamento-tributo"
          label="Tributo"
          value={filters.tributo}
          onChange={(value) => onChange({ tributo: value })}
          allLabel="Todos os tributos"
          options={options.tributos}
          disabled={optionsUnavailable}
        />
        <FilterSelect
          id="planejamento-orgao"
          label="Órgão"
          value={filters.orgao}
          onChange={(value) => onChange({ orgao: value })}
          allLabel="Todos os órgãos"
          options={options.orgaos}
          disabled={optionsUnavailable}
        />
      </div>
      {sources.error ? (
        <p className="mt-2 text-xs text-rose-700">
          Não foi possível carregar as empresas, os tributos e os órgãos para filtrar.{" "}
          <button type="button" className="font-medium underline" onClick={sources.refetch}>Tentar novamente</button>
        </p>
      ) : null}
      {hasNarrowingFilters(filters) ? (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="ghost" size="sm" className="gap-1 text-slate-600" onClick={onClear}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Limpar filtros
          </Button>
        </div>
      ) : null}
    </div>
  );
}
