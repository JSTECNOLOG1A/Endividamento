import React from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
//
// Layout em formato de tabela (grade de 6 colunas, cada campo ocupa 2, 3, 4
// ou 6 colunas), inspirado nos formulários de CCB dos bancos — deixa a
// revisão mais parecida com o documento original e mais fácil de conferir
// campo a campo.

// Classes de col-span literais (Tailwind precisa das strings completas no
// código-fonte para não fazer purge da classe no build).
const SPAN = {
  2: "sm:col-span-2",
  3: "sm:col-span-3",
  4: "sm:col-span-4",
  6: "sm:col-span-6",
};

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

// Uma "célula" da tabela: rótulo em caixa alta no topo, valor abaixo — a
// grade de fundo cinza (bg-slate-200 + gap-px no container) some por trás
// das células brancas e forma as linhas de grade, como numa planilha.
function Field({ label, value, mono = false, span = 3 }) {
  return (
    <div className={`bg-white px-3 py-2 ${SPAN[span] || SPAN[3]}`}>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm text-slate-900 mt-0.5 ${mono ? "font-mono" : ""}`}>
        {value === "" || value === null || value === undefined ? "—" : value}
      </p>
    </div>
  );
}

function FeeField({ label, value, financed, span = 2 }) {
  return (
    <div className={`bg-white px-3 py-2 ${SPAN[span] || SPAN[2]}`}>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-slate-900 font-mono mt-0.5">{formatCurrency(value)}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{financed ? "Financiado (soma ao principal)" : "Não financiado"}</p>
    </div>
  );
}

// Container da seção: cabeçalho com ícone/título (igual ao padrão do resto
// do app) + o "corpo de tabela" — grade de 6 colunas com linhas de 1px
// entre as células, moldura externa e cantos arredondados.
function SummarySection({ icon: Icon, title, children }) {
  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <Icon className="w-4 h-4 text-blue-600" />
          {title}
        </CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 sm:grid-cols-6 gap-px bg-slate-200">
        {children}
      </div>
    </Card>
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
  const hasSpread = !!contract.indexer && contract.indexer !== "NA";

  return (
    <div className="space-y-6">
      {/* Identificação */}
      <SummarySection icon={Building2} title="Identificação">
        <Field label="Grupo Econômico" value={groupName} />
        <Field label="Entidade Componente" value={entityName} />
        <Field label="Banco Credor" value={bankName} />
        <Field label="Nº Contrato" value={contract.contract_number} mono />
        <Field label="Categoria da Operação" value={categoryLabel} />
        <Field label="Tipo Específico" value={typeLabel} />
        <Field label="Garantia" value={guaranteeLabel} span={6} />
      </SummarySection>

      {/* Composição e Remuneração da Dívida */}
      <SummarySection icon={CreditCard} title="Composição e Remuneração da Dívida">
        {isForeignCurrency && (
          <>
            <Field label="Moeda" value={currency ? `${currency.currency_code} - ${currency.currency_name}` : "—"} />
            <Field label="Defasagem PTAX" value={labelFor(EXCHANGE_LAGS, String(contract.exchange_lag ?? "1"))} />
            <Field label="Valor em Moeda Estrangeira" value={formatNumber(contract.amount_foreign)} mono />
            <Field label="Cotação do Fechamento" value={formatNumber(contract.exchange_rate_closing, 4, 4)} mono />
          </>
        )}
        <Field label="Valor da Operação (R$)" value={formatCurrency(contract.operation_value)} mono />
        <Field label="(-) Sinal do Negócio (R$)" value={formatCurrency(contract.signal_value)} mono />
        <FeeField label="IOF (R$)" value={contract.iof_value} financed={contract.iof_financed} />
        <FeeField
          label="Valor do Encargo por Concessão de Garantia (ECG) (R$)"
          value={contract.encargo_garantia_value}
          financed={contract.encargo_garantia_financed}
        />
        <FeeField label="Taxas Diversas (R$)" value={contract.other_fees} financed={contract.other_fees_financed} />
        <Field label="Data da Operação" value={formatDate(contract.operation_date)} mono />
        <Field label="Taxa Fixa (% a.a.)" value={formatPercent(contract.fixed_rate)} mono />
        <Field label="Indexador" value={indexerLabel} span={hasSpread ? 3 : 6} />
        {hasSpread && <Field label="Spread (% a.a.)" value={formatPercent(contract.indexer_spread)} mono />}
        <Field label="Sistema de Amortização" value={systemLabel} span={6} />
      </SummarySection>

      {/* Prazos e Periodicidades */}
      <SummarySection icon={Calendar} title="Prazos e Periodicidades">
        <Field label="Prazo Total (meses)" value={contract.total_term_months} mono span={2} />
        <Field label="Data Vencimento Final" value={formatDate(contract.final_maturity_date)} mono span={2} />
        <Field
          label="Dia de Referência dos Vencimentos"
          value={contract.first_payment_date ? formatDate(contract.first_payment_date) : "Usa a Data da Operação"}
          mono
          span={2}
        />
        <Field label="Carência Principal (meses)" value={contract.principal_grace_months ?? 0} mono />
        <Field label="Carência Juros (meses)" value={contract.interest_grace_months ?? 0} mono />
        {hasGrace && (
          <>
            <Field
              label="Comportamento dos Juros na Carência"
              value={labelFor(GRACE_INTEREST_BEHAVIORS, contract.grace_interest_behavior)}
              span={Number(contract.principal_grace_months) > 0 ? 3 : 6}
            />
            {Number(contract.principal_grace_months) > 0 && (
              <Field
                label="Gatilho da Primeira Amortização"
                value={labelFor(AMORTIZATION_TRIGGERS, contract.amortization_trigger)}
              />
            )}
          </>
        )}
        <Field label="Periodicidade Amortização" value={principalPeriodicityLabel} />
        <Field label="Periodicidade Juros" value={interestPeriodicityLabel} />
      </SummarySection>

      {/* Percentuais de Amortização (PERCENTAGE_RESIDUAL) */}
      {isPercentageResidual && (
        <Card className="border-amber-200 shadow-sm bg-amber-50/30 overflow-hidden">
          <CardHeader className="px-4 py-3 border-b border-amber-200 bg-amber-50">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-amber-900">
              <Percent className="w-4 h-4 text-amber-600" />
              Percentuais de Amortização sobre Saldo Devedor
            </CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-px bg-amber-200">
            <div className="bg-amber-50/30 px-3 py-2 sm:col-span-3">
              <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Base de Cálculo</p>
              <p className="text-sm text-slate-900 mt-0.5">{labelFor(PERCENTAGE_BASES, contract.percentage_base)}</p>
            </div>
            <div className="bg-amber-50/30 px-3 py-2 sm:col-span-6">
              <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Percentuais por Parcela (%)</p>
              <p className="text-sm text-slate-900 font-mono mt-0.5">{contract.amortization_percentages || "—"}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
