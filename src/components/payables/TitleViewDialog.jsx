import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErpStatusBadge } from "@/lib/erpStatus";

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "—";
  const text = String(value).slice(0, 10);
  const [year, month, day] = text.split("-");
  if (!year || !month || !day) return text;
  return `${day}/${month}/${year}`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return formatDate(value);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value, mono = false, span = false }) {
  return (
    <div className={span ? "sm:col-span-2" : ""}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm text-slate-800 break-words ${mono ? " text-xs" : ""}`}>
        {value || "—"}
      </p>
    </div>
  );
}

export default function TitleViewDialog({
  open,
  onOpenChange,
  title,
  natures = [],
  consulting = false,
}) {
  if (!title) return null;

  const nature = natures.find((item) => item.codigo === title.natureza);
  const supplier = [title.fornecedor, title.fornecedor_nome].filter(Boolean).join(" — ") || "—";
  const customer = [title.cliente, title.cliente_nome].filter(Boolean).join(" — ") || "—";
  const isReceivable = title.cliente != null || title.cliente_nome != null;
  const natureText = title.natureza
    ? (nature?.descricao ? `${title.natureza} — ${nature.descricao}` : title.natureza)
    : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>
              Título {title.prefixo} {title.titulo_numero}
              {title.parcela ? ` / ${title.parcela}` : ""}
            </span>
            <ErpStatusBadge item={title} />
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 py-1">
          <Field label="Entidade" value={title.entity_name} span />
          <Field label="Prefixo" value={title.prefixo} mono />
          <Field label="Número" value={title.titulo_numero} mono />
          <Field label="Parcela" value={title.parcela} mono />
          <Field label="Tipo" value={title.tipo} mono />
          <Field label={isReceivable ? "Filial (E1_FILIAL)" : "Filial (E2_FILIAL)"} value={title.filial} mono />
          <Field label={isReceivable ? "Filial de origem (E1_FILORIG)" : "Filial de origem (E2_FILORIG)"} value={title.filial_origem} mono />
          {isReceivable ? (
            <Field label="Cliente" value={customer} span />
          ) : (
            <Field label="Fornecedor" value={supplier} span />
          )}
          <Field label="Emissão" value={formatDate(title.emissao)} />
          <Field label="Vencimento" value={formatDate(title.vencimento)} />
          <Field label="Valor" value={formatMoney(title.valor)} />
          <Field label="Saldo" value={formatMoney(title.saldo)} />
          <Field label="Situação" value={
            title.status === "baixado" ? "Baixado" : title.status === "cancelado" ? "Cancelado" : "Aberto"
          } />
          <Field label="Natureza" value={natureText} span />
          <Field label="Histórico" value={title.historico} span />
          <Field label="Origem" value={title.origem} />
          <Field label="Integrado em" value={title.integrado_erp_em ? formatDateTime(title.integrado_erp_em) : "—"} />
          <Field label="Consultado no ERP" value={title.erp_consultado_em ? formatDateTime(title.erp_consultado_em) : "—"} />
          {consulting ? (
            <Field label="Atualização" value="Consultando o Protheus…" span />
          ) : null}
          {title.erp_mensagem ? (
            <Field label="Mensagem do ERP" value={title.erp_mensagem} span />
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
