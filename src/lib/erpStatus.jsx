import React from "react";

export const ERP_STATUS_META = {
  pendente: {
    label: "Pendente",
    dot: "bg-amber-400",
    text: "text-amber-800",
  },
  integrado: {
    label: "Integrado",
    dot: "bg-emerald-500",
    text: "text-emerald-800",
  },
  falha: {
    label: "Falha",
    dot: "bg-rose-500",
    text: "text-rose-800",
  },
  estornado: {
    label: "Estornado",
    dot: "bg-slate-400",
    text: "text-slate-700",
  },
  baixado: {
    label: "Baixado",
    dot: "bg-sky-500",
    text: "text-sky-800",
  },
};

export function erpStatusOf(item) {
  const value = String(item?.erp_status || "").trim().toLowerCase();
  if (ERP_STATUS_META[value]) return value;
  if (item?.integrado_erp) return "integrado";
  return "pendente";
}

export function ErpStatusBadge({ item }) {
  const status = erpStatusOf(item);
  const meta = ERP_STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={item?.erp_mensagem || meta.label}
    >
      <span className={`inline-block size-2.5 rounded-full ${meta.dot}`} />
      <span className={`text-xs font-medium ${meta.text}`}>{meta.label}</span>
    </span>
  );
}

export function ErpStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
      {Object.entries(ERP_STATUS_META).map(([key, meta]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      ))}
    </div>
  );
}
