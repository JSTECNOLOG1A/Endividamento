import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, ChevronLeft, ChevronRight, TrendingDown, DollarSign, BarChart3, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const PAGE_SIZE = 100;

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value) {
  return value.toFixed(6) + "%";
}

function formatDate(dateStr) {
  // Garantir que a data seja parseada sem conversão de timezone
  if (!dateStr) return "";
  // Se já tem horário, usar direto
  if (dateStr.includes("T")) {
    return format(new Date(dateStr), "dd/MM/yyyy", { locale: ptBR });
  }
  // Se não tem, adicionar T00:00:00 para evitar timezone shift
  return format(new Date(dateStr + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR });
}

// Calcula dias até data futura (para segregação contábil CPC 26)
function getDaysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateStr + "T00:00:00");
  const diffTime = targetDate - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function AmortizationTable({ result, params, onRecalculate }) {
  const [page, setPage] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editedSchedule, setEditedSchedule] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [changedDates, setChangedDates] = useState([]);
  const [viewMode, setViewMode] = useState("financeiro"); // FASE 2: financeiro | contabil
  const [snapshotValidation, setSnapshotValidation] = useState(null); // FASE 3: snapshot gate

  const { schedule, principal, totalJuros, totalPrestacao, cet, fixedRateNominal } = result || {};
  
  // LINHA 0 (OPERAÇÃO): Criar objeto virtual para visão contábil USD
  const [row0, row0Warning] = React.useMemo(() => {
    if (!params?.currencyId || !schedule?.length) {
      return [null, null];
    }
    
    // PTAX D0: Cotação do Fechamento (assumir que é do dia da operação)
    const ptaxOperacao = 
      params.exchange_rate_closing || 
      params.exchangeRateClosing ||
      result?.exchange_rate_closing;
    
    if (!ptaxOperacao || ptaxOperacao <= 0) {
      return [null, "Cotação do Fechamento* não disponível"];
    }
    
    // PTAX fechamento 1º período (EXCLUSIVO blocoContabil, sem fallback)
    const firstRow = schedule[0];
    const ptaxAtual = firstRow.blocoContabil?.ptax_atual;
    
    if (!ptaxAtual) {
      return [null, "PTAX fechamento 1º período ausente (blocoContabil.ptax_atual)"];
    }
    
    // USD correto (result.principal_foreign prioritário)
    const sdInicial_USD = 
      result.principal_foreign || 
      result.amount_foreign || 
      firstRow.sdInicial_USD ||
      (principal / ptaxOperacao);
    
    if (!sdInicial_USD || sdInicial_USD <= 0) {
      return [null, "Valor USD inválido"];
    }
    
    // ✅ REGRA CONTÁBIL: Linha 0 é apenas demonstrativa (abertura referencial)
    const ptax_anterior = ptaxOperacao;
    const aberturaBRL = sdInicial_USD * ptax_anterior;
    
    return [{
      parcela: 0,
      dataVencimento: firstRow.dataVencimento,
      sdInicial_USD: sdInicial_USD,
      ptax_anterior: ptax_anterior,
      ptax_atual: ptaxAtual,
      aberturaBRL: aberturaBRL,
      ajusteCambial: 0, // ✅ Não reconhece variação (apenas demonstrativo)
      juros: 0,
      amortizacao: 0,
      fechamento: aberturaBRL,
      evento: "ABERTURA_REFERENCIAL",
      integrar: false
    }, null];
  }, [params, schedule, principal, result]);
  
  // BUG FIX 2: Declarar isUSD ANTES do useEffect
  const isUSD = !!params?.currencyId;
  
  // Determinar base de cálculo: se não informado, padrão é 360 (base corrida)
  const useBase252 = params?.useBase252 || false;
  const calculationBase = useBase252 ? 252 : 360;
  const calculationSystem = params?.calculation_system || "";
  
  // FASE 3: Snapshot Validation Gate (usando snapshot real do resultado)
  useEffect(() => {
    if (result && isUSD) {
      const validation = validateSnapshotFromResult(result);
      setSnapshotValidation(validation);
    } else {
      setSnapshotValidation({ passed: true, quality: isUSD ? "N/A" : "N/A (BRL)" });
    }
  }, [result, isUSD]);

  // ✅ RECALCULAR PARCELA 1: usar PTAX da operação como anterior (UI only, contábil)
  const scheduleAdjusted = React.useMemo(() => {
    if (!isUSD || viewMode !== "contabil" || !schedule?.length || !row0) return schedule;
    
    const ptaxOperacao = 
      params.exchange_rate_closing || 
      params.exchangeRateClosing ||
      result?.exchange_rate_closing;
    
    if (!ptaxOperacao) return schedule;
    
    return schedule.map((row, idx) => {
      if (idx === 0) {
        const ptaxAtual = row.blocoContabil?.ptax_atual || row.ptax_rate;
        const sdInicial_USD = row.sdInicial_USD || row0.sdInicial_USD;
        const ajusteCambialRecalc = sdInicial_USD * (ptaxAtual - ptaxOperacao);
        return {
          ...row,
          blocoContabil: {
            ...row.blocoContabil,
            ptax_anterior_original: row.blocoContabil?.ptax_anterior,
            ptax_anterior: ptaxOperacao,
            ajusteCambialMes: ajusteCambialRecalc
          },
          evento: "FX_PRINCIPAL",
          integrar: true
        };
      }
      return {
        ...row,
        evento: "FX_PRINCIPAL",
        integrar: true
      };
    });
  }, [schedule, isUSD, viewMode, params, result, row0]);

  // Early return AFTER all hooks
  if (!result || !result.schedule) return null;

  // Usar schedule (do result) sempre, para refletir mudanças automaticamente
  const displaySchedule = editMode && editedSchedule ? editedSchedule : (scheduleAdjusted || schedule);
  const totalPages = Math.ceil(displaySchedule.length / PAGE_SIZE);
  const pageData = displaySchedule.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleEditMode = () => {
    setEditMode(true);
    setEditedSchedule([...schedule]);
    setHasChanges(false);
  };

  const handleDateChange = (parcelaIdx, newDate) => {
    const updated = [...editedSchedule];
    updated[parcelaIdx].dataVencimento = newDate;
    setEditedSchedule(updated);
    setHasChanges(true);
  };

  const handleSaveChanges = () => {
    if (onRecalculate && hasChanges && editedSchedule) {
      // Detectar datas que foram alteradas
      const changed = [];
      editedSchedule.forEach((row, idx) => {
        if (row.dataVencimento !== schedule[idx].dataVencimento) {
          changed.push({
            parcela: row.parcela,
            original: schedule[idx].dataVencimento,
            alterada: row.dataVencimento,
          });
        }
      });
      setChangedDates(changed);
      setShowConfirmDialog(true);
    }
  };

  const handleConfirmChanges = () => {
    if (onRecalculate && editedSchedule) {
      const customDates = editedSchedule.map(row => row.dataVencimento);
      onRecalculate(customDates, params);
      toast.success("Datas recalculadas com sucesso");
    }
    setEditMode(false);
    setEditedSchedule(null);
    setHasChanges(false);
    setShowConfirmDialog(false);
  };

  const handleCancelChanges = () => {
    setShowConfirmDialog(false);
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditedSchedule(null);
    setHasChanges(false);
  };

  // FASE 4.2: Export Financeiro com Snapshot Gate + Prefixo INVALID
  const exportFinanceiro = () => {
    // SNAPSHOT GATE: Bloquear export USD se snapshot falhou
    if (isUSD && !snapshotValidation?.passed) {
      alert(
        "🚨 SNAPSHOT VALIDATION FAILED\n\n" +
        "Export bloqueado. Snapshot não passou na validação.\n" +
        `Status: ${snapshotValidation?.quality || "UNKNOWN"}\n\n` +
        "Corrija os erros antes de exportar."
      );
      return;
    }
    
    const filePrefix = (isUSD && !snapshotValidation?.passed) ? "INVALID_" : "";
    
    const headers = isUSD
      ? [
          "Parcela", "Data Vencimento", "SD Inicial USD", "PTAX Atual", 
          "Abertura BRL (FX=PTAX Atual)", "Juros USD", "Juros BRL (FX=PTAX Atual)", 
          "Amortização USD", "Amortização BRL (FX=PTAX Atual)", 
          "PMT USD", "PMT BRL (FX=PTAX Atual)", 
          "SD Final USD", "Fechamento BRL (FX=PTAX Atual)"
        ]
      : [
          "Parcela", "Data Vencimento", "SD Inicial BRL", "Juros Fixos", "Juros Variáveis", 
          "Juros Total", "Amortização BRL", "PMT BRL", "SD Final BRL"
        ];
    
    const rows = schedule.map((r) => 
      isUSD
        ? [
            r.parcela, formatDate(r.dataVencimento), 
            r.sdInicial_USD?.toFixed(2), r.ptax_rate?.toFixed(4),
            (r.sdInicial_BRL_fxAtual || r.sdInicial).toFixed(2),
            r.jurosTotal_USD?.toFixed(2) || "0.00",
            (r.jurosTotal_BRL_fxAtual || (r.jurosFixosMes + r.jurosVariaveisMes)).toFixed(2),
            r.amortizacao_USD?.toFixed(2) || "0.00",
            (r.amortizacao_BRL_fxAtual || r.amortizacao).toFixed(2),
            r.prestacao_USD?.toFixed(2) || "0.00",
            (r.prestacao_BRL_fxAtual || r.prestacao).toFixed(2),
            r.sdFinal_USD?.toFixed(2) || "0.00",
            (r.sdFinal_BRL_fxAtual || r.sdFinal).toFixed(2)
          ]
        : [
            r.parcela, formatDate(r.dataVencimento), r.sdInicial.toFixed(2),
            r.jurosFixosMes.toFixed(2), r.jurosVariaveisMes.toFixed(2),
            (r.jurosFixosMes + r.jurosVariaveisMes).toFixed(2),
            r.amortizacao.toFixed(2), r.prestacao.toFixed(2), r.sdFinal.toFixed(2)
          ]
    );
    
    const csv = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${filePrefix}financeiro_${params?.contract_number || "export"}.csv`;
    link.click();
  };

  const exportContabil = () => {
    if (!isUSD) {
      // BRL sem USD: export padrão
      exportFinanceiro();
      return;
    }
    
    // FASE 4.2: SNAPSHOT GATE com Prefixo INVALID
    if (!snapshotValidation?.passed) {
      alert(
        "🚨 SNAPSHOT VALIDATION FAILED\n\n" +
        "Não é possível exportar. Snapshot não passou na validação.\n" +
        `Status: ${snapshotValidation?.quality || "UNKNOWN"}\n\n` +
        "Corrija os erros antes de exportar."
      );
      return;
    }
    
    const filePrefix = !snapshotValidation?.passed ? "INVALID_" : "";
    
    // FASE 4.1: Nomenclatura padronizada final
    const headers = [
      "Parcela", "Data Vencimento", "SD Inicial USD", 
      "PTAX Anterior", "PTAX Atual", "Delta PTAX",
      "Abertura BRL", "Ajuste Cambial (Principal)", "Juros Apropr. BRL (FX=PTAX Fim)", 
      "Amortização Paga BRL", "Fechamento BRL",
      "Reconciliação (Abertura + Ajuste + Juros - Amort)", "Delta Reconciliação", "Delta Status"
    ];
    
    const rows = [];
    
    // LINHA 0 (ABERTURA REFERENCIAL) no CSV Contábil
    if (row0) {
      rows.push([
        0, formatDate(row0.dataVencimento), row0.sdInicial_USD.toFixed(2),
        row0.ptax_anterior.toFixed(4), row0.ptax_atual.toFixed(4),
        (row0.ptax_atual - row0.ptax_anterior).toFixed(4),
        row0.aberturaBRL.toFixed(2), "0.00", "0.00",
        "0.00", row0.aberturaBRL.toFixed(2),
        row0.aberturaBRL.toFixed(2), "0.00", "ABERTURA_REFERENCIAL"
      ]);
    }
    
    // Parcelas normais
    schedule.forEach((r) => {
      const abertura = r.blocoContabil?.valorAberturaBRL || r.sdInicial;
      const ajuste = r.blocoContabil?.ajusteCambialMes || r.varCambial || 0;
      const juros = r.blocoContabil?.jurosCapitalizadosBRL || (r.jurosFixosMes + r.jurosVariaveisMes);
      const amort = r.blocoContabil?.amortizacaoPagaBRL || r.amortizacao;
      const fechamento = r.blocoContabil?.valorFechamentoBRL || r.sdFinal;
      const reconciliacao = abertura + ajuste + juros - amort;
      const delta = Math.abs(fechamento - reconciliacao);
      const deltaStatus = delta <= 0.10 ? "OK" : "ALERTA";
      
      rows.push([
        r.parcela, formatDate(r.dataVencimento), r.sdInicial_USD?.toFixed(2) || "0.00",
        r.blocoContabil?.ptax_anterior?.toFixed(4) || "—",
        r.blocoContabil?.ptax_atual?.toFixed(4) || r.ptax_rate?.toFixed(4) || "—",
        ((r.blocoContabil?.ptax_atual || r.ptax_rate || 0) - (r.blocoContabil?.ptax_anterior || 0)).toFixed(4),
        abertura.toFixed(2), ajuste.toFixed(2), juros.toFixed(2),
        amort.toFixed(2), fechamento.toFixed(2),
        reconciliacao.toFixed(2), delta.toFixed(2), deltaStatus
      ]);
    });
    
    const csv = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${filePrefix}contabil_${params?.contract_number || "export"}.csv`;
    link.click();
  };

  // FASE FINAL: Export Auditoria com Snapshot Gate Rigoroso
  const exportAuditoria = () => {
    // SNAPSHOT GATE: Bloquear export se não passou
    if (isUSD && !snapshotValidation?.passed) {
      alert(
        "🚨 SNAPSHOT VALIDATION FAILED\n\n" +
        "Não é possível exportar. Snapshot não passou na validação.\n" +
        `Status: ${snapshotValidation?.quality || "UNKNOWN"}\n` +
        `Mensagem: ${snapshotValidation?.message || "N/A"}\n\n` +
        "Corrija os erros antes de exportar."
      );
      return;
    }
    
    const snapshotStatus = snapshotValidation?.passed ? "PASSED" : "FAILED";
    const filePrefix = snapshotValidation?.passed ? "" : "INVALID_";
    
    if (!isUSD) {
      // BUG FIX 7: BRL sem snapshot USD, status apropriado
      const metadataLines = [
        `# RELATÓRIO DE AUDITORIA - ${new Date().toISOString()}`,
        `# Contract: ${params?.contract_number || "N/A"}`,
        `# Currency: BRL`,
        `# Snapshot Status: N/A (BRL)`,
        `# Generated At: ${new Date().toISOString()}`,
        `# Source Version: FinCalc Simulator v1.0`,
        ``,
      ];
      
      const headers = [
        "Parcela", "Data", "SD Inicial BRL", "SD Final BRL", "Snapshot Status"
      ];
      const rows = schedule.map((r) => [
        r.parcela, formatDate(r.dataVencimento),
        r.sdInicial.toFixed(2), r.sdFinal.toFixed(2),
        "N/A (BRL)"
      ]);
      
      const csv = [...metadataLines, headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${filePrefix}auditoria_${params?.contract_number || "export"}.csv`;
      link.click();
      return;
    }
    
    // USD: Pro Audit com Metadados Completos
    // BUG FIX 4: Usar hash real do resultado, não preview
    const scheduleUSDHashReal = result.snapshot?.schedule_usd_hash || 
                                 result.calculation_metadata?.calculation_hash_strict || 
                                 "N/A";
    
    // Preview para referência visual (não é hash criptográfico)
    const schedulePreview = schedule.slice(0, 10).map(r => 
      `${r.sdInicial_USD?.toFixed(2)}>${r.sdFinal_USD?.toFixed(2)}`
    ).join("|");
    
    const metadataLines = [
      `# ========================================`,
      `# RELATÓRIO DE AUDITORIA COMPLETO`,
      `# ========================================`,
      `# Contract ID: ${params?.contract_id || "N/A"}`,
      `# Contract Number: ${params?.contract_number || "N/A"}`,
      `# Currency: USD`,
      `# FX Policy: PTAX Fechamento do Período (Regime de Competência)`,
      `# `,
      `# SNAPSHOT STATUS: ${snapshotStatus}`,
      `# Snapshot Quality: ${snapshotValidation?.quality || "N/A"}`,
      `# Schedule USD Hash (SHA-256): ${scheduleUSDHashReal}`,
      `# Interest Source: ${result.snapshot?.interest_source || "USD_NATIVE"}`,
      `# `,
      `# Generated At: ${new Date().toISOString()}`,
      `# Source Version: FinCalc Simulator v1.0`,
      `# Engine Version: ${result.calculation_metadata?.engine_version || "1.2.1"}`,
      `# Engine Build ID: ${result.calculation_metadata?.engine_build_id || "N/A"}`,
      `# `,
      `# Tolerância Reconciliação: ±R$ 0,10 (arredondamento contábil)`,
      `# Delta Status: OK (delta ≤ 0,10) | ALERTA (delta > 0,10)`,
      `# `,
      `# Schedule Preview (first 10 rows): ${schedulePreview}`,
      `# ========================================`,
      ``,
    ];
    
    const headers = [
      "Parcela", "Data Vencimento",
      "SD Inicial USD", "SD Final USD",
      "PTAX Anterior", "PTAX Atual",
      "Abertura BRL", "Ajuste Cambial (Principal)", "Juros Apropriados BRL", 
      "Amortização Paga BRL", "Fechamento BRL",
      "Delta Reconciliação", "Delta Status", "Evento"
    ];
    
    const rows = [];
    
    // LINHA 0 (ABERTURA REFERENCIAL) no CSV Auditoria
    if (row0) {
      rows.push([
        0, formatDate(row0.dataVencimento),
        row0.sdInicial_USD.toFixed(2), row0.sdInicial_USD.toFixed(2),
        row0.ptax_anterior.toFixed(4), row0.ptax_atual.toFixed(4),
        row0.aberturaBRL.toFixed(2), "0.00", "0.00",
        "0.00", row0.aberturaBRL.toFixed(2),
        "0.00", "ABERTURA_REFERENCIAL", "ABERTURA_REFERENCIAL"
      ]);
    }
    
    // Parcelas normais
    schedule.forEach((r) => {
      const abertura = r.blocoContabil?.valorAberturaBRL || r.sdInicial;
      const ajuste = r.blocoContabil?.ajusteCambialMes || r.varCambial || 0;
      const juros = r.blocoContabil?.jurosCapitalizadosBRL || (r.jurosFixosMes + r.jurosVariaveisMes);
      const amort = r.blocoContabil?.amortizacaoPagaBRL || r.amortizacao;
      const fechamento = r.blocoContabil?.valorFechamentoBRL || r.sdFinal;
      const reconciliacao = abertura + ajuste + juros - amort;
      const delta = Math.abs(fechamento - reconciliacao);
      const deltaStatus = delta <= 0.10 ? "OK" : "ALERTA";
      
      rows.push([
        r.parcela, formatDate(r.dataVencimento),
        r.sdInicial_USD?.toFixed(2) || "0.00",
        r.sdFinal_USD?.toFixed(2) || "0.00",
        r.blocoContabil?.ptax_anterior?.toFixed(4) || "—",
        r.blocoContabil?.ptax_atual?.toFixed(4) || r.ptax_rate?.toFixed(4) || "—",
        abertura.toFixed(2), ajuste.toFixed(2), juros.toFixed(2),
        amort.toFixed(2), fechamento.toFixed(2),
        delta.toFixed(2), deltaStatus, "PARCELA"
      ]);
    });
    
    const csv = [...metadataLines, headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${filePrefix}auditoria_${params?.contract_number || "export"}.csv`;
    link.click();
    
    // Log para confirmar metadados
    console.log("📄 CSV Auditoria exportado:", {
      contract_number: params?.contract_number,
      snapshot_status: snapshotStatus,
      schedule_usd_hash: scheduleUSDHashReal,
      total_rows: rows.length,
      file_prefix: filePrefix || "none"
    });
  };

  return (
    <>
      {/* Diálogo de Confirmação */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold">
              Confirmar Alteração de Datas
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-600 mt-2">
              {changedDates.length} data(s) foi/foram alterada(s). Deseja manter as alterações e recalcular o contrato, ou retornar às datas originais?
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {changedDates.length > 0 && (
            <div className="bg-slate-50 rounded-lg p-4 max-h-48 overflow-y-auto">
              <div className="space-y-2">
                {changedDates.map((change) => (
                  <div key={change.parcela} className="flex justify-between text-xs border-b border-slate-200 pb-2 last:border-b-0">
                    <span className="font-semibold text-slate-700">Parcela {change.parcela}:</span>
                    <div className="text-right">
                      <span className="text-slate-500 line-through">{formatDate(change.original)}</span>
                      <span className="text-emerald-600 font-semibold ml-2">→ {formatDate(change.alterada)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <AlertDialogCancel onClick={handleCancelChanges} className="gap-1.5">
              Retornar ao Original
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmChanges} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              Manter Alterações
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-6">
      {/* FASE 3: Snapshot Gate Banner */}
      {snapshotValidation && !snapshotValidation.passed && isUSD && (
        <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-red-500 bg-red-50">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800">❌ SNAPSHOT VALIDATION FAILED</p>
            <p className="text-xs text-red-700 mt-1">
              Validação matemática falhou. Exports desabilitados. Detalhes: {snapshotValidation.message}
            </p>
            {snapshotValidation.details && (
              <pre className="text-[10px] bg-red-100 p-2 rounded mt-2 overflow-x-auto">
                {JSON.stringify(snapshotValidation.details, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
      
      {/* Warnings */}
      {result.warnings && result.warnings.length > 0 && (
        <div className="space-y-2">
          {result.warnings.map((warning, idx) => (
            <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg border ${
              warning.type === "ANATOCISM" ? "bg-red-50 border-red-200 text-red-800" :
              warning.type === "PROJECTED_RATES" ? "bg-blue-50 border-blue-200 text-blue-800" :
              "bg-amber-50 border-amber-200 text-amber-800"
            }`}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">{warning.message}</p>
            </div>
          ))}
        </div>
      )}
      
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard icon={TrendingDown} label="Total Juros" value={formatCurrency(totalJuros)} color="amber" />
        <SummaryCard icon={BarChart3} label="Total Prestações" value={formatCurrency(totalPrestacao)} color="emerald" />
        <SummaryCard icon={AlertCircle} label="CET Anual" value={`${cet?.toFixed(2) || 0}% a.a.`} color="red" subtitle={`Taxa Nominal: ${fixedRateNominal?.toFixed(4) || 0}%`} />
        <SummaryCard icon={BarChart3} label="Nº Parcelas" value={schedule.length} color="slate" />
      </div>

      {/* Table */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between mb-3">
            <CardTitle className="text-base font-semibold text-slate-800">
              Memória de Cálculo
              <Badge variant="secondary" className="ml-2 text-xs">
                {params?.calculation_system}
              </Badge>
              {result?.calculation_metadata?.engine_version && (
                <Badge variant="outline" className="ml-2 text-[10px] font-mono">
                  motor {result.calculation_metadata.engine_version}
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              {!editMode ? (
                <>
                  <Button variant="outline" size="sm" onClick={handleEditMode} className="gap-1.5 text-xs">
                    Editar Datas
                  </Button>
                  {/* FASE 3: Export Dual + Auditoria */}
                  {isUSD ? (
                    <>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={exportFinanceiro} 
                        disabled={snapshotValidation && !snapshotValidation.passed}
                        className="gap-1.5 text-xs"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV Financeiro
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={exportContabil}
                        disabled={snapshotValidation && !snapshotValidation.passed}
                        className="gap-1.5 text-xs"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV Contábil
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={exportAuditoria}
                        disabled={snapshotValidation && !snapshotValidation.passed}
                        className="gap-1.5 text-xs bg-purple-50 hover:bg-purple-100 border-purple-200"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV Auditoria
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={exportFinanceiro} className="gap-1.5 text-xs">
                      <Download className="w-3.5 h-3.5" /> Exportar CSV
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={handleCancelEdit} className="gap-1.5 text-xs">
                    Cancelar
                  </Button>
                  {hasChanges && (
                    <Button variant="default" size="sm" onClick={handleSaveChanges} className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700">
                      Salvar Alterações
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* FASE FINAL: Toggle Visão Financeira/Contábil (APENAS USD) */}
          {isUSD && (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={viewMode === "financeiro" ? "default" : "outline"}
                    onClick={() => setViewMode("financeiro")}
                    className={`text-xs ${viewMode === "financeiro" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                  >
                    💰 Financeiro (Fluxo)
                  </Button>
                  <Button
                    size="sm"
                    variant={viewMode === "contabil" ? "default" : "outline"}
                    onClick={() => setViewMode("contabil")}
                    className={`text-xs ${viewMode === "contabil" ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                  >
                    📊 Contábil (CPC 26)
                  </Button>
                </div>
                
                {/* FASE FINAL: Snapshot Status Badge */}
                {snapshotValidation && (
                  <Badge 
                    variant={snapshotValidation.passed ? "default" : "destructive"}
                    className="text-xs"
                  >
                    🔐 {snapshotValidation.passed ? "STRICT" : "FAIL"}
                  </Badge>
                )}
              </div>
              
              {/* ✅ BANNER CPC 26 - Visão Contábil */}
              {viewMode === "contabil" && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-green-800 space-y-1">
                      <p className="font-semibold">Reconhecimento por Competência (CPC 26)</p>
                      <p>A variação cambial de passivos em moeda estrangeira é reconhecida ao final de cada período de reporte com base na taxa de fechamento.</p>
                      <p>O primeiro período inclui a variação cambial desde a data da operação até o fechamento do primeiro período contábil.</p>
                      <p className="text-green-700 italic">A linha 0 é apenas demonstrativa e não representa lançamento contábil.</p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* FASE FINAL: FX Policy Label por Visão */}
              {viewMode === "financeiro" && (
                <div className="mt-3 p-2.5 rounded-lg border-2 bg-blue-50 border-blue-400">
                  <p className="text-[10px] font-semibold text-blue-900">
                    📌 FX Policy: PTAX do Período (snapshot instantâneo — tradução do fluxo)
                  </p>
                </div>
              )}
              
              {/* PONTE: Aviso Anti-Comparação */}
              <div className="mt-2 p-2 bg-red-50 border border-red-300 rounded-lg">
                <p className="text-[10px] text-red-700 leading-relaxed">
                  <strong>⚠️ NÃO COMPARE COLUNAS BRL ENTRE AS DUAS VISÕES!</strong>
                  <br />
                  Financeiro = USD × PTAX Atual | Contábil = Abertura + Var.Cambial + Juros − Amort
                </p>
              </div>
            </>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full">
            <Table className="w-full text-[10px]">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5">Mês</TableHead>
                  <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5">Venc.</TableHead>
                  
                  {/* FASE 2: VISÃO FINANCEIRA (fxAtual) */}
                  {isUSD && viewMode === "financeiro" && (
                    <>
                      <TableHead className="font-semibold text-blue-600 whitespace-nowrap px-1 py-1.5 text-right">SD Ini USD</TableHead>
                      <TableHead className="font-semibold text-blue-600 whitespace-nowrap px-1 py-1.5 text-right">PTAX Atual</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Abertura BRL</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              FX=PTAX Atual do período
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead className="font-semibold text-amber-600 whitespace-nowrap px-1 py-1.5 text-right">Juros USD</TableHead>
                      <TableHead className="font-semibold text-amber-600 whitespace-nowrap px-1 py-1.5 text-right">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Juros BRL</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              FX=PTAX Atual do período
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead className="font-semibold text-blue-600 whitespace-nowrap px-1 py-1.5 text-right">Amort USD</TableHead>
                      <TableHead className="font-semibold text-blue-600 whitespace-nowrap px-1 py-1.5 text-right">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Amort BRL</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              FX=PTAX Atual do período
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead className="font-semibold text-emerald-600 whitespace-nowrap px-1 py-1.5 text-right">PMT USD</TableHead>
                      <TableHead className="font-semibold text-emerald-600 whitespace-nowrap px-1 py-1.5 text-right font-bold">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">PMT BRL</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              FX=PTAX Atual do período
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead className="font-semibold text-blue-600 whitespace-nowrap px-1 py-1.5 text-right">SD Fin USD</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Fechamento BRL</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              FX=PTAX Atual do período
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                    </>
                  )}
                  
                  {/* FASE 2: VISÃO CONTÁBIL (blocoContabil) */}
                  {isUSD && viewMode === "contabil" && (
                    <>
                      <TableHead className="font-semibold text-blue-600 whitespace-nowrap px-1 py-1.5 text-right">SD Ini USD</TableHead>
                      <TableHead className="font-semibold text-slate-600 whitespace-nowrap px-1 py-1.5 text-right">PTAX Ant.</TableHead>
                      <TableHead className="font-semibold text-blue-600 whitespace-nowrap px-1 py-1.5 text-right">PTAX Fim</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Abertura BRL</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              SD USD × PTAX Anterior
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead className="font-semibold text-orange-600 whitespace-nowrap px-1 py-1.5 text-right">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Ajuste Cambial</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              Variação cambial do principal: SD Inicial USD × (PTAX Fim − PTAX Anterior).
                              Não inclui caixa.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead className="font-semibold text-amber-600 whitespace-nowrap px-1 py-1.5 text-right">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Juros Apropr. BRL</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              FX=PTAX Fechamento do período
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead className="font-semibold text-blue-600 whitespace-nowrap px-1 py-1.5 text-right">Amort Paga BRL</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Fechamento BRL</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-xs">
                              SD Final USD × PTAX Fim
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                    </>
                  )}
                  
                  {/* BRL (sem USD) - visão única */}
                  {!isUSD && (
                    <>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">SD Ini BRL</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">DC</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">DU</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">Tx.Fixa%</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">J.Fixos</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">Idx%</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">J.Var</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">Tot.J</TableHead>
                      {displaySchedule.some(r => (r.jurosAcruados || 0) > 0) && (
                        <TableHead className="font-semibold text-purple-600 whitespace-nowrap px-1 py-1.5 text-right">J.Balloon</TableHead>
                      )}
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">SD Atual</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">Amort BRL</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right font-bold">PMT BRL</TableHead>
                      <TableHead className="font-semibold text-slate-500 whitespace-nowrap px-1 py-1.5 text-right">SD Fin BRL</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* LINHA 0 (OPERAÇÃO) - Apenas visão contábil USD */}
                {isUSD && viewMode === "contabil" && page === 0 && row0 && (
                  <TableRow className="bg-slate-50 border-l-4 border-slate-300">
                    <TableCell className="font-mono text-center text-slate-600 px-1 py-0.5">
                      <TooltipProvider>
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">0</span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs text-xs">
                            <p className="font-semibold mb-1">Linha de Abertura Referencial</p>
                            <p className="text-slate-600">Não gera lançamento contábil.</p>
                            <p className="text-slate-600">A variação cambial inicial será reconhecida na parcela 1.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap text-slate-600 px-1 py-0.5">
                      {formatDate(row0.dataVencimento)}
                    </TableCell>
                    <TableCell className="font-mono text-right text-blue-700 px-1 py-0.5 bg-blue-50/30">
                      ${row0.sdInicial_USD?.toLocaleString('en-US', {minimumFractionDigits: 2})}
                    </TableCell>
                    <TableCell className="font-mono text-right text-slate-600 px-1 py-0.5">
                      {row0.ptax_anterior?.toFixed(4)}
                    </TableCell>
                    <TableCell className="font-mono text-right text-blue-600 px-1 py-0.5">
                      {row0.ptax_atual?.toFixed(4)}
                    </TableCell>
                    <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                      {formatCurrency(row0.aberturaBRL)}
                    </TableCell>
                    <TableCell className="font-mono text-right text-slate-400 px-1 py-0.5">
                      —
                    </TableCell>
                    <TableCell className="font-mono text-right text-slate-400 px-1 py-0.5">
                      —
                    </TableCell>
                    <TableCell className="font-mono text-right text-slate-400 px-1 py-0.5">
                      —
                    </TableCell>
                    <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                      {formatCurrency(row0.fechamento)}
                    </TableCell>
                  </TableRow>
                )}
                
                {/* Aviso se PTAX da operação não existe */}
                {isUSD && viewMode === "contabil" && page === 0 && row0Warning && (
                  <TableRow className="bg-amber-50">
                    <TableCell colSpan={10} className="text-center text-xs text-amber-700 py-2">
                      ⚠️ {row0Warning} — Linha 0 não renderizada
                    </TableCell>
                  </TableRow>
                )}
                
                {pageData.map((row, idx) => {
                   // Ajuste 3: Detectar amortização negativa em PRICE
                   const isNegativeAmortization = calculationSystem === "PRICE" && row.amortizacao === 0;

                   // Ajuste 2: Segregação contábil CPC 26 (curto vs longo prazo)
                   const daysUntil = getDaysUntil(row.dataVencimento);
                   const isShortTerm = daysUntil <= 365; // até 12 meses

                   return (
                    <TableRow
                      key={row.parcela}
                      className={`${
                        isNegativeAmortization 
                          ? "bg-red-50 hover:bg-red-100/60" 
                          : idx % 2 === 0 
                            ? "bg-white" 
                            : "bg-slate-50/50"
                      } hover:bg-blue-50/40 transition-colors ${isNegativeAmortization ? "border-l-4 border-red-500" : ""}`}
                    >
                    <TableCell className="font-mono text-center font-medium text-slate-600 px-1 py-0.5">
                      <div className="flex items-center justify-center gap-1">
                        <span>{row.parcela}</span>
                        {isShortTerm && (
                          <Badge variant="default" className="text-[8px] px-1.5 py-0 bg-blue-600">CP</Badge>
                        )}
                        {!isShortTerm && (
                          <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-orange-300 text-orange-700">LP</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap text-slate-700 px-1 py-0.5">
                      {editMode ? (
                        <input
                          type="date"
                          value={row.dataVencimento}
                          onChange={(e) => handleDateChange(page * PAGE_SIZE + idx, e.target.value)}
                          className="w-28 text-[10px] px-1 py-0.5 border rounded"
                        />
                      ) : (
                        formatDate(row.dataVencimento)
                      )}
                    </TableCell>

                    {/* FASE 2 PASSO 2: VISÃO FINANCEIRA (usar campos fxAtual) */}
                    {isUSD && viewMode === "financeiro" && (
                      <>
                        <TableCell className="font-mono text-right text-blue-700 px-1 py-0.5 bg-blue-50/30">
                          ${row.sdInicial_USD?.toLocaleString('en-US', {minimumFractionDigits: 2})}
                        </TableCell>
                        <TableCell className="font-mono text-right text-blue-600 px-1 py-0.5">
                          {row.ptax_rate?.toFixed(4)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                          {formatCurrency(row.sdInicial_BRL_fxAtual || row.sdInicial)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-amber-700 px-1 py-0.5">
                          ${row.jurosTotal_USD?.toLocaleString('en-US', {minimumFractionDigits: 2})}
                        </TableCell>
                        <TableCell className="font-mono text-right text-amber-700 px-1 py-0.5">
                          {formatCurrency(row.jurosTotal_BRL_fxAtual || (row.jurosFixosMes + row.jurosVariaveisMes))}
                        </TableCell>
                        <TableCell className="font-mono text-right text-blue-700 px-1 py-0.5 bg-blue-50/30">
                          ${row.amortizacao_USD?.toLocaleString('en-US', {minimumFractionDigits: 2})}
                        </TableCell>
                        <TableCell className="font-mono text-right text-blue-700 font-medium px-1 py-0.5">
                          {formatCurrency(row.amortizacao_BRL_fxAtual || row.amortizacao)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-emerald-700 px-1 py-0.5 bg-emerald-50/30">
                          ${row.prestacao_USD?.toLocaleString('en-US', {minimumFractionDigits: 2})}
                        </TableCell>
                        <TableCell className="font-mono text-right text-emerald-700 font-bold px-1 py-0.5 border-l border-emerald-200">
                          {formatCurrency(row.prestacao_BRL_fxAtual || row.prestacao)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-blue-700 px-1 py-0.5 bg-blue-50/30">
                          ${row.sdFinal_USD?.toLocaleString('en-US', {minimumFractionDigits: 2})}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                          {formatCurrency(row.sdFinal_BRL_fxAtual || row.sdFinal)}
                        </TableCell>
                      </>
                    )}

                    {/* FASE 2 PASSO 3: VISÃO CONTÁBIL (usar blocoContabil) */}
                    {isUSD && viewMode === "contabil" && (
                      <>
                        <TableCell className="font-mono text-right text-blue-700 px-1 py-0.5 bg-blue-50/30">
                          ${row.sdInicial_USD?.toLocaleString('en-US', {minimumFractionDigits: 2})}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-600 px-1 py-0.5">
                          {row.blocoContabil?.ptax_anterior?.toFixed(4) || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-right text-blue-600 px-1 py-0.5">
                          {row.blocoContabil?.ptax_atual?.toFixed(4) || row.ptax_rate?.toFixed(4)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                          {formatCurrency(row.blocoContabil?.valorAberturaBRL || row.sdInicial)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-orange-700 px-1 py-0.5 bg-orange-50/30">
                          {formatCurrency(row.blocoContabil?.ajusteCambialMes || row.varCambial)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-amber-700 px-1 py-0.5">
                          {formatCurrency(row.blocoContabil?.jurosCapitalizadosBRL || (row.jurosFixosMes + row.jurosVariaveisMes))}
                        </TableCell>
                        <TableCell className="font-mono text-right text-blue-700 font-medium px-1 py-0.5">
                          {formatCurrency(row.blocoContabil?.amortizacaoPagaBRL || row.amortizacao)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                          {formatCurrency(row.blocoContabil?.valorFechamentoBRL || row.sdFinal)}
                        </TableCell>
                      </>
                    )}

                    {/* BRL (sem USD) - visão única */}
                    {!isUSD && (
                      <>
                        <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                          {formatCurrency(row.sdInicial)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-500 px-1 py-0.5">
                          {row.diasCorridos}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-500 px-1 py-0.5">
                          {row.diasUteis}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-600 px-1 py-0.5">
                          {formatPercent(((Math.pow(1 + params?.fixed_rate / 100, row.diasCorridos / calculationBase) - 1) * 100))}
                        </TableCell>
                        <TableCell className="font-mono text-right text-amber-700 px-1 py-0.5">
                          {formatCurrency(row.jurosFixosMes)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-600 px-1 py-0.5">
                          {formatPercent(row.indexadorPercent)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-amber-600 px-1 py-0.5">
                          {formatCurrency(row.jurosVariaveisMes)}
                        </TableCell>
                        <TableCell className="font-mono text-right font-semibold text-amber-700 px-1 py-0.5 border-l border-amber-200">
                          {formatCurrency(row.jurosFixosMes + row.jurosVariaveisMes)}
                        </TableCell>
                        {displaySchedule.some(r => (r.jurosAcruados || 0) > 0) && (
                          <TableCell className="font-mono text-right text-purple-700 font-semibold px-1 py-0.5 bg-purple-50/50">
                            {formatCurrency(row.jurosAcruados || 0)}
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                          {formatCurrency(row.sdAtualizado)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-blue-700 font-medium px-1 py-0.5">
                          {formatCurrency(row.amortizacao)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-emerald-700 font-bold px-1 py-0.5 border-l border-emerald-200">
                          {formatCurrency(row.prestacao)}
                        </TableCell>
                        <TableCell className="font-mono text-right text-slate-700 px-1 py-0.5">
                          {formatCurrency(row.sdFinal)}
                        </TableCell>
                      </>
                    )}
                    </TableRow>
                    );
                    })}
                     {/* TOTAIS */}
                     <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                     
                     {/* BUG FIX 5: Totais com constantes (evitar desalinhamento) */}
                     {/* TOTAIS - VISÃO FINANCEIRA (11 colunas) */}
                     {isUSD && viewMode === "financeiro" && (
                       <>
                         <TableCell colSpan={2} className="font-bold text-slate-700 text-right px-1 py-1.5">TOTAL →</TableCell>
                         <TableCell /> {/* SD Ini USD */}
                         <TableCell /> {/* PTAX */}
                         <TableCell /> {/* SD Ini BRL */}
                         <TableCell className="font-mono text-right font-bold text-amber-700 px-1 py-1.5 bg-amber-50/30">
                           ${(schedule.reduce((s, r) => s + (r.jurosTotal_USD || 0), 0)).toLocaleString('en-US', {minimumFractionDigits: 2})}
                         </TableCell>
                         <TableCell className="font-mono text-right font-bold text-amber-700 px-1 py-1.5">
                           {formatCurrency(schedule.reduce((s, r) => s + (r.jurosTotal_BRL_fxAtual || (r.jurosFixosMes + r.jurosVariaveisMes)), 0))}
                         </TableCell>
                         <TableCell className="font-mono text-right font-bold text-blue-700 px-1 py-1.5 bg-blue-50/30">
                           ${schedule.reduce((s, r) => s + (r.amortizacao_USD || 0), 0).toLocaleString('en-US', {minimumFractionDigits: 2})}
                         </TableCell>
                         <TableCell className="font-mono text-right font-bold text-blue-700 px-1 py-1.5">
                           {formatCurrency(schedule.reduce((s, r) => s + (r.amortizacao_BRL_fxAtual || r.amortizacao), 0))}
                         </TableCell>
                         <TableCell className="font-mono text-right font-bold text-emerald-700 px-1 py-1.5 bg-emerald-50/30">
                           ${schedule.reduce((s, r) => s + (r.prestacao_USD || 0), 0).toLocaleString('en-US', {minimumFractionDigits: 2})}
                         </TableCell>
                         <TableCell className="font-mono text-right font-bold text-emerald-700 px-1 py-1.5 border-l border-emerald-200">
                           {formatCurrency(totalPrestacao)}
                         </TableCell>
                         <TableCell /> {/* SD Fin USD */}
                         <TableCell className="font-mono text-right font-bold text-slate-700 px-1 py-1.5">{formatCurrency(0)}</TableCell>
                       </>
                     )}
                     
                     {/* TOTAIS - VISÃO CONTÁBIL (8 colunas) */}
                     {isUSD && viewMode === "contabil" && (
                      <>
                        <TableCell colSpan={2} className="font-bold text-slate-700 text-right px-1 py-1.5">TOTAL →</TableCell>
                        <TableCell /> {/* SD Ini USD */}
                        <TableCell /> {/* PTAX Ant */}
                        <TableCell /> {/* PTAX Atual */}
                        <TableCell /> {/* Abertura BRL */}
                        <TableCell className="font-mono text-right font-bold text-orange-700 px-1 py-1.5 bg-orange-50/30">
                          {formatCurrency(
                            (scheduleAdjusted || schedule).reduce((s, r) => s + (r.blocoContabil?.ajusteCambialMes || r.varCambial || 0), 0)
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-right font-bold text-amber-700 px-1 py-1.5">
                          {formatCurrency((scheduleAdjusted || schedule).reduce((s, r) => s + (r.blocoContabil?.jurosCapitalizadosBRL || (r.jurosFixosMes + r.jurosVariaveisMes)), 0))}
                        </TableCell>
                        <TableCell className="font-mono text-right font-bold text-blue-700 px-1 py-1.5">
                          {formatCurrency((scheduleAdjusted || schedule).reduce((s, r) => s + (r.blocoContabil?.amortizacaoPagaBRL || r.amortizacao), 0))}
                        </TableCell>
                        <TableCell className="font-mono text-right font-bold text-slate-700 px-1 py-1.5">{formatCurrency(0)}</TableCell>
                      </>
                     )}
                     
                     {/* TOTAIS - BRL (sem USD) */}
                     {!isUSD && (
                       <>
                         <TableCell colSpan={6} className="font-bold text-slate-700 text-right px-1 py-1.5">TOTAL →</TableCell>
                         <TableCell className="font-mono text-right font-bold text-amber-700 px-1 py-1.5">
                           {formatCurrency(schedule.reduce((s, r) => s + r.jurosFixosMes, 0))}
                         </TableCell>
                         <TableCell />
                         <TableCell className="font-mono text-right font-bold text-amber-600 px-1 py-1.5">
                           {formatCurrency(schedule.reduce((s, r) => s + r.jurosVariaveisMes, 0))}
                         </TableCell>
                         <TableCell className="font-mono text-right font-bold text-amber-700 px-1 py-1.5 border-l border-amber-200">
                           {formatCurrency(schedule.reduce((s, r) => s + r.jurosFixosMes + r.jurosVariaveisMes, 0))}
                         </TableCell>
                         {displaySchedule.some(r => (r.jurosAcruados || 0) > 0) && (
                           <TableCell className="font-mono text-right font-bold text-purple-700 px-1 py-1.5 bg-purple-50/50">
                             {formatCurrency(schedule.reduce((s, r) => s + (r.jurosAcruados || 0), 0))}
                           </TableCell>
                         )}
                         <TableCell />
                         <TableCell className="font-mono text-right font-bold text-blue-700 px-1 py-1.5">
                           {formatCurrency(schedule.reduce((s, r) => s + r.amortizacao, 0))}
                         </TableCell>
                         <TableCell className="font-mono text-right font-bold text-emerald-700 px-1 py-1.5 border-l border-emerald-200">
                           {formatCurrency(totalPrestacao)}
                         </TableCell>
                         <TableCell className="font-mono text-right font-bold text-slate-700 px-1 py-1.5">{formatCurrency(0)}</TableCell>
                       </>
                     )}
                     </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
              <span className="text-xs text-slate-500">
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, schedule.length)} de {schedule.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setPage(0)} disabled={page === 0} className="text-xs h-7 px-2">Primeira</Button>
                <Button variant="ghost" size="icon" onClick={() => setPage(page - 1)} disabled={page === 0} className="h-7 w-7">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs text-slate-600 px-2 font-medium">
                  {page + 1} / {totalPages}
                </span>
                <Button variant="ghost" size="icon" onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1} className="h-7 w-7">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="text-xs h-7 px-2">Última</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* FASE 3: Reconciliação Contábil (modo contábil) */}
      {isUSD && viewMode === "contabil" && (
        <Card className="border-emerald-200 shadow-sm mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
              🧮 Reconciliação Contábil (Validação CPC 26)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-600 mb-3 font-mono">
                <strong>Identidade Contábil:</strong>
                <br />
                Fechamento BRL = Abertura BRL + Ajuste Cambial + Juros Apropriados BRL − Amortização Paga BRL
              </p>
              
              <div className="space-y-2">
                {/* LINHA 0 na reconciliação */}
                {row0 && (
                  <div className="flex items-center justify-between text-[10px] p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="font-semibold text-slate-600">Parcela 0 (Abertura):</span>
                    <span className="font-mono text-slate-600">
                      {formatCurrency(row0.fechamento)} = {formatCurrency(row0.aberturaBRL)} (não reconhece variação)
                    </span>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0">
                      Referencial
                    </Badge>
                  </div>
                )}
                
                {(scheduleAdjusted || schedule).slice(0, 5).map((row, idx) => {
                  const abertura = row.blocoContabil?.valorAberturaBRL || row.sdInicial;
                  const ajuste = row.blocoContabil?.ajusteCambialMes || row.varCambial || 0;
                  const juros = row.blocoContabil?.jurosCapitalizadosBRL || (row.jurosFixosMes + row.jurosVariaveisMes);
                  const amort = row.blocoContabil?.amortizacaoPagaBRL || row.amortizacao;
                  const fechamento = row.blocoContabil?.valorFechamentoBRL || row.sdFinal;
                  const reconciliacao = abertura + ajuste + juros - amort;
                  const delta = Math.abs(fechamento - reconciliacao);
                  const deltaStatus = delta <= 0.10 ? "OK" : "ALERTA";
                  const isValid = delta <= 0.10;
                  
                  return (
                    <div key={idx} className={`flex items-center justify-between text-[10px] p-2 rounded ${isValid ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-300"}`}>
                      <span className="font-semibold text-slate-700">Parcela {row.parcela}:</span>
                      <span className="font-mono text-slate-600">
                        {formatCurrency(fechamento)} = {formatCurrency(abertura)} + {formatCurrency(ajuste)} + {formatCurrency(juros)} − {formatCurrency(amort)}
                      </span>
                      <Badge variant={isValid ? "default" : "destructive"} className="text-[8px] px-1.5 py-0">
                        {deltaStatus} Δ={delta.toFixed(2)}
                      </Badge>
                    </div>
                  );
                })}
                
                {schedule.length > 5 && (
                  <p className="text-[10px] text-slate-400 text-center mt-2">
                    ... mostrando primeiras 5 parcelas. Veja CSV Contábil para tabela completa.
                  </p>
                )}
              </div>
              
              <div className="mt-4 pt-3 border-t border-slate-200">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  <strong>✅ Critério de validação:</strong> Delta ≤ R$ 0,10 (arredondamento contábil aceitável)
                  <br />
                  <strong className="text-emerald-700">Status:</strong> OK (delta ≤ 0,10) | ALERTA (delta &gt; 0,10)
                  <br />
                  <strong className="text-orange-700">Ajuste Cambial:</strong> SD Inicial USD × (PTAX Atual − PTAX Anterior)
                  <br />
                  <span className="text-slate-600 text-[9px] italic">→ Variação cambial do principal (não inclui caixa). Calculado sobre saldo inicial, não sobre saldo final.</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
    </>
  );
}

// BUG FIX 3: Snapshot Validation usando resultado real do cálculo
function validateSnapshotFromResult(result) {
  try {
    if (!result || !result.schedule) {
      return { passed: false, quality: "MISSING", message: "Schedule não encontrado" };
    }
    
    // BUG FIX 3: Usar snapshot real se disponível (fonte de verdade)
    if (result.snapshot?.validation) {
      return {
        passed: result.snapshot.validation.valid === true,
        quality: result.snapshot.snapshot_quality || result.snapshot.validation.quality || "UNKNOWN",
        message: result.snapshot.validation.message || "Validação do snapshot real",
        hash: result.snapshot.schedule_usd_hash
      };
    }
    
    // Fallback: validar usando calculation_metadata
    if (result.calculation_metadata) {
      const schedule = result.schedule;
      
      // Validar campos USD nativos (CRITICAL para STRICT)
      const hasUSDFields = schedule.every(r => 
        r.jurosTotal_USD !== undefined && 
        r.amortizacao_USD !== undefined &&
        r.sdInicial_USD !== undefined &&
        r.sdFinal_USD !== undefined
      );
      
      if (!hasUSDFields) {
        return { 
          passed: false, 
          quality: "MISSING_USD_NATIVE", 
          message: "Campos USD nativos ausentes - não pode ser STRICT",
          hash: result.calculation_metadata.calculation_hash_strict
        };
      }
      
      // Validar campos Phase 1 (fxAtual)
      const hasPhase1Fields = schedule.every(r =>
        r.sdInicial_BRL_fxAtual !== undefined &&
        r.jurosTotal_BRL_fxAtual !== undefined &&
        r.amortizacao_BRL_fxAtual !== undefined &&
        r.prestacao_BRL_fxAtual !== undefined &&
        r.sdFinal_BRL_fxAtual !== undefined
      );
      
      if (!hasPhase1Fields) {
        return {
          passed: false,
          quality: "MISSING_PHASE1",
          message: "Campos Phase 1 (fxAtual) ausentes",
          hash: result.calculation_metadata.calculation_hash_strict
        };
      }
      
      // Validar imutáveis
      const lastRow = schedule[schedule.length - 1];
      if (Math.abs(lastRow.sdFinal_USD || 0) > 0.01) {
        return {
          passed: false,
          quality: "INVALID_FINAL_BALANCE",
          message: `Saldo final USD não é zero: ${lastRow.sdFinal_USD}`,
          hash: result.calculation_metadata.calculation_hash_strict
        };
      }
      
      return {
        passed: true,
        quality: "STRICT",
        message: "Validação passou: USD nativos + Phase 1 + imutáveis OK",
        hash: result.calculation_metadata.calculation_hash_strict
      };
    }
    
    // Sem metadata: fallback seguro
    return {
      passed: false,
      quality: "NO_METADATA",
      message: "Metadata de cálculo ausente - validação impossível"
    };
  } catch (error) {
    return {
      passed: false,
      quality: "ERROR",
      message: `Erro na validação: ${error.message}`
    };
  }
}

function SummaryCard({ icon, label, value, color, subtitle }) {
  const Icon = icon;
  const colors = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    slate: "bg-slate-50 text-slate-700 border-slate-100",
    red: "bg-red-50 text-red-700 border-red-100",
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 opacity-60" />
        <span className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</span>
      </div>
      <p className="text-lg font-bold font-mono">{value}</p>
      {subtitle && <p className="text-[10px] opacity-70 mt-1">{subtitle}</p>}
    </div>
  );
}