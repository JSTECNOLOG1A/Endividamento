import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, RotateCcw, X, FileText, Trash2 } from "lucide-react";
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

export default function Simulator() {
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [formParams, setFormParams] = useState(null);
  const [lastCalculatedParams, setLastCalculatedParams] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("tabela");
  const [reopenData, setReopenData] = useState(null);
  const [editingContractId, setEditingContractId] = useState(null);
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
      
      setEditingContractId(contractId);
      
      const contractFormData = {
        group_id: contract.group_id,
        entity_id: contract.entity_id,
        bank_id: contract.bank_id,
        currency_id: contract.currency_id || "",
        exchange_lag: contract.exchange_lag !== undefined ? contract.exchange_lag : 1,
        exchange_rates: contract.exchange_rates || null,
        contract_number: contract.contract_number || "",
        operation_category: contract.operation_category || "",
        operation_type: contract.operation_type || "",
        operation_value: contract.operation_value?.toString() || "",
        signal_value: (contract.signal_value || 0).toString(),
        iof_value: (contract.iof_value || 0).toString(),
        iof_financed: contract.iof_financed || false,
        other_fees: (contract.other_fees || 0).toString(),
        other_fees_financed: contract.other_fees_financed || false,
        fixed_rate: contract.fixed_rate?.toString() || "",
        indexer: contract.indexer || "NA",
        indexer_spread: (contract.indexer_spread || 0).toString(),
        operation_date: contract.operation_date || new Date().toISOString().split("T")[0],
        first_payment_date: contract.first_payment_date || "",
        principal_grace_months: (contract.principal_grace_months || 0).toString(),
        interest_grace_months: (contract.interest_grace_months || 0).toString(),
        grace_action: contract.grace_action || "capitalizar",
        grace_interest_behavior: contract.grace_interest_behavior || (contract.grace_action === "pagar" ? "INTEREST_ONLY" : "CAPITALIZAR"),
        amortization_trigger: contract.amortization_trigger || "END_OF_GRACE",
        principal_installments: contract.principal_installments?.toString() || "",
        interest_installments: (contract.interest_installments || contract.principal_installments)?.toString() || "",
        principal_frequency: contract.principal_frequency || "1",
        interest_frequency: contract.interest_frequency || "1",
        calculation_system: contract.calculation_system || "SAC",
        total_term_months: contract.total_term_months !== undefined && contract.total_term_months !== null ? contract.total_term_months.toString() : "",
        final_maturity_date: contract.final_maturity_date || "",
        amortization_percentages: contract.amortization_percentages || "",
        percentage_base: contract.percentage_base || "saldo_devedor",
      };
      
      setReopenData(contractFormData);
      setFormParams(null);
      setLastCalculatedParams(null);
      setUploadedPdfUrl(contract.contract_pdf_url || null);
      
      // Carregar exchange_rates se existir
      if (contract.exchange_rates) {
        try {
          const parsedRates = JSON.parse(contract.exchange_rates);
          contractFormData.exchangeRates = parsedRates;
        } catch (err) {
          console.error("Erro ao parsear exchange_rates do contrato:", err);
        }
      }

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

  const handleSave = async () => {
    if (!formParams || !result) return;
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
      setSaving(false);
      return;
    }
    
    const contractData = {
      group_id: formParams.group_id,
      entity_id: formParams.entity_id,
      bank_id: formParams.bank_id,
      currency_id: formParams.currency_id || "",
      exchange_lag: formParams.exchangeLag !== undefined ? formParams.exchangeLag : 1,
      exchange_rates: formParams.exchangeRates ? JSON.stringify(formParams.exchangeRates) : null,
      contract_number: formParams.contract_number || `SIM-${Date.now()}`,
      operation_category: formParams.operation_category,
      operation_type: formParams.operation_type,
      operation_value: formParams.operation_value,
      amount_foreign: formParams.amount_foreign || null,
      exchange_rate_closing: formParams.exchange_rate_closing || null,
      signal_value: formParams.signal_value,
      iof_value: formParams.iof_value,
      iof_financed: formParams.iof_financed,
      other_fees: formParams.other_fees,
      other_fees_financed: formParams.other_fees_financed,
      fixed_rate: formParams.fixed_rate,
      indexer: formParams.indexer,
      indexer_spread: formParams.indexer_spread,
      operation_date: formParams.operation_date,
      first_payment_date: formParams.first_payment_date || "",
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
      final_maturity_date: formParams.final_maturity_date || "",
      amortization_percentages: formParams.amortization_percentages || "",
      percentage_base: formParams.percentage_base || "saldo_devedor",
      schedule_data: JSON.stringify({
        schedule: result.schedule,
        cdiRates: result.cdiRatesSnapshot || [],
      }),
      status: "rascunho",
      contract_pdf_url: uploadedPdfUrl || null,
    };

    try {
      if (editingContractId) {
        await base44.entities.LoanContract.update(editingContractId, contractData);
        alert("Contrato atualizado com sucesso!");
      } else {
        await base44.entities.LoanContract.create(contractData);
        alert("Contrato salvo com sucesso!");
      }
      handleReset();
    } catch (error) {
      alert("Erro ao salvar: " + error.message);
    }
    
    setSaving(false);
  };

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

  const handleReset = () => {
    setResult(null);
    setFormParams(null);
    setLastCalculatedParams(null);
    setHasUnsavedChanges(false);
    setEditingContractId(null);
    setReopenData(null);
    setUploadedPdfUrl(null);
  };

  const handleCloseContract = async () => {
    if (!editingContractId || (!formParams && !reopenData)) {
      alert("Nenhum contrato aberto para fechar.");
      return;
    }

    const dataToSave = formParams || reopenData;

    const confirmed = window.confirm(
      "Tem certeza que deseja fechar este contrato?\n\nO contrato será salvo com os parâmetros e cálculos atuais."
    );

    if (!confirmed) return;

    setSaving(true);
    try {
      const closeContractData = {
        group_id: dataToSave.group_id,
        entity_id: dataToSave.entity_id,
        bank_id: dataToSave.bank_id,
        currency_id: dataToSave.currency_id || "",
        exchange_lag: dataToSave.exchangeLag !== undefined ? dataToSave.exchangeLag : 1,
        exchange_rates: dataToSave.exchangeRates ? JSON.stringify(dataToSave.exchangeRates) : null,
        contract_number: dataToSave.contract_number || `SIM-${Date.now()}`,
        operation_category: dataToSave.operation_category,
        operation_type: dataToSave.operation_type,
        operation_value: dataToSave.operation_value,
        signal_value: dataToSave.signal_value,
        iof_value: dataToSave.iof_value,
        iof_financed: dataToSave.iof_financed,
        other_fees: dataToSave.other_fees,
        other_fees_financed: dataToSave.other_fees_financed,
        fixed_rate: dataToSave.fixed_rate,
        indexer: dataToSave.indexer,
        indexer_spread: dataToSave.indexer_spread,
        operation_date: dataToSave.operation_date,
        first_payment_date: dataToSave.first_payment_date || "",
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
        final_maturity_date: dataToSave.final_maturity_date || "",
        amortization_percentages: dataToSave.amortization_percentages || "",
        percentage_base: dataToSave.percentage_base || "saldo_devedor",
        schedule_data: result ? JSON.stringify({
          schedule: result.schedule,
          cdiRates: result.cdiRatesSnapshot || [],
        }) : JSON.stringify({ schedule: [], cdiRates: [] }),
        status: "rascunho",
      };
      
      await base44.entities.LoanContract.update(editingContractId, closeContractData);
      navigate(createPageUrl("Contracts"));
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
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Left — Form */}
        <div className="xl:col-span-4">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Simulador</h1>
                <p className="text-sm text-slate-500 mt-0.5">Configure os parâmetros do empréstimo</p>
              </div>
              {result && (
                <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> Limpar
                </Button>
              )}
            </div>
            <ContractForm
              onCalculate={handleCalculate}
              groups={groups}
              entities={entities}
              banks={banks}
              currencies={currencies}
              initialData={reopenData && !loadingGroups && !loadingEntities && !loadingBanks ? reopenData : null}
              isEditing={!!editingContractId}
              isCalculating={isCalculating}
              uploadedPdfUrl={uploadedPdfUrl}
              onPdfUpload={handlePdfUpload}
              isUploadingPdf={isUploadingPdf}
            />
          </div>
        </div>

        {/* Right — Results */}
        <div className="xl:col-span-8">
          {result ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Resultado</h2>
                <div className="flex gap-2">
                  {editingContractId && (
                    <Button onClick={handleCloseContract} disabled={saving} size="sm" variant="outline" className="gap-1.5 text-xs">
                      <X className="w-3.5 h-3.5" />
                      Fechar Contrato
                    </Button>
                  )}
                  <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    <Save className="w-3.5 h-3.5" />
                    {saving ? "Salvando..." : (editingContractId ? "Atualizar contrato" : "Salvar contrato")}
                  </Button>
                </div>
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
                 <AmortizationTable result={result} params={formParams} onRecalculate={handleRecalculate} />
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
          ) : (
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center">
                <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-700">Nenhum cálculo realizado</h3>
                <p className="text-sm text-slate-400 mt-1">Preencha os parâmetros e clique em "Calcular"</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}