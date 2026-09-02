import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Combobox } from "@/components/ui/combobox";
import { Calculator, Building2, FileText, Percent, Calendar, CreditCard, AlertCircle, Info, Paperclip, Trash2, Save, Send, Banknote, Receipt, LayoutList } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


import {
  OPERATION_CATEGORIES,
  OPERATION_TYPES,
  PERIODICITIES,
  SYSTEMS,
  GUARANTEE_REAL_TYPES,
  GUARANTEE_PERSONAL_TYPES,
} from "@/lib/contractOptions";

const defaultForm = {
  group_id: "",
  entity_id: "",
  bank_id: "",
  currency_id: "",
  exchange_lag: "1",
  contract_number: "",
  operation_category: "",
  operation_type: "",
  guarantee_real_type: "",
  guarantee_personal_type: "",
  operation_value: "",
  amount_foreign: "",
  exchange_rate_closing: "",
  signal_value: "0",
  iof_value: "0",
  iof_financed: false,
  encargo_garantia_value: "0",
  encargo_garantia_financed: false,
  other_fees: "0",
  other_fees_financed: false,
  fixed_rate: "",
  indexer: "NA",
  indexer_spread: "0",
  operation_date: new Date().toISOString().split("T")[0],
  calculation_system: "SAC",
  total_term_months: "",
  final_maturity_date: "",
  principal_grace_months: "0",
  interest_grace_months: "0",
  grace_action: "capitalizar",
  grace_interest_behavior: "CAPITALIZAR", // NOVO: "CAPITALIZAR", "INTEREST_ONLY", "BALLOON"
  amortization_trigger: "END_OF_GRACE", // NOVO: "END_OF_GRACE" ou "GRACE_PLUS_FREQ"
  principal_periodicity: "1",
  interest_periodicity: "1",
  first_payment_date: "",
  amortization_percentages: "", // Ex: "24.18,28.09,32.72,38.18"
  percentage_base: "saldo_devedor", // "saldo_devedor" ou "principal"
};

// Helper: Converter string BR (2.000.000,00) para número
const parseBRNumber = (str) => {
  if (!str) return 0;
  const cleaned = String(str).replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
};

// Numeral discreto antes do ícone de cada seção principal (Identificação /
// Composição / Prazos) — reforça a leitura de "passo 1, 2, 3" do formulário
// sem precisar de um wizard de verdade (o usuário continua vendo tudo numa
// tela só, mas a numeração ajuda a orientar por onde começar).
function SectionBadge({ n }) {
  return (
    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold shrink-0">
      {n}
    </span>
  );
}

// Sub-título interno usado para dividir a seção "Composição e Remuneração da
// Dívida" (a mais longa das três) em blocos menores e escaneáveis — sem criar
// Cards separados, que quebrariam o agrupamento de 3 seções pedido.
function SubsectionHeading({ icon: Icon, children }) {
  return (
    <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 uppercase tracking-wide">
      <Icon className="w-3.5 h-3.5 text-blue-600" />
      {children}
    </h4>
  );
}

export default function ContractForm({ onCalculate, onIdentificationChange, initialData, groups, entities, banks, currencies, loadingRates, cdiRates, isEditing = false, isCalculating = false, uploadedPdfUrl, onPdfUpload, isUploadingPdf, draftKey = "new", hasResult = false, onSaveDraft, onSubmitForReview, isSaving = false }) {
  const [form, setForm] = useState(defaultForm);
  const [initialForm, setInitialForm] = useState(defaultForm);
  const [isLoaded, setIsLoaded] = useState(false);
  const [draftBanner, setDraftBanner] = useState(null);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState(null);
  const draftStorageKey = `endividamento_draft_${draftKey}`;

  // Update form when initialData changes
  React.useEffect(() => {
    if (initialData) {
      const newForm = {
        group_id: initialData.group_id || "",
        entity_id: initialData.entity_id || "",
        bank_id: initialData.bank_id || "",
        currency_id: initialData.currency_id || "",
        exchange_lag: initialData.exchange_lag !== undefined ? initialData.exchange_lag.toString() : "1",
        contract_number: initialData.contract_number || "",
        operation_category: initialData.operation_category || "",
        operation_type: initialData.operation_type || "",
        guarantee_real_type: initialData.guarantee_real_type || "",
        guarantee_personal_type: initialData.guarantee_personal_type || "",
        operation_value: initialData.operation_value || "",
        amount_foreign: initialData.amount_foreign || "",
        exchange_rate_closing: initialData.exchange_rate_closing || "",
        signal_value: initialData.signal_value || "0",
        iof_value: initialData.iof_value || "0",
        iof_financed: initialData.iof_financed || false,
        encargo_garantia_value: initialData.encargo_garantia_value || "0",
        encargo_garantia_financed: initialData.encargo_garantia_financed || false,
        other_fees: initialData.other_fees || "0",
        other_fees_financed: initialData.other_fees_financed || false,
        fixed_rate: initialData.fixed_rate || "",
        indexer: initialData.indexer || "NA",
        indexer_spread: initialData.indexer_spread || "0",
        operation_date: initialData.operation_date || new Date().toISOString().split("T")[0],
        calculation_system: initialData.calculation_system || "SAC",
        total_term_months: initialData.total_term_months !== undefined && initialData.total_term_months !== null ? initialData.total_term_months.toString() : "",
        final_maturity_date: initialData.final_maturity_date || "",
        principal_grace_months: initialData.principal_grace_months || "0",
        interest_grace_months: initialData.interest_grace_months || "0",
        grace_action: initialData.grace_action || "capitalizar",
        grace_interest_behavior: initialData.grace_interest_behavior || (initialData.grace_action === "pagar" ? "INTEREST_ONLY" : "CAPITALIZAR"),
        amortization_trigger: initialData.amortization_trigger || "END_OF_GRACE",
        principal_periodicity: initialData.principal_frequency || initialData.principal_periodicity || "1",
        interest_periodicity: initialData.interest_frequency || initialData.interest_periodicity || "1",
        first_payment_date: initialData.first_payment_date || "",
        amortization_percentages: initialData.amortization_percentages || "",
        percentage_base: initialData.percentage_base || "saldo_devedor",
      };
      setForm(newForm);
      setInitialForm(newForm);
      setTimeout(() => setIsLoaded(true), 100);
    } else {
      setForm(defaultForm);
      setInitialForm(defaultForm);
      setIsLoaded(true);
    }
  }, [initialData]);

  // Mantém o pai (Simulator) sincronizado com os campos de Identificação em
  // tempo real, e não só no momento em que o usuário clica em "Calcular".
  // Sem isso, se o usuário reabre um contrato, ajusta Grupo/Entidade/Banco/
  // Nº Contrato e clica direto em "Salvar" (sem recalcular), essas edições
  // ficam presas no estado local do ContractForm e nunca chegam ao
  // `formParams` do Simulator — o contrato é salvo com os dados antigos
  // (ou vazios), dando a impressão de que a Identificação "sumiu".
  React.useEffect(() => {
    if (!isLoaded) return;
    onIdentificationChange?.({
      group_id: form.group_id,
      entity_id: form.entity_id,
      bank_id: form.bank_id,
      contract_number: form.contract_number,
      operation_category: form.operation_category,
      operation_type: form.operation_type,
      guarantee_real_type: form.guarantee_real_type,
      guarantee_personal_type: form.guarantee_personal_type,
    });
  }, [
    isLoaded,
    form.group_id,
    form.entity_id,
    form.bank_id,
    form.contract_number,
    form.operation_category,
    form.operation_type,
    form.guarantee_real_type,
    form.guarantee_personal_type,
  ]);

  // Ao carregar (novo formulário ou contrato aberto para edição), verificar se existe
  // um rascunho salvo automaticamente que difere do estado atual, e oferecer restauração.
  //
  // Dois filtros evitam que o aviso apareça sem necessidade (era o caso
  // antes: qualquer tentativa de "novo contrato" abandonada — mesmo sem
  // nada de relevante preenchido — ficava presa para sempre na chave
  // compartilhada "endividamento_draft_new" e voltava a aparecer em TODA
  // tentativa seguinte de criar um contrato novo, mesmo meses depois):
  //  1. Só mostra se o rascunho tem conteúdo substantivo (Grupo/Entidade/
  //     Banco/Nº Contrato/Valor) — não só os valores padrão do formulário.
  //  2. Rascunhos com mais de 24h são descartados silenciosamente (o
  //     usuário provavelmente nem lembra mais deles).
  const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  React.useEffect(() => {
    if (!isLoaded) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      const ageMs = parsed?.savedAt ? Date.now() - new Date(parsed.savedAt).getTime() : Infinity;
      const isStale = !Number.isFinite(ageMs) || ageMs > DRAFT_MAX_AGE_MS;
      const f = parsed?.form;
      const hasSubstantiveContent = !!(
        f && (f.group_id || f.entity_id || f.bank_id || f.contract_number ||
          (f.operation_value && f.operation_value !== "0"))
      );

      if (isStale || !hasSubstantiveContent) {
        localStorage.removeItem(draftStorageKey);
        return;
      }

      if (JSON.stringify(f) !== JSON.stringify(form)) {
        setDraftBanner(parsed);
      }
    } catch (err) {
      console.error("Erro ao ler rascunho salvo:", err);
    }
  }, [draftStorageKey, isLoaded]);

  // Salvar rascunho automaticamente (com debounce) sempre que o formulário mudar,
  // para não perder o preenchimento em andamento caso a aba seja fechada/recarregada.
  React.useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(draftStorageKey, JSON.stringify({ form, savedAt }));
        setLastAutoSavedAt(savedAt);
      } catch (err) {
        console.error("Erro ao salvar rascunho automático:", err);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [form, isLoaded, draftStorageKey]);

  const handleRestoreDraft = () => {
    if (draftBanner?.form) {
      setForm(draftBanner.form);
    }
    setDraftBanner(null);
  };

  const handleDiscardDraft = () => {
    try {
      localStorage.removeItem(draftStorageKey);
    } catch (err) {
      console.error("Erro ao descartar rascunho:", err);
    }
    setDraftBanner(null);
  };

  const hasChanges = JSON.stringify(form) !== JSON.stringify(initialForm);

  // Calcular data final do bullet (data operação + prazo total)
  const [updatingFromDate, setUpdatingFromDate] = React.useState(false);

  // Lê uma data "YYYY-MM-DD" (como vem dos inputs type="date" / do form)
  // como data LOCAL. `new Date("YYYY-MM-DD")` é interpretado pelo JS como
  // meia-noite em UTC — em fusos atrás de UTC (ex.: Brasil, UTC-3), ao ler
  // de volta com getDate()/getMonth() isso "volta" um dia (15 vira 14).
  // Evita esse problema clássico.
  const parseDateOnly = (dateStr) => {
    if (!dateStr) return null;
    const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  // Formata uma data local de volta para "YYYY-MM-DD" sem passar por UTC
  // (evita o mesmo problema de fuso na direção contrária).
  const toDateOnlyString = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // Soma meses a uma data travando o fim de mês (evita overflow: 31/01 + 1
  // mês = 28/02, não 03/03) — espelha addMonths() do CalculationEngine.js,
  // para o rascunho de "Data Vencimento Final" aqui no formulário já bater
  // com a data que o motor vai efetivamente gerar na última parcela.
  const addMonthsClamped = (date, months) => {
    const nominalDay = date.getDate();
    const d = new Date(date.getFullYear(), date.getMonth(), 1);
    d.setMonth(d.getMonth() + months);
    const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(nominalDay, lastDayOfTargetMonth));
    return d;
  };

  // O motor de cálculo (CalculationEngine.js) sempre ancora as parcelas no
  // dia do "Primeiro Vencimento" (quando preenchido) ou no dia da
  // "Data da Operação" (quando vazio) — nunca no dia da própria Data
  // Vencimento Final. E a 1ª parcela da tabela já nasce EM CIMA dessa data
  // âncora (não um mês depois) quando o Primeiro Vencimento está preenchido.
  // Por isso, para a última parcela da tabela cair exatamente na Data
  // Vencimento Final informada:
  //   • Com Primeiro Vencimento preenchido: total de parcelas = nº de meses
  //     entre o Primeiro Vencimento e o Vencimento Final, + 1 (a 1ª parcela
  //     já é o próprio Primeiro Vencimento, "mês 0").
  //   • Sem Primeiro Vencimento: total de parcelas = nº de meses entre a
  //     Operação e o Vencimento Final (a 1ª parcela é 1 mês após a Operação,
  //     sem +1).
  React.useEffect(() => {
    if (!isLoaded || updatingFromDate) return;
    if (form.operation_date && form.total_term_months) {
      const hasReference = !!form.first_payment_date;
      const anchorDate = parseDateOnly(hasReference ? form.first_payment_date : form.operation_date);
      if (!anchorDate) return;
      const n = parseInt(form.total_term_months) || 0;
      const monthsToAdd = hasReference ? n - 1 : n;
      const finalDate = addMonthsClamped(anchorDate, monthsToAdd);
      setUpdatingFromDate(true);
      update("final_maturity_date", toDateOnlyString(finalDate));
      setTimeout(() => setUpdatingFromDate(false), 50);
    }
  }, [form.operation_date, form.first_payment_date, form.total_term_months, isLoaded]);

  // Recalcular prazo total quando data final é editada (ver explicação acima)
  const handleFinalDateChange = (dateStr) => {
    update("final_maturity_date", dateStr);
    if (!dateStr) return;
    const hasReference = !!form.first_payment_date;
    const anchorStr = hasReference ? form.first_payment_date : form.operation_date;
    if (!anchorStr) return;
    const anchorDate = parseDateOnly(anchorStr);
    const finalDate = parseDateOnly(dateStr);
    if (!anchorDate || !finalDate) return;
    const monthsDiff = (finalDate.getFullYear() - anchorDate.getFullYear()) * 12 +
                       (finalDate.getMonth() - anchorDate.getMonth());
    const totalInstallments = hasReference ? monthsDiff + 1 : monthsDiff;
    if (totalInstallments > 0) {
      setUpdatingFromDate(true);
      update("total_term_months", totalInstallments.toString());
      setTimeout(() => setUpdatingFromDate(false), 50);
    }
  };

  // Texto de apoio abaixo do "Prazo Total (Meses)": só aparece quando o
  // Primeiro Vencimento está preenchido, caso em que esse número é o total
  // de meses/linhas do cronograma (inclui o próprio Primeiro Vencimento como
  // 1ª linha) — 1 a mais que a duração "redonda" do contrato entre o
  // Primeiro Vencimento e a Data Vencimento Final. Puramente informativo:
  // não altera nenhum valor calculado ou salvo, só ajuda a entender o
  // número exibido (e evita confundir esse total com "Quantidade de
  // Parcelas", que é outro campo, calculado à parte na revisão).
  const totalTermDurationHint = React.useMemo(() => {
    if (!form.first_payment_date) return null;
    const n = parseInt(form.total_term_months) || 0;
    if (n <= 1) return null;
    return `≈ ${n - 1} meses de duração (Primeiro Vencimento → Data Vencimento Final). O Prazo Total de ${n} inclui o próprio Primeiro Vencimento como 1ª linha da tabela — a Quantidade de Parcelas (na revisão) pode ser 1 a menos se houver carência sem pagamento no início.`;
  }, [form.total_term_months, form.first_payment_date]);

  // Desabilitar campos conforme sistema selecionado
  const getFieldsStatus = () => {
    const system = form.calculation_system;
    return {
      principalPeriodicity: system === "SAC" || system === "PERCENTAGE_RESIDUAL",
      interestPeriodicity: system === "AMERICANO" || system === "PERCENTAGE_RESIDUAL",
      principalGrace: system !== "BULLET",
      interestGrace: system !== "BULLET",
      totalTerm: true, // Sempre habilitado (incluindo BULLET)
    };
  };

  const fieldsStatus = getFieldsStatus();

  // Sincronizar periodicidade apenas quando sistema muda, não constantemente
  const [prevSystem, setPrevSystem] = React.useState(form.calculation_system);
  
  React.useEffect(() => {
    if (!isLoaded || prevSystem === form.calculation_system) return;
    
    setPrevSystem(form.calculation_system);
    
    if (form.calculation_system === "SAC") {
      update("interest_periodicity", form.principal_periodicity);
    } else if (form.calculation_system === "PRICE") {
      update("principal_periodicity", "1");
      update("interest_periodicity", "1");
    } else if (form.calculation_system === "BULLET") {
      update("principal_periodicity", "bullet");
      update("interest_periodicity", "bullet");
      update("principal_grace_months", "0");
      update("interest_grace_months", "0");
    }
  }, [form.calculation_system, isLoaded]);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const selectedGroup = groups?.find((g) => g.id === form.group_id);
  const filteredEntities = form.group_id ? entities?.filter((e) => e.group_id === form.group_id) : [];
  const selectedEntity = form.entity_id ? entities?.find((e) => e.id === form.entity_id) : null;
  const missingData = !form.group_id || !form.entity_id || !form.bank_id;
  const selectedSystem = SYSTEMS.find((s) => s.value === form.calculation_system);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validação: Se moeda estrangeira, campos obrigatórios
    if (form.currency_id && (!form.amount_foreign || !form.exchange_rate_closing)) {
      alert("⚠️ Para operações em moeda estrangeira, preencha o Valor em Moeda Estrangeira e a Cotação do Fechamento.");
      return;
    }
    
    // Buscar taxas PTAX USD da entidade Currency se necessário
    let exchangeRates = [];
    if (form.currency_id) {
      try {
        const allCurrencies = await base44.entities.Currency.list("rate_date", 10000);
        const usdRates = allCurrencies
          .filter(c => c.currency_code === "USD")
          .map(c => ({
            rate_date: c.rate_date,
            ptax_rate: c.exchange_rate,
            source: "bacen",
            created_at: c.created_date
          }))
          .sort((a, b) => a.rate_date.localeCompare(b.rate_date));
        
        if (usdRates.length === 0) {
          alert("⚠️ Nenhuma taxa PTAX USD cadastrada. Por favor, importe as taxas na aba 'Indexadores e Feriados' antes de calcular contratos USD.");
          return;
        }
        
        exchangeRates = usdRates;
      } catch (error) {
        alert(`Erro ao carregar taxas PTAX: ${error.message}`);
        return;
      }
    }
    
    // Calcular qtd de parcelas baseado no prazo total e periodicidade
    const totalMonths = parseInt(form.total_term_months) || 0;
    const principalGrace = parseInt(form.principal_grace_months) || 0;
    const principalPeriod = parseInt(form.principal_periodicity) || 1;
    const interestPeriod = parseInt(form.interest_periodicity) || 1;
    
    const principalInstallments = form.calculation_system === "BULLET" 
      ? 1 
      : Math.ceil((totalMonths - principalGrace) / principalPeriod);
    const interestInstallments = form.calculation_system === "BULLET" 
      ? 1 
      : Math.ceil(totalMonths / interestPeriod);

    // Helper: Normalizar parse BR (com validação de null/undefined)
    const parseBR = (s) => {
      if (s === null || s === undefined) return null;
      const v = String(s).trim();
      if (!v) return null;
      return parseFloat(v.replace(/\./g, '').replace(',', '.'));
    };

    // 🔍 DEBUG: Validar USD antes do cálculo (expandido)
    if (form.currency_id) {
      const af_parsed = parseBR(form.amount_foreign);
      const er_parsed = parseBR(form.exchange_rate_closing);
      
      console.log('🔍 Validação USD PRÉ-CÁLCULO:', {
        currencyId: form.currency_id,
        amount_foreign_raw: form.amount_foreign,
        amount_foreign_type_raw: typeof form.amount_foreign,
        amount_foreign_parsed: af_parsed,
        amount_foreign_type_parsed: typeof af_parsed,
        amount_foreign_is_finite: Number.isFinite(af_parsed),
        amount_foreign_gt_zero: af_parsed > 0,
        exchange_rate_closing_raw: form.exchange_rate_closing,
        exchange_rate_closing_parsed: er_parsed
      });
      
      // Validação inline antes de enviar
      if (!Number.isFinite(af_parsed) || af_parsed <= 0) {
        alert(`⚠️ ERRO DE VALIDAÇÃO USD:\n\nValor em moeda estrangeira inválido.\n\nRaw: "${form.amount_foreign}"\nParsed: ${af_parsed}\n\nVerifique o preenchimento do campo.`);
        return;
      }
    }

    onCalculate({
      ...form,
      operation_value: parseFloat(form.operation_value || '0') || 0,
      amount_foreign: parseBR(form.amount_foreign),
      exchange_rate_closing: parseBR(form.exchange_rate_closing),
      signal_value: parseFloat(form.signal_value.replace(/\./g, '').replace(',', '.')) || 0,
      iof_value: parseFloat(form.iof_value.replace(/\./g, '').replace(',', '.')) || 0,
      encargo_garantia_value: parseFloat(form.encargo_garantia_value.replace(/\./g, '').replace(',', '.')) || 0,
      other_fees: parseFloat(form.other_fees.replace(/\./g, '').replace(',', '.')) || 0,
      fixed_rate: parseFloat(form.fixed_rate.replace(/\./g, '').replace(',', '.')) || 0,
      indexer_spread: parseFloat(form.indexer_spread.replace(/\./g, '').replace(',', '.')) || 0,
      principal_grace_months: parseInt(form.principal_grace_months) || 0,
      interest_grace_months: parseInt(form.interest_grace_months) || 0,
      principal_installments: principalInstallments,
      interest_installments: interestInstallments,
      principal_frequency: form.principal_periodicity,
      interest_frequency: form.interest_periodicity,
      first_payment_date: form.first_payment_date || null,
      total_term_months: parseInt(form.total_term_months) || 0,
      final_maturity_date: form.final_maturity_date || null,
      amortization_percentages: form.amortization_percentages || "",
      percentage_base: form.percentage_base || "saldo_devedor",
      grace_interest_behavior: form.grace_interest_behavior || "CAPITALIZAR",
      amortization_trigger: form.amortization_trigger || "END_OF_GRACE",
      currencyId: form.currency_id || null,
      exchangeLag: parseInt(form.exchange_lag) || 1,
      exchangeRates: exchangeRates,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {draftBanner && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-900">
              Encontramos um rascunho não salvo
              {draftBanner.savedAt ? ` de ${new Date(draftBanner.savedAt).toLocaleString("pt-BR")}` : ""}.
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Parece que você saiu no meio da edição. Deseja continuar de onde parou?
            </p>
            <div className="flex gap-2 mt-2">
              <Button type="button" size="sm" onClick={handleRestoreDraft} className="h-7 text-xs">
                Continuar rascunho
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={handleDiscardDraft} className="h-7 text-xs text-amber-700">
                Descartar
              </Button>
            </div>
          </div>
        </div>
      )}
      {lastAutoSavedAt && !draftBanner && (
        <p className="text-[11px] text-slate-500 -mb-2">
          Rascunho salvo automaticamente às {new Date(lastAutoSavedAt).toLocaleTimeString("pt-BR")}
        </p>
      )}
      {/* Seção A: Identificação */}
      {/*
        Nos Selects de Entidade, Banco e Tipo Específico abaixo, o
        onValueChange está protegido com `v && update(...)` (ignora string
        vazia). Isso corrige um bug confirmado (via stack trace) do Radix
        Select: quando esses campos são preenchidos programaticamente pelo
        `initialData` (reabrir um contrato) e, logo em seguida, o Select
        muda de "desabilitado sem opção correspondente" para "habilitado
        com a opção certa" (Entidade depende de Grupo, Tipo depende de
        Categoria), o <select> nativo escondido que o Radix usa por baixo
        dispara um evento de change espúrio com valor vazio, limpando o
        campo que acabara de ser preenchido corretamente — mesmo o dado no
        banco estando certo. Como nenhum SelectItem real usa value="", é
        seguro ignorar esses valores vazios aqui.
      */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <SectionBadge n={1} />
            <Building2 className="w-4 h-4 text-blue-600" />
            Identificação
          </CardTitle>
          <CardDescription className="text-xs text-slate-600 pl-7">
            Grupo, entidade, banco credor e garantias do contrato.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Grupo Econômico *</Label>
              <Combobox
                value={form.group_id || ""}
                onChange={(v) => update("group_id", v)}
                options={(groups || []).map((g) => ({ value: g.id, label: g.group_name }))}
                placeholder="Selecione"
                searchPlaceholder="Buscar grupo..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Entidade Componente *</Label>
              <Combobox
                value={form.entity_id || ""}
                onChange={(v) => v && update("entity_id", v)}
                options={(filteredEntities || []).map((e) => ({ value: e.id, label: e.entity_name }))}
                disabled={!form.group_id}
                placeholder={form.group_id ? "Selecione" : "Selecione um grupo primeiro"}
                searchPlaceholder="Buscar entidade..."
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Banco Credor *</Label>
              <Combobox
                value={form.bank_id || ""}
                onChange={(v) => v && update("bank_id", v)}
                options={(banks || []).map((b) => ({ value: b.id, label: b.bank_name }))}
                placeholder="Selecione"
                searchPlaceholder="Buscar banco..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Nº Contrato *</Label>
              <Input value={form.contract_number} onChange={(e) => update("contract_number", e.target.value)} placeholder="000.000.000" className="h-9" required />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Categoria da Operação *</Label>
              <Select 
                value={form.operation_category} 
                onValueChange={(v) => {
                  update("operation_category", v);
                  update("operation_type", "");
                }}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {OPERATION_CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Tipo Específico *</Label>
              <Select 
                value={form.operation_type}
                onValueChange={(v) => v && update("operation_type", v)}
                disabled={!form.operation_category}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={form.operation_category ? "Selecione" : "Escolha categoria primeiro"} />
                </SelectTrigger>
                <SelectContent>
                  {form.operation_category && OPERATION_TYPES[form.operation_category]?.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Garantia Real
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">Garantias focadas em bens e direitos (Alienação Fiduciária, Hipoteca, Penhor, Cessão de Recebíveis)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Select value={form.guarantee_real_type || ""} onValueChange={(v) => update("guarantee_real_type", v === "none" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Sem garantia real" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem garantia real</SelectItem>
                  {GUARANTEE_REAL_TYPES.map((g) => (<SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Garantia Pessoal / Fidejussória
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">Garantias focadas em pessoas (Aval, Fiança)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Select value={form.guarantee_personal_type || ""} onValueChange={(v) => update("guarantee_personal_type", v === "none" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Sem garantia pessoal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem garantia pessoal</SelectItem>
                  {GUARANTEE_PERSONAL_TYPES.map((g) => (<SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {missingData && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Preencha grupo, entidade e banco antes de calcular.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seção B: Composição e Remuneração da Dívida */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <SectionBadge n={2} />
            <CreditCard className="w-4 h-4 text-blue-600" />
            Composição e Remuneração da Dívida
          </CardTitle>
          <CardDescription className="text-xs text-slate-600 pl-7">
            Moeda, valores, custos da operação e como a dívida é remunerada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Moeda e Defasagem PTAX - Primeiro Bloco */}
          <SubsectionHeading icon={Banknote}>Moeda e Câmbio</SubsectionHeading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Moeda (Opcional)</Label>
              <Select value={form.currency_id || ""} onValueChange={(v) => update("currency_id", v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="BRL (Padrão)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>BRL (Padrão)</SelectItem>
                  {currencies?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.currency_code} - {c.currency_name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {form.currency_id && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                  Defasagem PTAX
                  <TooltipProvider>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">
                          Quantos dias antes da data de cada evento (vencimento, apropriação) o sistema busca a
                          cotação PTAX usada na variação cambial. "D" usa a cotação do próprio dia.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Label>
                <Select value={form.exchange_lag} onValueChange={(v) => update("exchange_lag", v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">D (Mesma data)</SelectItem>
                    <SelectItem value="1">D-1 (Dia anterior)</SelectItem>
                    <SelectItem value="2">D-2 (Dois dias antes)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          
          {/* Campos de Moeda Estrangeira */}
          {form.currency_id && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                    Valor em Moeda Estrangeira * 
                    <TooltipProvider>
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-xs">Valor líquido captado na moeda estrangeira (fonte de verdade)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <CurrencyInput 
                    type="currency" 
                    value={form.amount_foreign} 
                    onChange={(e) => {
                      update("amount_foreign", e.target.value);
                      // Calcular operation_value em tempo real
                      const foreign = parseBRNumber(e.target.value);
                      const rate = parseBRNumber(form.exchange_rate_closing);
                      if (foreign > 0 && rate > 0) {
                        const brl = (foreign * rate).toFixed(4);
                        update("operation_value", brl);
                      }
                    }}
                    placeholder="0,00" 
                    className="h-9" 
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                    Cotação do Fechamento *
                    <TooltipProvider>
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-xs">Taxa fixada no fechamento da operação com o banco (pode incluir spread)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <CurrencyInput 
                    type="exchange_rate" 
                    value={form.exchange_rate_closing} 
                    onChange={(e) => {
                      const newRate = e.target.value;
                      update("exchange_rate_closing", newRate);
                      
                      // Calcular operation_value em tempo real
                      const foreign = parseBRNumber(form.amount_foreign);
                      const rate = parseBRNumber(newRate);
                      if (foreign > 0 && rate > 0) {
                        const brl = (foreign * rate).toFixed(4);
                        update("operation_value", brl);
                      }
                    }}
                    placeholder="0,0000" 
                    className="h-9" 
                  />
                  {(() => {
                    const rate = parseFloat(form.exchange_rate_closing || '0');
                    if (!isNaN(rate) && rate > 0 && (rate < 2.0 || rate > 10.0)) {
                      return (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Taxa fora do range usual (2,00 - 10,00)
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
              
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                  Valor Convertido (R$) - Calculado Automaticamente
                </Label>
                <div className="h-9 px-3 rounded-md border border-slate-200 bg-slate-50 flex items-center text-sm text-slate-600">
                  {(() => {
                    const foreign = parseBRNumber(form.amount_foreign);
                    const rate = parseBRNumber(form.exchange_rate_closing);
                    if (foreign > 0 && rate > 0) {
                      const brl = foreign * rate;
                      return `R$ ${brl.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
                    }
                    return "—";
                  })()}
                </div>
                <p className="text-xs text-slate-600">
                  Este valor será usado como "Valor da Operação" (R$)
                </p>
              </div>
            </>
          )}
          
          <Separator />

          <SubsectionHeading icon={Receipt}>Custos da Operação</SubsectionHeading>
          {/* Valor da Operação e Sinal */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Valor da Operação (R$) *
                {form.currency_id && (
                  <span className="ml-1 text-xs text-blue-600 font-normal">(Calculado automaticamente)</span>
                )}
              </Label>
              <CurrencyInput 
                type="currency" 
                value={form.operation_value} 
                onChange={(e) => update("operation_value", e.target.value)} 
                placeholder="0,00" 
                className="h-9" 
                disabled={!!form.currency_id}
                required 
              />
              {form.currency_id && (
                <p className="text-xs text-slate-600">
                  Este campo é somente leitura quando operação em moeda estrangeira
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">(-) Sinal do Negócio (R$)</Label>
              <CurrencyInput type="currency" value={form.signal_value} onChange={(e) => update("signal_value", e.target.value)} className="h-9" />
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-lg border border-slate-100 bg-slate-50/70 p-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                 <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                   IOF (R$)
                   <TooltipProvider>
                     <Tooltip delayDuration={200}>
                       <TooltipTrigger asChild>
                         <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                       </TooltipTrigger>
                       <TooltipContent side="right" className="max-w-xs">
                         <p className="text-xs">
                           Imposto sobre Operações Financeiras cobrado pelo banco na operação. Se "financiado",
                           soma-se ao saldo devedor inicial; senão, é custo à parte, fora do cronograma.
                         </p>
                       </TooltipContent>
                     </Tooltip>
                   </TooltipProvider>
                 </Label>
                 <CurrencyInput type="currency" value={form.iof_value} onChange={(e) => update("iof_value", e.target.value)} className="h-9" />
               </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.iof_financed} onCheckedChange={(v) => update("iof_financed", v)} />
                <Label className="text-xs text-slate-600">IOF financiado (somar ao principal)</Label>
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                 <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                   Valor do Encargo por Concessão de Garantia (ECG) (R$)
                   <TooltipProvider>
                     <Tooltip delayDuration={200}>
                       <TooltipTrigger asChild>
                         <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                       </TooltipTrigger>
                       <TooltipContent side="right" className="max-w-xs">
                         <p className="text-xs">
                           Taxa cobrada pelo banco por aceitar a garantia oferecida na operação (comum em BNDES/FINAME
                           e crédito rural). Se "financiado", soma-se ao saldo devedor inicial.
                         </p>
                       </TooltipContent>
                     </Tooltip>
                   </TooltipProvider>
                 </Label>
                 <CurrencyInput type="currency" value={form.encargo_garantia_value} onChange={(e) => update("encargo_garantia_value", e.target.value)} className="h-9" />
               </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.encargo_garantia_financed} onCheckedChange={(v) => update("encargo_garantia_financed", v)} />
                <Label className="text-xs text-slate-600">ECG financiado (somar ao principal)</Label>
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                 <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                   Taxas Diversas (R$)
                   <TooltipProvider>
                     <Tooltip delayDuration={200}>
                       <TooltipTrigger asChild>
                         <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                       </TooltipTrigger>
                       <TooltipContent side="right" className="max-w-xs">
                         <p className="text-xs">
                           Outras tarifas/taxas cobradas na contratação (ex.: análise de crédito, cadastro,
                           avaliação de garantia) que não se encaixam em IOF ou ECG.
                         </p>
                       </TooltipContent>
                     </Tooltip>
                   </TooltipProvider>
                 </Label>
                 <CurrencyInput type="currency" value={form.other_fees} onChange={(e) => update("other_fees", e.target.value)} className="h-9" />
               </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.other_fees_financed} onCheckedChange={(v) => update("other_fees_financed", v)} />
                <Label className="text-xs text-slate-600">Taxas financiadas</Label>
              </div>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Data da Operação *
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">
                        Data de assinatura/desembolso do contrato. Se o "Primeiro Vencimento" abaixo ficar
                        vazio, esta data também vira o ponto de partida para contar as parcelas.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Input type="date" value={form.operation_date} onChange={(e) => update("operation_date", e.target.value)} className="h-9" required />
            </div>
          </div>
          <Separator />
          <SubsectionHeading icon={Percent}>Taxa e Indexação</SubsectionHeading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Taxa Fixa (% a.a.) *</Label>
              <CurrencyInput type="percent" value={form.fixed_rate} onChange={(e) => update("fixed_rate", e.target.value)} placeholder="0,0000" className="h-9" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Taxa Mensal Equivalente</Label>
              <div className="h-9 px-3 rounded-md border border-slate-200 bg-slate-50 flex items-center text-sm text-slate-600">
                {form.fixed_rate && !isNaN(parseFloat(form.fixed_rate)) 
                  ? `${((Math.pow(1 + parseFloat(form.fixed_rate) / 100, 1/12) - 1) * 100).toFixed(4)}% a.m.`
                  : "—"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Indexador</Label>
              <Select value={form.indexer} onValueChange={(v) => update("indexer", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NA">N/A (Prefixado)</SelectItem>
                  <SelectItem value="CDI">CDI</SelectItem>
                  <SelectItem value="SELIC">SELIC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.indexer !== "NA" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Spread (% a.a.)</Label>
                <CurrencyInput type="percent" value={form.indexer_spread} onChange={(e) => update("indexer_spread", e.target.value)} className="h-9" />
              </div>
            )}
          </div>
          <Separator />
          <div className="space-y-2">
            <SubsectionHeading icon={LayoutList}>Sistema de Amortização</SubsectionHeading>
            <Select value={form.calculation_system} onValueChange={(v) => update("calculation_system", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SYSTEMS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Descrição do sistema escolhido: antes só aparecia num tooltip
                ao passar o mouse sobre cada botão — agora fica sempre visível
                abaixo do dropdown, sem depender de hover (nenhuma informação
                perdida na troca para lista suspensa). */}
            {selectedSystem && (
              <p className="text-xs text-slate-600 leading-relaxed rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                {selectedSystem.description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Seção C: Prazos e Periodicidades */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <SectionBadge n={3} />
            <Calendar className="w-4 h-4 text-blue-600" />
            Prazos e Periodicidades
          </CardTitle>
          <CardDescription className="text-xs text-slate-600 pl-7">
            Prazo total, datas de vencimento, carências e frequência de pagamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Prazo Total (meses) *
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">
                        Total de meses/linhas gerados no cronograma — determina onde cai a Data Vencimento
                        Final. Quando o Primeiro Vencimento está preenchido, a 1ª linha da tabela já nasce
                        na própria data do Primeiro Vencimento (não um mês depois), então esse total fica 1
                        a mais que os meses entre o Primeiro Vencimento e a Data Vencimento Final (ex.: um
                        contrato de 5 anos = 60 meses de duração gera Prazo Total = 61). Não confundir com
                        "Quantidade de Parcelas" (na tela de revisão): esse outro campo conta só as linhas
                        com pagamento efetivo, que pode ser 1 a menos quando há carência sem pagamento no
                        início.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Input
                type="number"
                min="1"
                value={form.total_term_months}
                onChange={(e) => update("total_term_months", e.target.value)}
                className="h-9"
                disabled={!fieldsStatus.totalTerm}
                required
              />
              {(form.calculation_system === "BULLET" || form.calculation_system === "AMERICANO") && (
                <p className="text-xs text-slate-600 mt-1">
                  {form.calculation_system === "BULLET" ? "Define quando ocorre o pagamento único" : "Define quando cai a amortização completa"}
                </p>
              )}
              {totalTermDurationHint && (
                <p className="text-xs text-slate-600 mt-1">{totalTermDurationHint}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Data Vencimento Final {(form.calculation_system === "AMERICANO" || form.calculation_system === "BULLET") && "(Pagamento Final)"}
              </Label>
              <Input 
                type="date" 
                value={form.final_maturity_date} 
                onChange={(e) => handleFinalDateChange(e.target.value)} 
                className="h-9" 
                disabled={!fieldsStatus.totalTerm}
              />
              <p className="text-xs text-slate-600">Calculado automaticamente, editável</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Primeiro Vencimento
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">
                        Data informada para fixar as datas de vencimento mensais — o cálculo da tabela usará
                        sempre o mesmo dia informado (ex.: 10/04, 10/05…), a menos que caia em final de semana
                        ou feriado, quando só adia aquele mês. Se deixado vazio, usa a Data da Operação como
                        referência.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Input
                type="date"
                value={form.first_payment_date}
                onChange={(e) => update("first_payment_date", e.target.value)}
                className="h-9"
                placeholder="Se vazio, usa a Data da Operação"
              />
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Carência Principal (meses)
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">
                        Meses em que só há apropriação/pagamento de juros — a amortização do principal só começa
                        depois desse período (o "Gatilho da Primeira Amortização" abaixo define exatamente quando).
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Input
                type="number" 
                min="0" 
                value={form.principal_grace_months} 
                onChange={(e) => update("principal_grace_months", e.target.value)} 
                className="h-9" 
                disabled={!fieldsStatus.principalGrace}
              />
              {!fieldsStatus.principalGrace && (
                <p className="text-xs text-slate-600">Não aplicável neste sistema</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Carência Juros (meses)
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">
                        Meses em que os juros apropriados não são pagos em caixa — o "Comportamento dos Juros na
                        Carência" abaixo define se eles capitalizam no saldo, se são pagos à parte, ou se acumulam
                        para pagar depois (balloon).
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Input
                type="number" 
                min="0" 
                value={form.interest_grace_months} 
                onChange={(e) => update("interest_grace_months", e.target.value)} 
                className="h-9" 
                disabled={!fieldsStatus.interestGrace}
              />
              {!fieldsStatus.interestGrace && (
                <p className="text-xs text-slate-600">Não aplicável neste sistema</p>
              )}
            </div>
          </div>
          {(parseInt(form.interest_grace_months) > 0 && fieldsStatus.interestGrace) && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                  Comportamento dos Juros na Carência
                  <TooltipProvider>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">
                          O que acontece com os juros apropriados durante a carência: Capitalizar soma ao saldo
                          devedor (juros sobre juros); Pagar Juros exige desembolso mensal já na carência; Balloon
                          acumula juros simples à parte para quitar depois.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Label>
                <Select
                  value={form.grace_interest_behavior} 
                  onValueChange={(v) => {
                    // Bloquear PRICE + BALLOON
                    if (form.calculation_system === "PRICE" && v === "BALLOON") {
                      alert("⚠️ Sistema PRICE é incompatível com BALLOON. Use CAPITALIZAR ou INTEREST_ONLY.");
                      return;
                    }
                    update("grace_interest_behavior", v);
                  }}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CAPITALIZAR">
                      <div className="py-1">
                        <div className="font-semibold">Capitalizar (Anatocismo)</div>
                        <div className="text-xs text-slate-600">Juros sobre juros - SD cresce</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="INTEREST_ONLY">
                      <div className="py-1">
                        <div className="font-semibold">Pagar Juros (Interest Only)</div>
                        <div className="text-xs text-slate-600">PMT = juros mensais, SD estático</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="BALLOON" disabled={form.calculation_system === "PRICE"}>
                      <div className="py-1">
                        <div className="font-semibold">Balloon (Juros Simples)</div>
                        <div className="text-xs text-slate-600">Acumula juros simples para pagar depois</div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {form.grace_interest_behavior === "CAPITALIZAR" && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    Anatocismo: Juros capitalizados geram juros sobre juros
                  </div>
                )}
              </div>
              {parseInt(form.principal_grace_months) > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                    Gatilho da Primeira Amortização
                    <TooltipProvider>
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 inline-block ml-1 text-slate-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-xs">
                            Define a data exata da 1ª parcela de amortização, contada a partir do fim da carência
                            de principal — as três opções abaixo mudam só esse detalhe de contagem.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Select value={form.amortization_trigger} onValueChange={(v) => update("amortization_trigger", v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="END_OF_GRACE">
                        <div className="py-1">
                          <div className="font-semibold">Fim da Carência</div>
                          <div className="text-xs text-slate-600">1ª PMT = último dia da carência</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="GRACE_PLUS_FREQ">
                        <div className="py-1">
                          <div className="font-semibold">Carência + Periodicidade</div>
                          <div className="text-xs text-slate-600">1ª PMT = carência + 1 frequência</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="NEXT_MONTH">
                        <div className="py-1">
                          <div className="font-semibold">Mês Subsequente</div>
                          <div className="text-xs text-slate-600">1ª PMT = carência + 1 mês fixo</div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-600">Define quando cai a primeira parcela de amortização</p>
                </div>
              )}
            </div>
          )}
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Periodicidade Amortização</Label>
              <Select 
                value={form.principal_periodicity} 
                onValueChange={(v) => update("principal_periodicity", v)}
                disabled={!fieldsStatus.principalPeriodicity}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODICITIES.map((p) => (<SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>))}
                </SelectContent>
              </Select>
              {!fieldsStatus.principalPeriodicity && (
                <p className="text-xs text-slate-600">
                  {form.calculation_system === "PRICE" && "Travado como Mensal (PRICE)"}
                  {form.calculation_system === "AMERICANO" && "Amortização só ao final"}
                  {form.calculation_system === "BULLET" && "Pagamento único final"}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Periodicidade Juros</Label>
              <Select 
                value={form.interest_periodicity} 
                onValueChange={(v) => update("interest_periodicity", v)}
                disabled={!fieldsStatus.interestPeriodicity}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODICITIES.map((p) => (<SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>))}
                </SelectContent>
              </Select>
              {!fieldsStatus.interestPeriodicity && (
                <p className="text-xs text-slate-600">
                  {form.calculation_system === "SAC" && "Segue periodicidade da amortização"}
                  {form.calculation_system === "PRICE" && "Travado como Mensal (PRICE)"}
                  {form.calculation_system === "BULLET" && "Pagamento único final"}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seção D: Percentuais de Amortização (PERCENTAGE_RESIDUAL) */}
      {form.calculation_system === "PERCENTAGE_RESIDUAL" && (
        <Card className="border-amber-200 shadow-sm bg-amber-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-amber-900">
              <Percent className="w-4 h-4 text-amber-600" />
              Percentuais de Amortização sobre Saldo Devedor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-amber-700 uppercase tracking-wider">Base de Cálculo</Label>
              <Select value={form.percentage_base} onValueChange={(v) => update("percentage_base", v)}>
                <SelectTrigger className="h-9 border-amber-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="saldo_devedor">% sobre Saldo Devedor (início do período)</SelectItem>
                  <SelectItem value="principal">% sobre Principal Original</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-amber-600">
                {form.percentage_base === "saldo_devedor" 
                  ? "Percentual incide sobre o saldo devedor no início de cada período"
                  : "Percentual incide sobre o valor do principal original (fixo)"}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                Percentuais por Parcela (%)
              </Label>
              <Input
                value={form.amortization_percentages}
                onChange={(e) => update("amortization_percentages", e.target.value)}
                placeholder="Ex: 24.18, 28.09, 32.72, 38.18"
                className="h-9 border-amber-300"
              />
              <p className="text-xs text-amber-600">
                Insira os percentuais separados por vírgula. Ex: primeira parcela 24,18%, segunda 28,09%, etc.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {/* Upload PDF Section */}
        {uploadedPdfUrl ? (
          <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-slate-900">PDF anexado</p>
                <a 
                  href={uploadedPdfUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Visualizar PDF
                </a>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm("Deseja remover o PDF anexado?")) {
                  onPdfUpload(null);
                }
              }}
              className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="file"
              id="pdf-upload"
              accept="application/pdf"
              onChange={(e) => onPdfUpload(e.target.files[0])}
              disabled={isUploadingPdf}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={isUploadingPdf}
              className="w-full h-12 text-base font-semibold border-2 border-dashed border-blue-300 hover:border-blue-500 hover:bg-blue-50 disabled:opacity-70"
              onClick={() => document.getElementById('pdf-upload').click()}
            >
              <Paperclip className="w-5 h-5 mr-2" />
              {isUploadingPdf ? "Fazendo upload..." : "Anexar arquivo (PDF)"}
            </Button>
          </div>
        )}

        <Button 
          type="submit" 
          size="lg" 
          disabled={isCalculating}
          className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-base font-semibold shadow-lg shadow-blue-600/20 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          <Calculator className="w-5 h-5 mr-2" />
          {isCalculating ? "Calculando..." : (isEditing ? "Recalcular contrato" : "Calcular contrato")}
        </Button>
        {isCalculating && (
          <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 animate-pulse" style={{ width: "100%" }} />
          </div>
        )}

        {/* Salvar/Enviar ficam logo abaixo de Calcular — próximos o bastante
            para o usuário enxergar o próximo passo sem procurar em outra
            parte da tela. Ficam desabilitados até existir um cálculo (result)
            porque é dele que vem o cronograma que será persistido. */}
        {(onSaveDraft || onSubmitForReview) && (
          <div className="grid grid-cols-2 gap-2">
            {onSaveDraft && (
              <Button
                type="button"
                variant="outline"
                disabled={!hasResult || isSaving}
                onClick={onSaveDraft}
                className="gap-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                title={!hasResult ? "Calcule o contrato antes de salvar" : undefined}
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? "Salvando..." : "Salvar como Rascunho"}
              </Button>
            )}
            {onSubmitForReview && (
              <Button
                type="button"
                disabled={!hasResult || isSaving}
                onClick={onSubmitForReview}
                className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                title={!hasResult ? "Calcule o contrato antes de enviar" : undefined}
              >
                <Send className="w-3.5 h-3.5" />
                {isSaving ? "Enviando..." : "Enviar para Revisão"}
              </Button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}