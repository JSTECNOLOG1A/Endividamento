import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { saveCalculationSnapshot } from "../loan/CalculationSnapshotPersistence";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Lock, 
  Download, 
  Calendar, 
  AlertCircle,
  CheckCircle,
  Clock,
  TrendingDown,
  TrendingUp,
  RefreshCw
} from "lucide-react";
import { toast } from "@/lib/notify";

export default function ApprovedContractManager({ contract, onContractUpdate }) {
  const [freezing, setFreezing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(
    new Date().toISOString().slice(0, 7) // YYYY-MM
  );
  const [prorataDate, setProrataDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [showProrata, setShowProrata] = useState(false);
  const [conciliarDate, setConciliarDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [conciliationResult, setConciliationResult] = useState(null);
  const [conciliating, setConciliating] = useState(false);

  const scheduleData = contract.schedule_data ? JSON.parse(contract.schedule_data) : null;
  const isApproved = contract.status === "aprovado";
  const hasSnapshot = contract.rate_snapshot !== null;

  // 1️⃣ CONGELAR CONTRATO
  const handleFreezeContract = async () => {
    try {
      setFreezing(true);

      // Usar cálculo existente para gerar snapshot
      const calculation = scheduleData.calculation_metadata || {};
      const rateSnapshot = scheduleData.rate_snapshot || {};

      // 🔐 ETAPA 4B: Salvar snapshot institucional
      let snapshotId = null;
      try {
        const snapshot = await saveCalculationSnapshot(
          scheduleData,
          { id: contract.id, contract_number: contract.contract_number },
          "APPROVED"
        );
        snapshotId = snapshot.id;
        console.log(`✅ Snapshot criado: ${snapshotId}`);
      } catch (snapshotError) {
        console.warn(`⚠️ Erro ao salvar snapshot (não bloqueia aprovação): ${snapshotError.message}`);
        // Continuar mesmo se snapshot falhar (não bloqueia aprovação)
      }

      const updatedContract = await base44.entities.LoanContract.update(contract.id, {
        status: "aprovado", // Mudar de rascunho para aprovado
        approved_by: (await base44.auth.me()).email,
        approved_date: new Date().toISOString(),
        rate_snapshot: rateSnapshot,
        calculation_hash: calculation.calculation_hash,
        calculation_hash_strict: calculation.calculation_hash_strict,
        current_snapshot_id: snapshotId,
        approved_snapshot_id: snapshotId
      });

      toast.success("Contrato congelado com sucesso", {
        description: `Hash: ${calculation.calculation_hash_strict?.slice(0, 8)}... | Snapshot: ${snapshotId?.slice(0, 8) || "skipped"}`,
      });

      if (onContractUpdate) onContractUpdate(updatedContract);
    } catch (error) {
      toast.error("Não foi possível congelar o contrato", {
        description: error.message,
      });
    } finally {
      setFreezing(false);
    }
  };

  // 2️⃣ COMPETÊNCIA MENSAL (Filtrar por mês)
  const getMonthlyEvents = () => {
    if (!scheduleData?.schedule) return [];

    const [year, month] = selectedMonth.split("-");
    const targetMonth = parseInt(month);
    const targetYear = parseInt(year);

    return scheduleData.schedule.filter((row) => {
      const rowDate = new Date(row.dataVencimento);
      return rowDate.getMonth() + 1 === targetMonth && rowDate.getFullYear() === targetYear;
    });
  };

  // 3️⃣ EXPORTAR MEMÓRIA DE CÁLCULO
  const handleExportMemory = () => {
    if (!scheduleData?.calculation_metadata) {
      toast.warning("Nenhuma memória de cálculo disponível");
      return;
    }

    const metadata = scheduleData.calculation_metadata;
    const disclosure = scheduleData.disclosure_automated || {};

    // Criar objeto JSON para download
    const memoryReport = {
      tipoRelatorio: "MEMÓRIA DE CÁLCULO",
      contratoNumero: contract.contract_number,
      data: new Date().toISOString(),
      hash: metadata.calculation_hash_strict?.slice(0, 16) + "...",
      motorVersao: metadata.engine_version,
      buildId: metadata.engine_build_id,
      
      taxas: {
        ptaxSeriesId: metadata.ptax_series_id,
        cdiSeriesId: metadata.cdi_series_id,
        usedSnapshot: metadata.used_snapshot_rates,
      },

      disclosure: {
        cetNominal: disclosure.cet_nominal,
        cetProjetado: disclosure.cet_real_projetado,
        totalJuros: disclosure.total_juros,
        totalPago: disclosure.total_pago,
        taxaRiscoMoeda: disclosure.currency_risk,
        taxasProjetadas: disclosure.projected_rates_used,
      },

      riskFlags: scheduleData.risk_flags || [],
      calculoExactoEm: metadata.calculated_at,
    };

    // Download JSON
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(memoryReport, null, 2)], { type: "application/json" })
    );
    link.download = `Memoria_${contract.contract_number}_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();

    toast.success("Memória de cálculo exportada");
  };

  // 4️⃣ PRO-RATA DIE (Apropriação por data de corte)
  const calculateProrata = () => {
    if (!scheduleData?.schedule || !prorataDate) return null;

    const cutoffDate = new Date(prorataDate + "T23:59:59");
    let accumulatedInterest = 0;
    let accumulatedPrincipal = 0;

    scheduleData.schedule.forEach((row) => {
      const rowDate = new Date(row.dataVencimento);
      
      if (rowDate <= cutoffDate) {
        // Adicionar juros apropriados até a data de corte
        accumulatedInterest += (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
        accumulatedPrincipal += row.amortizacao || 0;
      } else if (rowDate > cutoffDate) {
        // Pro-rata do período: calcular proporcionalmente
        const daysFromStart = Math.ceil(
          (rowDate.getTime() - (scheduleData.schedule[0] && new Date(scheduleData.schedule[0].dataVencimento).getTime() || cutoffDate.getTime())) / 
          (1000 * 60 * 60 * 24)
        );
        
        const daysToCutoff = Math.ceil(
          (cutoffDate.getTime() - (scheduleData.schedule[0] && new Date(scheduleData.schedule[0].dataVencimento).getTime() || cutoffDate.getTime())) / 
          (1000 * 60 * 60 * 24)
        );

        const proportion = Math.min(1, Math.max(0, daysToCutoff / daysFromStart));
        
        accumulatedInterest += ((row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0)) * proportion;
        accumulatedPrincipal += (row.amortizacao || 0) * proportion;
      }
    });

    return {
      cutoffDate: prorataDate,
      interestAccrued: Math.round(accumulatedInterest * 100) / 100,
      principalAccrued: Math.round(accumulatedPrincipal * 100) / 100,
      totalAccrued: Math.round((accumulatedInterest + accumulatedPrincipal) * 100) / 100,
    };
  };

  // 5️⃣ CONCILIAR PTAX COM BACEN
  const handleConciliatePTAX = async () => {
    try {
      setConciliating(true);

      // Buscar PTAX oficial do BACEN
      const response = await base44.functions.invoke('getPTAXFromBACEN', {
        targetDate: conciliarDate,
        lag: contract.exchange_lag || 1
      });

      if (!response.data?.official) {
        throw new Error('Nenhuma taxa encontrada no BACEN');
      }

      const officialRate = response.data.official;

      // Buscar taxa salva no contrato
      let savedRate = null;
      if (contract.exchange_rates) {
        try {
          const rates = JSON.parse(contract.exchange_rates);
          if (Array.isArray(rates)) {
            for (let i = rates.length - 1; i >= 0; i--) {
              if (rates[i].rate_date <= conciliarDate) {
                savedRate = rates[i];
                break;
              }
            }
          }
        } catch (e) {
          console.error('Erro ao parsear taxas salvas:', e);
        }
      }

      // Comparar
      const divergence = savedRate 
        ? Math.abs(savedRate.ptax_rate - officialRate.ptax_rate)
        : null;

      const result = {
        targetDate: conciliarDate,
        savedRate: savedRate ? {
          date: savedRate.rate_date,
          rate: savedRate.ptax_rate,
          source: savedRate.source || 'USER_IMPORTED'
        } : null,
        officialRate: {
          date: officialRate.rate_date,
          rate: officialRate.ptax_rate,
          source: officialRate.source
        },
        divergence: divergence,
        status: divergence === null 
          ? 'NO_SAVED_RATE'
          : divergence < 0.001 
            ? 'CONCORDANT'
            : 'DIVERGENT',
        warning: officialRate.warning || null
      };

      setConciliationResult(result);

      // Toast
      if (result.status === 'CONCORDANT') {
        toast.success("As taxas estão de acordo", {
          description: `Diferença: R$ ${divergence.toFixed(4)}`,
        });
      } else if (result.status === "DIVERGENT") {
        toast.warning("Há uma divergência de PTAX", {
          description: `Salva: ${savedRate.ptax_rate} · Oficial: ${officialRate.ptax_rate}`,
        });
      } else {
        toast.info("Nenhuma taxa salva nesta data", {
          description: `Taxa oficial BACEN: ${officialRate.ptax_rate}`,
        });
      }
    } catch (error) {
      toast.error("Não foi possível conciliar a PTAX", {
        description: error.message,
      });
      setConciliationResult(null);
    } finally {
      setConciliating(false);
    }
  };

  const monthlyEvents = getMonthlyEvents();
  const prorataData = showProrata ? calculateProrata() : null;

  return (
    <div className="space-y-6">
      {/* STATUS CONTRATO */}
      <Card className={isApproved ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50"}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isApproved ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="font-semibold text-green-900">Contrato Aprovado</p>
                    <p className="text-xs text-green-700">
                      Aprovado por: {contract.approved_by} em {new Date(contract.approved_date).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Clock className="w-5 h-5 text-yellow-600" />
                  <div>
                    <p className="font-semibold text-yellow-900">Contrato em Rascunho</p>
                    <p className="text-xs text-yellow-700">Clique abaixo para congelar e aprovar</p>
                  </div>
                </>
              )}
            </div>
            {!isApproved && (
              <Button
                onClick={handleFreezeContract}
                disabled={freezing}
                className="bg-green-600 hover:bg-green-700 gap-2"
              >
                <Lock className="w-4 h-4" />
                {freezing ? "Congelando..." : "Congelar Contrato"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isApproved && hasSnapshot && (
        <>
          {/* 2️⃣ COMPETÊNCIA MENSAL */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="w-4 h-4 text-blue-600" />
                Competência Mensal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-600 uppercase">
                  Selecione o Mês
                </Label>
                <Input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="h-9"
                />
              </div>

              {monthlyEvents.length > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-slate-50 p-3 rounded border border-slate-200">
                      <p className="text-xs text-slate-600 uppercase font-medium">Juros Fixo</p>
                      <p className="font-bold text-slate-900">
                        R$ {monthlyEvents.reduce((s, r) => s + (r.jurosFixosMes || 0), 0).toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded border border-slate-200">
                      <p className="text-xs text-slate-600 uppercase font-medium">Juros Variável</p>
                      <p className="font-bold text-slate-900">
                        R$ {monthlyEvents.reduce((s, r) => s + (r.jurosVariaveisMes || 0), 0).toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                      <p className="text-xs text-blue-600 uppercase font-medium">Var. Cambial</p>
                      <p className="font-bold text-blue-900">
                        R$ {monthlyEvents.reduce((s, r) => s + (r.varCambial || 0), 0).toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                      <p className="text-xs text-blue-600 uppercase font-medium">Amortização</p>
                      <p className="font-bold text-blue-900">
                        R$ {monthlyEvents.reduce((s, r) => s + (r.amortizacao || 0), 0).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Detalhe das parcelas */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600 uppercase">Parcelas</p>
                    <div className="space-y-1">
                      {monthlyEvents.map((row) => (
                        <div key={row.id} className="text-xs p-2 bg-slate-50 rounded border border-slate-200 flex justify-between">
                          <span className="font-medium text-slate-700">
                            Parc. {row.parcela} - {row.dataVencimento}
                          </span>
                          <span className="text-slate-900">R$ {row.prestacao?.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    Nenhuma parcela vence neste mês.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* 3️⃣ EXPORTAR MEMÓRIA */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Download className="w-4 h-4 text-purple-600" />
                Memória de Cálculo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 mb-4">
                Exporte a memória de cálculo com hash de auditoria para anexar ao lançamento contábil.
              </p>
              <Button
                onClick={handleExportMemory}
                variant="outline"
                className="gap-2 w-full"
              >
                <Download className="w-4 h-4" />
                Exportar JSON de Auditoria
              </Button>
            </CardContent>
          </Card>

          {/* 4️⃣ PRO-RATA DIE */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="w-4 h-4 text-orange-600" />
                Pro-rata Die (Apropriação)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-600 uppercase">
                  Data de Corte (Ex: 31/12)
                </Label>
                <Input
                  type="date"
                  value={prorataDate}
                  onChange={(e) => setProrataDate(e.target.value)}
                  className="h-9"
                />
              </div>

              <Button
                onClick={() => setShowProrata(!showProrata)}
                variant="secondary"
                className="w-full"
              >
                {showProrata ? "Ocultar" : "Calcular Pro-rata"}
              </Button>

              {prorataData && (
                <div className="space-y-3 pt-4 border-t">
                  <div className="grid grid-cols-1 gap-2">
                    <div className="bg-orange-50 p-3 rounded border border-orange-200">
                      <p className="text-xs text-orange-600 uppercase font-medium">Juros Apropriados</p>
                      <p className="font-bold text-orange-900">R$ {prorataData.interestAccrued.toFixed(2)}</p>
                    </div>
                    <div className="bg-orange-50 p-3 rounded border border-orange-200">
                      <p className="text-xs text-orange-600 uppercase font-medium">Principal Apropriado</p>
                      <p className="font-bold text-orange-900">R$ {prorataData.principalAccrued.toFixed(2)}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded border border-slate-200">
                      <p className="text-xs text-slate-600 uppercase font-medium">Total até {prorataData.cutoffDate}</p>
                      <p className="font-bold text-slate-900">R$ {prorataData.totalAccrued.toFixed(2)}</p>
                    </div>
                  </div>

                  <Alert>
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription className="text-xs">
                      Use este valor para lançar a apropriação de exercício no fechamento.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 5️⃣ CONCILIAR PTAX COM BACEN */}
          {contract.currency_id && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="w-4 h-4 text-red-600" />
                  Conciliar PTAX com BACEN
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600 uppercase">
                    Data para Conciliação
                  </Label>
                  <Input
                    type="date"
                    value={conciliarDate}
                    onChange={(e) => setConciliarDate(e.target.value)}
                    className="h-9"
                  />
                </div>

                <Button
                  onClick={handleConciliatePTAX}
                  disabled={conciliating}
                  className="w-full bg-red-600 hover:bg-red-700 gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${conciliating ? 'animate-spin' : ''}`} />
                  {conciliating ? "Consultando BACEN..." : "Conciliar com BACEN"}
                </Button>

                {conciliationResult && (
                  <div className="space-y-3 pt-4 border-t">
                    {/* Status */}
                    <div className={`p-3 rounded border flex items-center gap-2 ${
                      conciliationResult.status === 'CONCORDANT' 
                        ? 'bg-green-50 border-green-200'
                        : conciliationResult.status === 'DIVERGENT'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-blue-50 border-blue-200'
                    }`}>
                      {conciliationResult.status === 'CONCORDANT' && (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      )}
                      {conciliationResult.status === 'DIVERGENT' && (
                        <AlertCircle className="w-5 h-5 text-red-600" />
                      )}
                      {conciliationResult.status === 'NO_SAVED_RATE' && (
                        <Clock className="w-5 h-5 text-blue-600" />
                      )}
                      <div>
                        <p className={`font-semibold ${
                          conciliationResult.status === 'CONCORDANT' 
                            ? 'text-green-900'
                            : conciliationResult.status === 'DIVERGENT'
                            ? 'text-red-900'
                            : 'text-blue-900'
                        }`}>
                          {conciliationResult.status === 'CONCORDANT' && '✅ Taxas Concordam'}
                          {conciliationResult.status === 'DIVERGENT' && '⚠️ Divergência Detectada'}
                          {conciliationResult.status === 'NO_SAVED_RATE' && 'ℹ️ Nenhuma Taxa Salva'}
                        </p>
                      </div>
                    </div>

                    {/* Comparação */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {conciliationResult.savedRate && (
                        <div className="bg-slate-50 p-3 rounded border border-slate-200">
                          <p className="text-xs text-slate-600 uppercase font-medium">Taxa Salva</p>
                          <p className="font-bold text-slate-900">{conciliationResult.savedRate.rate.toFixed(4)}</p>
                          <p className="text-xs text-slate-500">{conciliationResult.savedRate.date}</p>
                        </div>
                      )}
                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <p className="text-xs text-blue-600 uppercase font-medium">Taxa BACEN</p>
                        <p className="font-bold text-blue-900">{conciliationResult.officialRate.rate.toFixed(4)}</p>
                        <p className="text-xs text-blue-500">{conciliationResult.officialRate.date}</p>
                      </div>
                    </div>

                    {/* Divergência */}
                    {conciliationResult.divergence !== null && (
                      <div className="bg-orange-50 p-3 rounded border border-orange-200">
                        <p className="text-xs text-orange-600 uppercase font-medium">Divergência</p>
                        <p className="font-bold text-orange-900">
                          {conciliationResult.divergence.toFixed(6)} 
                          <span className="ml-2 text-xs text-orange-600">
                            ({(conciliationResult.divergence * 100).toFixed(4)}%)
                          </span>
                        </p>
                      </div>
                    )}

                    {/* Warning */}
                    {conciliationResult.warning && (
                      <Alert>
                        <AlertCircle className="w-4 h-4" />
                        <AlertDescription className="text-xs">
                          {conciliationResult.warning}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}