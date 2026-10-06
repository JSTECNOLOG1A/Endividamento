import React from "react";
import { ExternalLink, History, Mail } from "lucide-react";
import { taxGuidesApi } from "@/api/taxGuides";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/notify";
import { openPdfInNewTab } from "@/lib/documentActions";
import { formatCivilDate } from "@/lib/taxDates";
import { formatMoney } from "@/lib/taxLabels";
import { formatDateTime, guideClosingLabel, guideOriginLabel, joinList, sendResultLabel } from "@/lib/taxGuides";
import { useGuideSends } from "@/hooks/useTaxData";
import { GuideStatusBadge } from "./TaxBadges";

export async function openGuidePdf(guide) {
  try {
    await openPdfInNewTab(() => taxGuidesApi.file(guide.id), guide.arquivo_nome || "Guia");
  } catch (error) {
    toast.error(error.message);
  }
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </h4>
  );
}

/** Guias anteriores da parcela (substituídas ou removidas). */
export function PreviousGuides({ guides }) {
  if (!guides?.length) return null;
  return (
    <section className="space-y-2">
      <SectionTitle icon={History}>Guias anteriores</SectionTitle>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {guides.map((guide) => (
          <li key={guide.id} className="space-y-1 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800">{guideClosingLabel(guide)}</span>
              <span className="text-slate-500">
                em {formatDateTime(guide.encerrada_em)}
                {guide.encerrada_por ? ` por ${guide.encerrada_por}` : ""}
              </span>
              <GuideStatusBadge guide={guide} />
            </div>
            <p className="break-all font-mono text-[11px] text-slate-700">
              {guide.linha_digitavel_formatada || <span className="font-sans text-slate-400">Linha digitável não lida</span>}
            </p>
            <p className="text-slate-500">
              {guideOriginLabel(guide)}
              {guide.valor_guia !== null && guide.valor_guia !== undefined ? ` · valor da guia ${formatMoney(guide.valor_guia)}` : ""}
              {guide.pagar_ate ? ` · pagar até ${formatCivilDate(guide.pagar_ate)}` : ""}
              {` · anexada em ${formatDateTime(guide.created_date)}`}
            </p>
            {guide.tem_arquivo ? (
              <Button type="button" variant="link" size="sm" className="h-auto gap-1 p-0 text-xs" onClick={() => openGuidePdf(guide)}>
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir PDF
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

const RESULT_STYLES = {
  enviado: "border-emerald-200 bg-emerald-50 text-emerald-700",
  parcial: "border-amber-300 bg-amber-50 text-amber-800",
  falhou: "border-rose-200 bg-rose-50 text-rose-700",
};

/** Envios por e-mail das guias desta parcela: quando, para quem, por quem e o resultado. */
export function GuideSendHistory({ installmentId }) {
  const { sends, isLoading, error, refetch } = useGuideSends(installmentId);
  return (
    <section className="space-y-2">
      <SectionTitle icon={Mail}>Envios por e-mail</SectionTitle>
      {isLoading ? (
        <p className="text-xs text-slate-500">Carregando envios…</p>
      ) : error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <p>Não foi possível carregar os envios. {error.message}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2 h-7 bg-white text-xs" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : sends.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum envio por e-mail desta parcela.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {sends.map((send) => (
            <li key={send.id} className="space-y-1 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                    RESULT_STYLES[send.resultado] || RESULT_STYLES.falhou
                  )}
                >
                  {sendResultLabel(send.resultado)}
                </span>
                <span className="text-slate-500">{formatDateTime(send.created_date)}</span>
              </div>
              {send.mensagem_resultado ? <p className="break-words text-slate-700">{send.mensagem_resultado}</p> : null}
              <p className="break-words text-slate-700">
                Para {joinList(send.destinatarios)}
                {send.recusados?.length ? <span className="text-amber-800"> · recusado: {joinList(send.recusados)}</span> : null}
              </p>
              <p className="text-slate-500">
                Por {send.enviado_por_nome || send.enviado_por || "—"} · {send.com_anexo ? "com o PDF anexo" : "sem anexo (só a linha digitável)"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
