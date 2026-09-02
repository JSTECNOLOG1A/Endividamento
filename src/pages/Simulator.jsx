import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RotateCcw, X, FileText, Trash2, AlertTriangle, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import ContractForm from "../components/loan/ContractForm";
import AmortizationTable from "../components/loan/AmortizationTable";
import ScheduleChart from "../components/loan/ScheduleChart";
import EngineTestSuite from "../components/loan/EngineTestSuite";
import SnapshotValidationTest from "../components/loan/SnapshotValidationTest";
import ZeroRiskRegressionTest from "../components/loan/ZeroRiskRegressionTest";
import IntegrityValidator from "../components/loan/IntegrityValidator";
import ScenarioTests from "../components/loan/ScenarioTests";
import { calculateAmortizationSchedule } from "../lib/runCalculation";
import { toBRDecimalString } from "../lib/brNumber";
import { useLayoutMode } from "@/lib/LayoutContext";

export default function Simulator() {
  const navigate = useNavigate();
  const { layoutMode } = useLayoutMode();
  const isModernLayout = layoutMode === "modern";
  const [result, setResult] = useState(null);
  const [formParams, setFormParams] = useState(null);
  const [lastCalculatedParams, setLastCalculatedParams] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("tabela");
  const [reopenData, setReopenData] = useState(null);
  const [editingContractId, setEditingContractId] = useState(null);
  const [editingContractMeta, setEditingContractMeta] = useState(null);
  const [recalcFlag, setRecalcFlag] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [uploadedPdfUrl, setUploadedPdfUrl] = useState(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);

  // Load CDI rates for calculation
  const { data: cdiRates, isLoading: loadingRates } = useQuery({
    queryKey: ["cdi-rates"],
    queryFn: () => base44.entities.CDIRate.list("rate_date", 10000),
    initialData: [],
    staleTime: 5 * 60 * 1000,
  });

  // Load holidays for business day calculations
  const { data: holidays, isLoading: loadingHolidays } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => base44.entities.Holiday.list("", 10000),
    initialData: [],
    staleTime: 5 * 60 * 1000,
  });

  const { data: groups, isLoading: loadingGroups } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("", 100),
    initialData: [],
  });

  const { data: entities, isLoading: loadingEntities } = useQuery({
    queryKey: ["entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 100),
    initialData: [],
  });

  const { data: banks, isLoading: loadingBanks } = useQuery({
    queryKey: ["banks"],
    queryFn: () => base44.entities.Bank.list("", 100),
    initialData: [],
  });

  const loadContractForEdit = React.useCallback(async (contractId) => {
    try {
      const contract = await base44.entities.LoanContract.get(contractId);
      const scheduleData = JSON.parse(contract.schedule_data);

      // Parsear exchange_rates ANTES de montar o objeto, para que o mesmo
      // objeto sirva tanto para inicializar o formulário (reopenData) quanto
      // para os botões de Salvar/Enviar (formParams) — sem essa peça faltando.
      let parsedExchangeRates = null;
      if (contract.exchange_rates) {
        try {
          parsedExchangeRates = JSON.parse(contract.exchange_rates);
        } catch (err) {
          console.error("Erro ao parsear exchange_rates do contrato:", err);
        }
      }

      // contractFormData: valores NUMÉRICOS (ou string com PONTO decimal),
      // no mesmo formato que o payload processado do submit do ContractForm
      // (o que sai de handleSubmit → onCalculate). É isso que formParams/
      // lastCalculatedParams precisam conter, pois persistContract() e
      // handleRecalculate() enviam esses valores DIRETO pro backend/engine,
      // sem passar pelo parser BR do formulário.
      const contractFormData = {
        group_id: contract.group_id,
        entity_id: contract.entity_id,
        bank_id: contract.bank_id,
        currency_id: contract.currency_id || "",
        exchange_lag: contract.exchange_lag !== undefined ? contract.exchange_lag : 1,
        // Alias em camelCase — é o que persistContract() lê ao montar os
        // dados para salvar (mesmo padrão usado pelo submit do ContractForm).
        exchangeLag: contract.exchange_lag !== undefined ? contract.exchange_lag : 1,
        exchange_rates: contract.exchange_rates || null,
        exchangeRates: parsedExchangeRates,
        contract_number: contract.contract_number || "",
        operation_category: contract.operation_category || "",
        operation_type: contract.operation_type || "",
        guarantee_real_type: contract.guarantee_real_type || "",
        guarantee_personal_type: contract.guarantee_personal_type || "",
        operation_value: contract.operation_value?.toString() || "",
        amount_foreign: contract.amount_foreign || null,
        exchange_rate_closing: contract.exchange_rate_closing || null,
        signal_value: contract.signal_value ?? 0,
        iof_value: contract.iof_value ?? 0,
        iof_financed: contract.iof_financed || false,
        encargo_garantia_value: contract.encargo_garantia_value ?? 0,
        encargo_garantia_financed: contract.encargo_garantia_financed || false,
        other_fees: contract.other_fees ?? 0,
        other_fees_financed: contract.other_fees_financed || false,
        fixed_rate: contract.fixed_rate ?? 0,
        indexer: contract.indexer || "NA",
        indexer_spread: contract.indexer_spread ?? 0,
        operation_date: contract.operation_date || new Date().toISOString().split("T")[0],
        first_payment_date: contract.first_payment_date || "",
        principal_grace_months: contract.principal_grace_months || 0,
        interest_grace_months: contract.interest_grace_months || 0,
        grace_action: contract.grace_action || "capitalizar",
        grace_interest_behavior: contract.grace_interest_behavior || (contract.grace_action === "pagar" ? "INTEREST_ONLY" : "CAPITALIZAR"),
        amortization_trigger: contract.amortization_trigger || "END_OF_GRACE",
        principal_installments: contract.principal_installments || "",
        interest_installments: contract.interest_installments || contract.principal_installments || "",
        principal_frequency: contract.principal_frequency || "1",
        interest_frequency: contract.interest_frequency || "1",
        calculation_system: contract.calculation_system || "SAC",
        total_term_months: contract.total_term_months !== undefined && contract.total_term_months !== null ? contract.total_term_months : "",
        final_maturity_date: contract.final_maturity_date || "",
        amortization_percentages: contract.amortization_percentages || "",
        percentage_base: contract.percentage_base || "saldo_devedor",
      };

      // reopenFormData: mesmos dados, mas para USO EXCLUSIVO como `initialData`
      // do <ContractForm>. O ContractForm guarda tudo como STRING no seu
      // estado local e, ao clicar em Calcular, faz o parse assumindo formato
      // BR (vírgula decimal, ponto como separador de milhar):
      //   form.fixed_rate.replace(/\./g, '').replace(',', '.')
      // Se aqui alimentarmos esse campo com Number.toString() (que usa PONTO
      // decimal, ex. "18.15"), o parser remove o ponto como se fosse
      // separador de milhar e infla o valor em 10x-1000x (18.15 → "1815" →
      // 1815%). Isso só se manifesta depois de salvar e reabrir o contrato
      // (na criação, o usuário sempre digita no formato BR direto no
      // campo) — daí o FINANCIAL_INTEGRITY_ERROR aparecer só nesse fluxo.
      // Por isso, para os campos que passam por esse parser, convertemos
      // para string com VÍRGULA decimal antes de entregar ao formulário.
      const reopenFormData = {
        ...contractFormData,
        amount_foreign: contract.amount_foreign ? toBRDecimalString(contract.amount_foreign) : null,
        exchange_rate_closing: contract.exchange_rate_closing ? toBRDecimalString(contract.exchange_rate_closing) : null,
        signal_value: toBRDecimalString(contract.signal_value ?? 0),
        iof_value: toBRDecimalString(contract.iof_value ?? 0),
        encargo_garantia_value: toBRDecimalString(contract.encargo_garantia_value ?? 0),
        other_fees: toBRDecimalString(contract.other_fees ?? 0),
        fixed_rate: toBRDecimalString(contract.fixed_rate),
        indexer_spread: toBRDecimalString(contract.indexer_spread ?? 0),
        principal_grace_months: (contract.principal_grace_months || 0).toString(),
        interest_grace_months: (contract.interest_grace_months || 0).toString(),
        principal_installments: contract.principal_installments?.toString() || "",
        interest_installments: (contract.interest_installments || contract.principal_installments)?.toString() || "",
        total_term_months: contract.total_term_months !== undefined && contract.total_term_months !== null ? contract.total_term_months.toString() : "",
      };

      // Descarta qualquer rascunho local (autosave do navegador) que tenha
      // sobrado de uma edição anterior deste mesmo contrato — a partir daqui
      // o registro recém-carregado do banco é a fonte da verdade, e não
      // queremos que o banner "Continuar rascunho" ofereça restaurar dados
      // antigos por cima do que acabou de ser carregado.
      try {
        localStorage.removeItem(`endividamento_draft_${contractId}`);
      } catch (err) {
        console.error("Erro ao limpar rascunho local:", err);
      }

      setEditingContractId(contractId);
      setEditingContractMeta({
        status: contract.status || "rascunho",
        rejectionComments: contract.rejection_comments || "",
      });
      // "Modo recálculo": presente quando o contrato foi reaberto a partir
      // do botão "Requer recálculo" no Fechamento Contábil (ver
      // FechamentoContabil.jsx → handleReopenForRecalc). Guardado em
      // extra_json (campo dinâmico, sem precisar de migração) — some quando
      // o contrato é salvo de novo daqui (ver persistContract/handleCloseContract).
      setRecalcFlag(contract.recalculation_flag || null);
      setReopenData(reopenFormData);
      // Preenche formParams/lastCalculatedParams com os mesmos dados já
      // salvos — assim os botões de Salvar/Enviar funcionam imediatamente,
      // sem exigir que o usuário clique em Calcular de novo só para reabrir.
      setFormParams(contractFormData);
      setLastCalculatedParams(contractFormData);
      setHasUnsavedChanges(false);
      setUploadedPdfUrl(contract.contract_pdf_url || null);

      // Load result
      const resultData = {
        schedule: scheduleData.schedule || [],
        principal: scheduleData.schedule?.[0]?.sdInicial || 0,
        totalJuros: (scheduleData.schedule || []).reduce((s, r) => s + (r.jurosFixosMes || 0) + (r.jurosVariaveisMes || 0), 0),
        totalPrestacao: (scheduleData.schedule || []).reduce((s, r) => s + (r.prestacao || 0), 0),
        cdiRatesSnapshot: scheduleData.cdiRates || [],
      };

      setResult(resultData);

      window.history.replaceState({}, "", window.location.pathname);
    } catch (error) {
      console.error("Failed to load contract:", error);
      alert("Erro ao carregar contrato: " + error.message);
    }
  }, [loadingGroups, loadingEntities, loadingBanks]);

  // Check for reopen or edit parameter on mount
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const editParam = urlParams.get("edit");
    const reopenParam = urlParams.get("reopen");
    
    if (editParam && !loadingGroups && !loadingEntities && !loadingBanks) {
      loadContractForEdit(editParam);
    } else if (reopenParam) {
      try {
        const data = JSON.parse(decodeURIComponent(reopenParam));
        setReopenData(data);
        window.history.replaceState({}, "", window.location.pathname);
      } catch (e) {
        console.error("Failed to parse reopen data:", e);
      }
    }
  }, [loadContractForEdit, loadingGroups, loadingEntities, loadingBanks]);

  const { data: allCurrencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => base44.entities.Currency.list("", 100),
    initialData: [],
  });

  // Remover duplicatas de moedas (manter a mais recente por currency_code)
  const currencies = React.useMemo(() => {
    const unique = new Map();
    allCurrencies?.forEach(c => {
      const existing = unique.get(c.currency_code);
      // Manter a entrada mais recente (rate_date mais recente)
      if (!existing || (c.rate_date && (!existing.rate_date || c.rate_date > existing.rate_date))) {
        unique.set(c.currency_code, c);
      }
    });
    return Array.from(unique.values());
  }, [allCurrencies]);

  const handleCalculate = useCallback(async (formData) => {
    // Limpar resultado anterior para forçar recálculo do zero
    setResult(null);
    setFormParams(formData);
    setHasUnsavedChanges(false);
    setIsCalculating(true);

    try {
      // Buscar taxas atualizadas do banco sempre que calcular
      const allRates = await base44.entities.CDIRate.list("rate_date", 10000);
      
      const cdiRatesSnapshot = allRates.map((r) => ({
        rate_date: r.rate_date,
        annual_rate: r.annual_rate,
        rate_type: r.rate_type,
      }));

      const holidaysSnapshot = holidays.map((h) => ({
        holiday_date: h.holiday_date,
      }));

      // Validar se tem taxas do tipo necessário
      if (formData.indexer !== "NA") {
        const relevantRates = cdiRatesSnapshot.filter(r => r.rate_type === formData.indexer);
        if (relevantRates.length === 0) {
          alert(`⚠️ Nenhuma taxa ${formData.indexer} cadastrada. Por favor, importe as taxas na aba 'CDI / SELIC' antes de calcular com indexadores.`);
          return;
        }
      }

      // Função auxiliar: converte data BR (DD/MM/YYYY) para ISO (YYYY-MM-DD)
      const convertBRtoISO = (brDate) => {
        if (!brDate) return null;
        if (brDate.match(/^\d{4}-\d{2}-\d{2}$/)) return brDate; // Já é ISO
        const [day, month, year] = brDate.split('/');
        return `${year}-${month}-${day}`;
      };

      // Converter percentuais para objeto {parcela: decimal}
      let amortizationSchedule = null;
      let percentageBase = "saldo_devedor";
      if (formData.calculation_system === "PERCENTAGE_RESIDUAL" && formData.amortization_percentages) {
        const percentages = formData.amortization_percentages.split(',').map(p => parseFloat(p.trim()) / 100);
        amortizationSchedule = {};
        percentages.forEach((pct, idx) => {
          amortizationSchedule[idx + 1] = pct;
        });
        percentageBase = formData.percentage_base || "saldo_devedor";
      }

      // 🔍 DEBUG: Log params USD antes de enviar ao engine
      if (formData.currencyId) {
        console.log('🔍 SIMULATOR → ENGINE (USD params):', {
          currencyId: formData.currencyId,
          amount_foreign: formData.amount_foreign,
          amount_foreign_type: typeof formData.amount_foreign,
          exchange_rate_closing: formData.exchange_rate_closing,
          exchangeRates_length: formData.exchangeRates?.length || 0
        });
      }

      const calcResult = await calculateAmortizationSchedule({
        operationValue: formData.operation_value,
        signalValue: formData.signal_value,
        iofValue: formData.iof_value,
        iofFinanced: formData.iof_financed,
        encargoGarantiaValue: formData.encargo_garantia_value,
        encargoGarantiaFinanced: formData.encargo_garantia_financed,
        otherFees: formData.other_fees,
        otherFeesFinanced: formData.other_fees_financed,
        fixedRate: formData.fixed_rate,
        indexer: formData.indexer,
        indexerSpread: formData.indexer_spread,
        operationDate: formData.operation_date,
        firstPaymentDate: convertBRtoISO(formData.first_payment_date),
        first_payment_date: convertBRtoISO(formData.first_payment_date),
        principalGraceMonths: formData.principal_grace_months,
        interestGraceMonths: formData.interest_grace_months,
        graceAction: formData.grace_action,
        graceInterestBehavior: formData.grace_interest_behavior,
        amortizationTrigger: formData.amortization_trigger,
        principalInstallments: formData.principal_installments,
        interestInstallments: formData.interest_installments,
        principalFrequency: formData.principal_frequency,
        interestFrequency: formData.interest_frequency,
        calculationSystem: formData.calculation_system,
        cdiRates: cdiRatesSnapshot,
        holidays: holidaysSnapshot,
        totalTermMonths: formData.total_term_months ? parseInt(formData.total_term_months) : null,
        finalMaturityDate: convertBRtoISO(formData.final_maturity_date),
        amortizationSchedule: amortizationSchedule,
        percentageBase: percentageBase,
        currencyId: formData.currencyId || null,
        exchangeLag: formData.exchangeLag || 1,
        exchangeRates: formData.exchangeRates || [],
        amount_foreign: formData.amount_foreign || null,
        exchange_rate_closing: formData.exchange_rate_closing || null,
      });

      calcResult.cdiRatesSnapshot = cdiRatesSnapshot;

      setResult(calcResult);
      setLastCalculatedParams(formData);
      setHasUnsavedChanges(false);
      setActiveTab("tabela");
    } catch (error) {
      // Mensagem contextual baseada no tipo de erro
      const extraHint = 
        formData.indexer === "CDI" || formData.indexer === "SELIC"
          ? "\n\nVerifique se as taxas CDI/SELIC estão cadastradas para todas as datas necessárias."
          : formData.currencyId
            ? "\n\nVerifique se as taxas PTAX (USD) estão cadastradas e se o Valor em Moeda Estrangeira foi preenchido corretamente."
            : "";
      
      alert(`❌ Erro no cálculo: ${error.message}${extraHint}`);
      console.error("Calculation error:", error);
    } finally {
      setIsCalculating(false);
    }
  }, [holidays]);

  // Track unsaved changes
  React.useEffect(() => {
    if (formParams && lastCalculatedParams) {
      const changed = JSON.stringify(formParams) !== JSON.stringify(lastCalculatedParams);
      setHasUnsavedChanges(changed);
    }
  }, [formParams, lastCalculatedParams]);

  const canSave = !editingContractId || hasUnsavedChanges;

  // targetStatus: "rascunho" (Salvar como Rascunho, sem exigir PDF) ou
  // "pendente_aprovacao" (Enviar para Revisão, exige PDF anexado).
  const persistContract = async (targetStatus) => {
    if (!formParams || !result) return;

    // Validação: Grupo/Entidade/Banco são obrigatórios no banco (foreign
    // keys). Sem essa checagem, um contrato com algum desses campos vazio
    // (ex.: um registro antigo que ficou sem grupo associado) só falha no
    // servidor com "Erro interno", sem indicar qual campo é o problema.
    if (!formParams.group_id || !formParams.entity_id || !formParams.bank_id) {
      alert(
        "⚠️ Este contrato está sem Grupo Econômico, Entidade ou Banco selecionado.\n\n" +
        "Verifique esses três campos no topo do formulário (à esquerda) e selecione-os novamente antes de salvar."
      );
      return;
    }

    setSaving(true);

    try {
      // Validar duplicidade: mesmo número, banco e valor (em qualquer status)
      const existingContracts = await base44.entities.LoanContract.list("", 10000);

      const isDuplicate = existingContracts.some((contract) => {
        // Se editando, ignorar o contrato atual
        if (editingContractId && contract.id === editingContractId) return false;

        return (
          contract.contract_number === formParams.contract_number &&
          contract.bank_id === formParams.bank_id &&
          contract.operation_value === parseFloat(formParams.operation_value)
        );
      });

      if (isDuplicate) {
        alert("⚠️ Já existe um contrato com este número, Banco e Valor. Altere um desses campos.");
        setSaving(false);
        return;
      }
    } catch (error) {
      console.error("Erro ao validar duplicidade:", error);
      alert("Erro ao validar duplicidade: " + (error.message || "tente novamente"));
      setSaving(false);
      return;
    }

    // Enviar para Revisão exige o PDF assinado anexado. Salvar como
    // Rascunho não exige — o preparador pode continuar sem ele.
    if (targetStatus === "pendente_aprovacao" && !uploadedPdfUrl) {
      alert("⚠️ É obrigatório anexar o PDF do contrato antes de enviar para revisão.");
      setSaving(false);
      return;
    }

    const contractData = {
      group_id: formParams.group_id || null,
      entity_id: formParams.entity_id || null,
      bank_id: formParams.bank_id || null,
      currency_id: formParams.currency_id || null,
      exchange_lag: formParams.exchangeLag !== undefined ? formParams.exchangeLag : 1,
      exchange_rates: formParams.exchangeRates ? JSON.stringify(formParams.exchangeRates) : null,
      contract_number: formParams.contract_number || `SIM-${Date.now()}`,
      operation_category: formParams.operation_category,
      operation_type: formParams.operation_type,
      guarantee_real_type: formParams.guarantee_real_type || null,
      guarantee_personal_type: formParams.guarantee_personal_type || null,
      operation_value: formParams.operation_value,
      amount_foreign: formParams.amount_foreign || null,
      exchange_rate_closing: formParams.exchange_rate_closing || null,
      signal_value: formParams.signal_value,
      iof_value: formParams.iof_value,
      iof_financed: formParams.iof_financed,
      encargo_garantia_value: formParams.encargo_garantia_value,
      encargo_garantia_financed: formParams.encargo_garantia_financed,
      other_fees: formParams.other_fees,
      other_fees_financed: formParams.other_fees_financed,
      fixed_rate: formParams.fixed_rate,
      indexer: formParams.indexer,
      indexer_spread: formParams.indexer_spread,
      operation_date: formParams.operation_date,
      first_payment_date: formParams.first_payment_date || null,
      principal_grace_months: formParams.principal_grace_months,
      interest_grace_months: formParams.interest_grace_months,
      grace_action: formParams.grace_action,
      grace_interest_behavior: formParams.grace_interest_behavior,
      amortization_trigger: formParams.amortization_trigger,
      principal_installments: formParams.principal_installments,
      interest_installments: formParams.interest_installments,
      principal_frequency: formParams.principal_frequency,
      interest_frequency: formParams.interest_frequency,
      calculation_system: formParams.calculation_system,
      total_term_months: formParams.total_term_months || 0,
      final_maturity_date: formParams.final_maturity_date || null,
      amortization_percentages: formParams.amortization_percentages || "",
      percentage_base: formParams.percentage_base || "saldo_devedor",
      schedule_data: JSON.stringify({
        schedule: result.schedule,
        cdiRates: result.cdiRatesSnapshot || [],
      }),
      status: targetStatus,
      contract_pdf_url: uploadedPdfUrl || null,
      // Modo recálculo: este salvamento É o "recálculo reprocessado" — some
      // com a sinalização (ver setRecalcFlag em loadContractForEdit) para
      // não ficar destacando a parcela para sempre depois de resolvida.
      ...(recalcFlag ? { recalculation_flag: null } : {}),
    };

    const successMessage = targetStatus === "rascunho"
      ? "Rascunho salvo com sucesso!"
      : (editingContractId ? "Contrato atualizado e enviado para revisão!" : "Contrato enviado para revisão!");

    // Chave do rascunho local (autosave) — limpa depois que os dados forem
    // persistidos no banco, já que a partir daqui saímos da tela.
    const previousDraftKey = editingContractId || "new";

    try {
      let saved;
      if (editingContractId) {
        saved = await base44.entities.LoanContract.update(editingContractId, contractData);
      } else {
        saved = await base44.entities.LoanContract.create(contractData);
      }
      alert(successMessage);

      // Depois de salvar, sai da tela. Em modo recálculo, volta para a
      // mesma tela de Fechamento Contábil de onde veio (returnTo, montado
      // por FechamentoContabil.jsx ao reabrir); caso contrário, mantém o
      // comportamento padrão de ir para a lista de Contratos.
      const savedId = saved?.id || editingContractId;
      clearDraft(previousDraftKey);
      if (savedId && savedId !== previousDraftKey) clearDraft(savedId);
      if (recalcFlag?.returnTo) {
        navigate(recalcFlag.returnTo);
      } else {
        navigate(createPageUrl("Contracts"));
      }
    } catch (error) {
      alert("Erro ao salvar: " + error.message);
    }

    setSaving(false);
  };

  const handleSaveDraft = () => persistContract("rascunho");
  const handleSubmitForReview = () => persistContract("pendente_aprovacao");

  const handlePdfUpload = async (file) => {
    if (file === null) {
      // Remover PDF
      setUploadedPdfUrl(null);
      if (editingContractId) {
        await base44.entities.LoanContract.update(editingContractId, {
          contract_pdf_url: null
        });
      }
      return;
    }
    
    if (!file) return;
    
    if (file.type !== 'application/pdf') {
      alert("Apenas arquivos PDF são permitidos");
      return;
    }

    const MAX_PDF_SIZE = 50 * 1024 * 1024; // mantido em sincronia com o limite do multer no backend (backend/src/app.js)
    if (file.size > MAX_PDF_SIZE) {
      alert(`Arquivo muito grande (${(file.size / (1024 * 1024)).toFixed(1)}MB). Tamanho máximo: 50MB. Tente compactar o PDF antes de anexar.`);
      return;
    }

    setIsUploadingPdf(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedPdfUrl(file_url);
      
      // Se já existe contrato salvo, atualizar imediatamente
      if (editingContractId) {
        await base44.entities.LoanContract.update(editingContractId, {
          contract_pdf_url: file_url
        });
      }
    } catch (error) {
      alert("Erro ao fazer upload do PDF: " + error.message);
    } finally {
      setIsUploadingPdf(false);
    }
  };

  const clearDraft = (key) => {
    try {
      localStorage.removeItem(`endividamento_draft_${key}`);
    } catch (err) {
      console.error("Erro ao limpar rascunho salvo:", err);
    }
  };

  const handleReset = () => {
    clearDraft(editingContractId || "new");
    setResult(null);
    setFormParams(null);
    setLastCalculatedParams(null);
    setHasUnsavedChanges(false);
    setEditingContractId(null);
    setEditingContractMeta(null);
    setRecalcFlag(null);
    setReopenData(null);
    setUploadedPdfUrl(null);
  };

  // Sai da edição sem salvar — volta para o Fechamento Contábil de origem se
  // o contrato foi reaberto em "modo recálculo" (ver FechamentoContabil.jsx),
  // senão para a tela de Contratos. Confirma antes, já que não há como saber
  // com certeza se o usuário alterou algo no formulário.
  const handleBack = () => {
    if (!window.confirm("Sair sem salvar? Alterações não salvas neste contrato serão perdidas.")) return;
    if (recalcFlag?.returnTo) navigate(recalcFlag.returnTo);
    else navigate(createPageUrl("Contracts"));
  };

  // Esc é o mesmo atalho do botão "Voltar" — só ativo enquanto há um
  // contrato existente em edição (contrato novo, ainda não salvo, não tem
  // "para onde voltar" óbvio).
  React.useEffect(() => {
    if (!editingContractId) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") handleBack();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingContractId, recalcFlag]);

  const handleCloseContract = async () => {
    if (!editingContractId || (!formParams && !reopenData)) {
      alert("Nenhum contrato aberto para fechar.");
      return;
    }

    const dataToSave = formParams || reopenData;

    if (!dataToSave.group_id || !dataToSave.entity_id || !dataToSave.bank_id) {
      alert(
        "⚠️ Este contrato está sem Grupo Econômico, Entidade ou Banco selecionado.\n\n" +
        "Verifique esses três campos no topo do formulário (à esquerda) e selecione-os novamente antes de fechar."
      );
      return;
    }

    const confirmed = window.confirm(
      "Tem certeza que deseja fechar este contrato?\n\nO contrato será salvo com os parâmetros e cálculos atuais."
    );

    if (!confirmed) return;

    setSaving(true);
    try {
      const closeContractData = {
        group_id: dataToSave.group_id || null,
        entity_id: dataToSave.entity_id || null,
        bank_id: dataToSave.bank_id || null,
        currency_id: dataToSave.currency_id || null,
        exchange_lag: dataToSave.exchangeLag !== undefined ? dataToSave.exchangeLag : 1,
        exchange_rates: dataToSave.exchangeRates ? JSON.stringify(dataToSave.exchangeRates) : null,
        contract_number: dataToSave.contract_number || `SIM-${Date.now()}`,
        operation_category: dataToSave.operation_category,
        operation_type: dataToSave.operation_type,
        guarantee_real_type: dataToSave.guarantee_real_type || null,
        guarantee_personal_type: dataToSave.guarantee_personal_type || null,
        operation_value: dataToSave.operation_value,
        signal_value: dataToSave.signal_value,
        iof_value: dataToSave.iof_value,
        iof_financed: dataToSave.iof_financed,
        encargo_garantia_value: dataToSave.encargo_garantia_value,
        encargo_garantia_financed: dataToSave.encargo_garantia_financed,
        other_fees: dataToSave.other_fees,
        other_fees_financed: dataToSave.other_fees_financed,
        fixed_rate: dataToSave.fixed_rate,
        indexer: dataToSave.indexer,
        indexer_spread: dataToSave.indexer_spread,
        operation_date: dataToSave.operation_date,
        first_payment_date: dataToSave.first_payment_date || null,
        principal_grace_months: dataToSave.principal_grace_months,
        interest_grace_months: dataToSave.interest_grace_months,
        grace_action: dataToSave.grace_action,
        grace_interest_behavior: dataToSave.grace_interest_behavior,
        amortization_trigger: dataToSave.amortization_trigger,
        principal_installments: dataToSave.principal_installments || 1,
        interest_installments: dataToSave.interest_installments || 1,
        principal_frequency: dataToSave.principal_frequency,
        interest_frequency: dataToSave.interest_frequency,
        calculation_system: dataToSave.calculation_system,
        total_term_months: dataToSave.total_term_months || 0,
        final_maturity_date: dataToSave.final_maturity_date || null,
        amortization_percentages: dataToSave.amortization_percentages || "",
        percentage_base: dataToSave.percentage_base || "saldo_devedor",
        schedule_data: result ? JSON.stringify({
          schedule: result.schedule,
          cdiRates: result.cdiRatesSnapshot || [],
        }) : JSON.stringify({ schedule: [], cdiRates: [] }),
        // "Fechar Contrato" apenas guarda o estado atual como rascunho e
        // sai da tela — não exige PDF nem envia para revisão.
        status: "rascunho",
        // Modo recálculo: "Fechar Contrato" também conta como "encerrar" o
        // recálculo (mesmo tratamento de persistContract, ver comentário lá).
        ...(recalcFlag ? { recalculation_flag: null } : {}),
      };

      await base44.entities.LoanContract.update(editingContractId, closeContractData);
      clearDraft(editingContractId);
      if (recalcFlag?.returnTo) {
        navigate(recalcFlag.returnTo);
      } else {
        navigate(createPageUrl("Contracts"));
      }
    } catch (error) {
      alert("Erro ao fechar contrato: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async (customDates, originalParams) => {
    try {
      console.log("🔄 handleRecalculate chamado com:", customDates.length, "datas");
      const cdiRatesSnapshot = result.cdiRatesSnapshot || [];
      const holidaysSnapshot = holidays.map((h) => ({ holiday_date: h.holiday_date }));

      const convertBRtoISO = (brDate) => {
        if (!brDate) return null;
        if (brDate.match(/^\d{4}-\d{2}-\d{2}$/)) return brDate;
        const [day, month, year] = brDate.split('/');
        return `${year}-${month}-${day}`;
      };

      const calcResult = await calculateAmortizationSchedule({
        operationValue: originalParams.operation_value,
        signalValue: originalParams.signal_value,
        iofValue: originalParams.iof_value,
        iofFinanced: originalParams.iof_financed,
        encargoGarantiaValue: originalParams.encargo_garantia_value,
        encargoGarantiaFinanced: originalParams.encargo_garantia_financed,
        otherFees: originalParams.other_fees,
        otherFeesFinanced: originalParams.other_fees_financed,
        fixedRate: originalParams.fixed_rate,
        indexer: originalParams.indexer,
        indexerSpread: originalParams.indexer_spread,
        operationDate: originalParams.operation_date,
        firstPaymentDate: convertBRtoISO(originalParams.first_payment_date),
        first_payment_date: convertBRtoISO(originalParams.first_payment_date),
        principalGraceMonths: originalParams.principal_grace_months,
        interestGraceMonths: originalParams.interest_grace_months,
        graceAction: originalParams.grace_action,
        graceInterestBehavior: originalParams.grace_interest_behavior,
        amortizationTrigger: originalParams.amortization_trigger,
        principalInstallments: originalParams.principal_installments,
        interestInstallments: originalParams.interest_installments,
        principalFrequency: originalParams.principal_frequency,
        interestFrequency: originalParams.interest_frequency,
        calculationSystem: originalParams.calculation_system,
        cdiRates: cdiRatesSnapshot,
        holidays: holidaysSnapshot,
        customDates: customDates,
        totalTermMonths: originalParams.total_term_months ? parseInt(originalParams.total_term_months) : null,
        finalMaturityDate: convertBRtoISO(originalParams.final_maturity_date),
      });

      console.log("✅ Resultado recalculado:", {
        parcelas: calcResult.schedule?.length,
        ultimaData: calcResult.schedule?.[calcResult.schedule.length - 1]?.dataVencimento
      });

      calcResult.cdiRatesSnapshot = cdiRatesSnapshot;
      setResult(calcResult);
    } catch (error) {
      alert(`❌ Erro no recálculo: ${error.message}`);
      console.error("Recalculate error:", error);
    }
  };

  return (
    <div
      className={
        isModernLayout
          ? "w-full h-full min-h-0 flex flex-col"
          : "w-full px-4 sm:px-6 py-8"
      }
    >
      {editingContractId && (
        <div className="mb-4">
          <Button variant="outline" size="sm" onClick={handleBack} className="gap-1.5 text-xs">
            <ArrowLeft className="w-3.5 h-3.5" />
            {recalcFlag?.returnTo ? "Voltar para o Fechamento Contábil" : "Voltar para Contratos"}
          </Button>
        </div>
      )}
      {recalcFlag && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
          <div>
            <span className="font-semibold">Modo recálculo — </span>
            contrato reaberto por divergência na baixa da parcela {recalcFlag.parcela}
            {recalcFlag.dataVencimento ? ` (venc. ${String(recalcFlag.dataVencimento).split("-").reverse().join("/")})` : ""}.
            {" "}Ela está destacada na tabela de amortização. Este aviso some quando você salvar o novo cálculo, e você
            volta automaticamente para o Fechamento Contábil de onde saiu.
          </div>
        </div>
      )}
      <div
        className={
          isModernLayout
            ? "grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0 lg:min-h-[calc(100dvh-10.5rem)]"
            : "grid grid-cols-1 xl:grid-cols-12 gap-8"
        }
      >
        {/* Left — Form (mesma ordem de campos do clássico) */}
        <div className={isModernLayout ? "lg:col-span-4 flex flex-col min-h-0" : "xl:col-span-4"}>
          <div
            className={
              isModernLayout
                ? "lg:sticky lg:top-0 lg:max-h-[calc(100dvh-10.5rem)] overflow-y-auto pr-1"
                : "sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto"
            }
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Calculadora</h1>
                <p className="text-sm text-slate-600 mt-0.5">Configure os parâmetros do empréstimo</p>
              </div>
              {result && (
                <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> Limpar
                </Button>
              )}
            </div>
            {editingContractMeta?.status === "cancelado" && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <span className="font-semibold">Devolvido para Correção. </span>
                {editingContractMeta.rejectionComments
                  ? editingContractMeta.rejectionComments
                  : "O aprovador solicitou ajustes neste contrato."}
              </div>
            )}
            <ContractForm
              narrowColumn={isModernLayout}
              onCalculate={handleCalculate}
              onIdentificationChange={(fields) =>
                setFormParams((prev) => (prev ? { ...prev, ...fields } : prev))
              }
              groups={groups}
              entities={entities}
              banks={banks}
              currencies={currencies}
              initialData={reopenData && !loadingGroups && !loadingEntities && !loadingBanks ? reopenData : null}
              isEditing={!!editingContractId}
              draftKey={editingContractId || "new"}
              isCalculating={isCalculating}
              uploadedPdfUrl={uploadedPdfUrl}
              onPdfUpload={handlePdfUpload}
              isUploadingPdf={isUploadingPdf}
              hasResult={!!result}
              isSaving={saving}
              onSaveDraft={handleSaveDraft}
              onSubmitForReview={handleSubmitForReview}
            />
          </div>
        </div>

        {/* Right — Results */}
        <div
          className={
            isModernLayout
              ? "lg:col-span-8 flex flex-col min-h-[320px] lg:min-h-[calc(100dvh-10.5rem)]"
              : "xl:col-span-8"
          }
        >
          {result ? (
            <div className="space-y-6 flex-1 min-h-0">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Resultado</h2>
                {editingContractId && (
                  <Button onClick={handleCloseContract} disabled={saving} size="sm" variant="outline" className="gap-1.5 text-xs">
                    <X className="w-3.5 h-3.5" />
                    Fechar Contrato
                  </Button>
                )}
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="bg-slate-100">
                  <TabsTrigger value="tabela" className="text-xs">Memória de Cálculo</TabsTrigger>
                  <TabsTrigger value="graficos" className="text-xs">Gráficos</TabsTrigger>
                  <TabsTrigger value="snapshot" className="text-xs">🔐 Snapshot</TabsTrigger>
                  <TabsTrigger value="testes" className="text-xs">🧪 Testes</TabsTrigger>
                  <TabsTrigger value="regression" className="text-xs">🔐 Zero Risk</TabsTrigger>
                  <TabsTrigger value="integrity" className="text-xs">🔐 Integridade</TabsTrigger>
                  <TabsTrigger value="scenarios" className="text-xs">🧪 Cenários</TabsTrigger>
                </TabsList>
                <TabsContent value="tabela" className="mt-4">
                 <AmortizationTable result={result} params={formParams} onRecalculate={handleRecalculate} highlightParcela={recalcFlag?.parcela} />
                </TabsContent>
                <TabsContent value="graficos" className="mt-4">
                 <ScheduleChart schedule={result.schedule} />
                </TabsContent>
                <TabsContent value="snapshot" className="mt-4">
                 <SnapshotValidationTest calculationResult={result} />
                </TabsContent>
                <TabsContent value="testes" className="mt-4">
                 <EngineTestSuite />
                </TabsContent>
                <TabsContent value="regression" className="mt-4">
                  <ZeroRiskRegressionTest />
                </TabsContent>
                <TabsContent value="integrity" className="mt-4">
                  <IntegrityValidator 
                    beforeResult={result} 
                    afterResult={result} 
                    currency={formParams?.currencyId ? "USD" : "BRL"}
                    phaseName="FASE 4-6"
                  />
                </TabsContent>
                <TabsContent value="scenarios" className="mt-4">
                  <ScenarioTests />
                </TabsContent>
                </Tabs>
            </div>
          ) : isModernLayout ? (
            <div className="flex flex-1 items-center justify-center min-h-[320px] lg:min-h-full rounded-xl border border-dashed border-[#E5E7EB] bg-white">
              <div className="text-center px-6 py-12">
                <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-700">Nenhum cálculo realizado</h3>
                <p className="text-sm text-slate-500 mt-1">Preencha os parâmetros e clique em &quot;Calcular&quot;</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center">
                <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-700">Nenhum cálculo realizado</h3>
                <p className="text-sm text-slate-500 mt-1">Preencha os parâmetros e clique em &quot;Calcular&quot;</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}