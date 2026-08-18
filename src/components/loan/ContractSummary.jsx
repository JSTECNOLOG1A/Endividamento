import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, CreditCard, Calendar, Percent } from "lucide-react";
import {
  OPERATION_CATEGORIES,
  OPERATION_TYPES,
  PERIODICITIES,
  SYSTEMS,
  INDEXERS,
  EXCHANGE_LAGS,
  GRACE_INTEREST_BEHAVIORS,
  AMORTIZATION_TRIGGERS,
  PERCENTAGE_BASES,
  combineGuaranteeLabel,
} from "@/lib/contractOptions";

// Visão somente-leitura de TODOS os dados cadastrados no contrato
// (Identificação, Composição/Remuneração da Dívida e Prazos/Periodicidades),
// no mesmo agrupamento e nomenclatura do ContractForm — usada na tela de
// revisão/aprovação para conferir o contrato inteiro sem precisar entrar em
// modo de edição (isso continua disponível pelo botão "Editar").

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(n);
}

function formatNumber(value, minDigits = 2, maxDigits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits });
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const datePart = String(dateStr).slice(0, 10);
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year}`;
}

function labelFor(options, value, fallback = "—") {
  return options.find((o) => o.value === value)?.label || fallback;
}

function Field({ label, value, mono = false }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-sm text-slate-900 ${mono ? "font-mono" : ""}`}>
        {value === "" || value === null || value === undefined ? "—" : value}
      </p>
    </div>
  );
}

function FeeField({ label, value, financed }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm text-slate-900 font-mono">{formatCurrency(value)}</p>
      <p className="text-xs text-slate-500">{financed ? "Financiado (soma ao principal)" : "Não financiado"}</p>
    </div>
  );
}

export default function ContractSummary({ contract, groups, entities, banks, currencies }) {
  if (!contract) return null;

  const groupName = groups?.find((g) => g.id === contract.group_id)?.group_name;
  const entityName = entities?.find((e) => e.id === contract.entity_id)?.entity_name;
  const bankName = banks?.find((b) => b.id === contract.bank_id)?.bank_name;
  const currency = currencies?.find((c) => c.id === contract.currency_id);

  const categoryLabel = labelFor(OPERATION_CATEGORIES, contract.operation_category);
  const typeLabel = contract.operation_category
    ? labelFor(OPERATION_TYPES[contract.operation_category] || [], contract.operation_type)
    : "—";
  const systemLabel = labelFor(SYSTEMS, contract.calculation_system, contract.calculation_system || "—");
  const indexerLabel = labelFor(INDEXERS, contract.indexer, contract.indexer || "—");
  const principalPeriodicityLabel = labelFor(PERIODICITIES, contract.principal_frequency);
  const interestPeriodicityLabel = labelFor(PERIODICITIES, contract.interest_frequency);
  const guaranteeLabel = combineGuaranteeLabel(contract.guarantee_real_type, contract.guarantee_personal_type);

  const hasGrace = Number(contract.principal_grace_months) > 0 || Number(contract.interest_grace_months) > 0;
  const isForeignCurrency = !!contract.currency_id;
  const isPercentageResidual = contract.calculation_system === "PERCENTAGE_RESIDUAL";

  return (
    <div className="space-y-6">
      {/* Identificação */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Building2 className="w-4 h-4 text-blue-600" />
            Identificação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Grupo Econômico" value={groupName} />
            <Field label="Entidade Componente" value={entityName} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Banco Credor" value={bankName} />
            <Field label="Nº Contrato" value={contract.contract_number} mono />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Categoria da Operação" value={categoryLabel} />
            <Field label="Tipo Específico" value={typeLabel} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Garantia" value={guaranteeLabel} />
          </div>
        </CardContent>
      </Card>

      {/* Composição e Remuneração da Dívida */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <CreditCard className="w-4 h-4 text-blue-600" />
            Composição e Remuneração da Dívida
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isForeignCurrency && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Moeda" value={currency ? `${currency.currency_code} - ${currency.currency_name}` : "—"} />
                <Field label="Defasagem PTAX" value={labelFor(EXCHANGE_LAGS, String(contract.exchange_lag ?? "1"))} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Valor em Moeda Estrangeira" value={formatNumber(contract.amount_foreign)} mono />
                <Field label="Cotação do Fechamento" value={formatNumber(contract.exchange_rate_closing, 4, 4)} mono />
              </div>
            </>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Valor da Operação (R$)" value={formatCurrency(contract.operation_value)} mono />
            <Field label="(-) Sinal do Negócio (R$)" value={formatCurrency(contract.signal_value)} mono />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FeeField label="IOF (R$)" value={contract.iof_value} financed={contract.iof_financed} />
            <FeeField
              label="Valor do Encargo por Concessão de Garantia (ECG) (R$)"
              value={contract.encargo_garantia_value}
              financed={contract.encargo_garantia_financed}
            />
            <FeeField label="Taxas Diversas (R$)" value={contract.other_fees} financed={contract.other_fees_financed} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Data da Operação" value={formatDate(contract.operation_date)} mono />
            <Field label="Taxa Fixa (% a.a.)" value={formatPercent(contract.fixed_rate)} mono />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Indexador" value={indexerLabel} />
            {contract.indexer && contract.indexer !== "NA" && (
              <Field label="Spread (% a.a.)" value={formatPercent(contract.indexer_spread)} mono />
            )}
          </div>
          <Field label="Sistema de Amortização" value={systemLabel} />
        </CardContent>
      </Card>

      {/* Prazos e Periodicidades */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Calendar className="w-4 h-4 text-blue-600" />
            Prazos e Periodicidades
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Prazo Total (meses)" value={contract.total_term_months} mono />
            <Field label="Data Vencimento Final" value={formatDate(contract.final_maturity_date)} mono />
            <Field label="Dia de Referência dos Vencimentos" value={contract.first_payment_date ? formatDate(contract.first_payment_date) : "Usa a Data da Operação"} mono />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Carência Principal (meses)" value={contract.principal_grace_months ?? 0} mono />
            <Field label="Carência Juros (meses)" value={contract.interest_grace_months ?? 0} mono />
          </div>
          {hasGrace && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Comportamento dos Juros na Carência"
                value={labelFor(GRACE_INTEREST_BEHAVIORS, contract.grace_interest_behavior)}
              />
              {Number(contract.principal_grace_months) > 0 && (
                <Field
                  label="Gatilho da Primeira Amortização"
                  value={labelFor(AMORTIZATION_TRIGGERS, contract.amortization_trigger)}
                />
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Periodicidade Amortização" value={principalPeriodicityLabel} />
            <Field label="Periodicidade Juros" value={interestPeriodicityLabel} />
          </div>
        </CardContent>
      </Card>

      {/* Percentuais de Amortização (PERCENTAGE_RESIDUAL) */}
      {isPercentageResidual && (
        <Card className="border-amber-200 shadow-sm bg-amber-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-amber-900">
              <Percent className="w-4 h-4 text-amber-600" />
              Percentuais de Amortização sobre Saldo Devedor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Base de Cálculo" value={labelFor(PERCENTAGE_BASES, contract.percentage_base)} />
            <Field label="Percentuais por Parcela (%)" value={contract.amortization_percentages} mono />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
