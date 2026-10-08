import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { createPageUrl } from "@/utils";
import { formatCivilDate } from "@/lib/taxDates";
import { GUIDE_URL_PARAM } from "@/lib/taxGuides";
import { canWriteTax, formatMoney } from "@/lib/taxLabels";
import { ESTIMATE_SHORT_NOTE } from "@/lib/taxPlanning";
import { GuideStatusBadge, InstallmentStatusBadge } from "./TaxBadges";
import { TaxTitleBadge, TaxTitleLink } from "./TaxTitleStatus";

const PAGE_BY_SPHERE = { federal: "TaxFederal", estadual: "TaxState" };

/** Endereço do parcelamento (e, com `withGuide`, da guia da parcela) na lista da esfera. */
export function planningInstallmentLink(item, { withGuide = false } = {}) {
  const params = new URLSearchParams({ acordo: item.agreement_id });
  if (withGuide) params.set(GUIDE_URL_PARAM, item.id);
  return `${createPageUrl(PAGE_BY_SPHERE[item.esfera] || "TaxFederal")}?${params.toString()}`;
}

/** A guia do planejamento vem como `{ id, situacao }`; sem guia vinculada nem em exceção não há guia a mostrar. */
function guideOf(item) {
  return item.guia?.id ? { situacao: item.guia.situacao } : null;
}

/** Valor da parcela como o planejamento conta: o da guia ou o estimado (a pagar), ou o pago. */
export function PlanningAmount({ item, align = "right" }) {
  const alignClass = align === "right" ? "sm:text-right" : "";
  if (item.conta_em === "pago") {
    return (
      <span className={cn("block leading-tight", alignClass)}>
        {item.valor_pago === null ? (
          <span className="block text-xs font-medium text-amber-800">Paga, valor não informado</span>
        ) : (
          <span className="block text-sm font-semibold tabular-nums text-emerald-700">{formatMoney(item.valor_pago)}</span>
        )}
        <span className="block text-[11px] text-slate-500">
          {item.data_pagamento ? `pago em ${formatCivilDate(item.data_pagamento)}` : "pago"}
        </span>
      </span>
    );
  }
  const fromGuide = item.origem_valor === "guia";
  return (
    <span className={cn("block leading-tight", alignClass)}>
      <span className={cn("block text-sm font-semibold tabular-nums", item.conta_em === "vencida" ? "text-rose-700" : "text-slate-900")}>
        {formatMoney(item.valor_para_pagamento)}
      </span>
      {fromGuide ? (
        <span className="block whitespace-nowrap text-[11px] text-slate-500">pela guia · estimado {formatMoney(item.valor_estimado)}</span>
      ) : (
        <span className="block whitespace-nowrap text-[11px] font-medium text-amber-800" title={ESTIMATE_SHORT_NOTE}>
          estimado, sem guia
        </span>
      )}
    </span>
  );
}

/** Uma parcela do calendário: de onde vem, quanto e quando, situação, guia e título — com atalho para o detalhe. */
export default function TaxPlanningInstallment({ item, today, showDate = true }) {
  const { user } = useAuth();
  const guide = guideOf(item);
  // Sem guia, o atalho serve para incluir uma — só para quem pode alterar.
  const showGuideLink = item.conta_em !== "pago" && (guide || canWriteTax(user));
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium text-slate-900">{item.entity_name}</p>
        <p className="text-xs text-slate-600">
          {item.orgao_label} · nº {item.codigo_parcelamento} · parcela {item.numero_parcela}
          {item.qtd_parcelas ? ` de ${item.qtd_parcelas}` : ""}
        </p>
        <p className="text-xs text-slate-500">
          {item.tributo || item.modalidade}
          {item.tributo && item.modalidade ? ` · ${item.modalidade}` : ""}
          {showDate ? (
            <span className={cn("tabular-nums", item.conta_em === "vencida" && "font-semibold text-rose-700")}>
              {" "}· vence {formatCivilDate(item.vencimento)}
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <InstallmentStatusBadge installment={{ situacao: item.situacao, vencimento: item.vencimento }} today={today} />
          {item.conta_em === "pago" ? null : <GuideStatusBadge guide={guide} />}
          {item.titulo ? <TaxTitleBadge title={item.titulo} /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          <Link
            to={planningInstallmentLink(item)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 underline-offset-2 hover:underline"
          >
            Abrir parcelamento <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
          {showGuideLink ? (
            <Link
              to={planningInstallmentLink(item, { withGuide: true })}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline-offset-2 hover:underline"
            >
              <FileText className="h-3 w-3" aria-hidden="true" />
              {guide ? "Ver guia" : "Incluir guia"}
            </Link>
          ) : null}
          {item.titulo ? <TaxTitleLink title={item.titulo} /> : null}
        </div>
      </div>
      <div className="shrink-0">
        <PlanningAmount item={item} />
      </div>
    </div>
  );
}
