/**
 * 🏦 LOG DE AUDITORIA — RASTREABILIDADE JURÍDICA
 * 
 * Registra todas as operações financeiras para defensabilidade legal
 */

/**
 * Estrutura de Log de Auditoria
 */
export class AuditLog {
  constructor(contractId, baseCurrency) {
    this.contractId = contractId;
    this.baseCurrency = baseCurrency;
    this.entries = [];
    this.startTime = new Date().toISOString();
    this.scheduleHash = null;
  }

  /**
   * Adiciona entrada de auditoria
   */
  addEntry(eventType, details) {
    this.entries.push({
      timestamp: new Date().toISOString(),
      eventType,
      details,
      entryNumber: this.entries.length + 1
    });
  }

  /**
   * Log de Cálculo Iniciado
   */
  logCalculationStart(params) {
    this.addEntry('CALCULATION_START', {
      baseCurrency: this.baseCurrency,
      calculationSystem: params.calculationSystem,
      principal: params.principal,
      fixedRate: params.fixedRate,
      operationDate: params.operationDate,
      principalInstallments: params.principalInstallments
    });
  }

  /**
   * Log de Obtenção de Taxa (PTAX/CDI)
   */
  logRateAcquisition(rateType, date, rate, source) {
    this.addEntry('RATE_ACQUISITION', {
      rateType,
      date,
      rate,
      source,
      baseCurrency: this.baseCurrency
    });
  }

  /**
   * Log de Cálculo de Juros
   */
  logInterestCalculation(parcela, jurosFixos, jurosVariaveis, total) {
    this.addEntry('INTEREST_CALCULATION', {
      parcela,
      jurosFixos,
      jurosVariaveis,
      jurosTotal: total,
      baseCurrency: this.baseCurrency
    });
  }

  /**
   * Log de Amortização
   */
  logAmortization(parcela, amortizacao, saldoAnterior, saldoFinal) {
    this.addEntry('AMORTIZATION', {
      parcela,
      amortizacao,
      saldoAnterior,
      saldoFinal,
      baseCurrency: this.baseCurrency
    });
  }

  /**
   * Log de Variação Cambial (USD only)
   */
  logExchangeVariation(parcela, sdUSD, ptaxAnterior, ptaxAtual, varCambial) {
    this.addEntry('EXCHANGE_VARIATION', {
      parcela,
      sdUSD,
      ptaxAnterior,
      ptaxAtual,
      varCambial
    });
  }

  /**
   * Log de Conversão de Moeda
   */
  logCurrencyConversion(valor, moedaOrigem, ptaxRate, valorConvertido, moedaDestino) {
    this.addEntry('CURRENCY_CONVERSION', {
      valor,
      moedaOrigem,
      ptaxRate,
      valorConvertido,
      moedaDestino
    });
  }

  /**
   * Log de Validação
   */
  logValidation(validationType, passed, details) {
    this.addEntry('VALIDATION', {
      validationType,
      passed,
      details
    });
  }

  /**
   * Log de Cálculo Concluído
   */
  logCalculationComplete(scheduleHash, totalAmortization, totalInterest) {
    this.scheduleHash = scheduleHash;
    this.endTime = new Date().toISOString();
    
    this.addEntry('CALCULATION_COMPLETE', {
      scheduleHash,
      totalAmortization,
      totalInterest,
      baseCurrency: this.baseCurrency,
      durationMs: new Date(this.endTime) - new Date(this.startTime)
    });
  }

  /**
   * Log de Erro
   */
  logError(errorType, message, details) {
    this.addEntry('ERROR', {
      errorType,
      message,
      details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Gera relatório de auditoria
   */
  generateReport() {
    return {
      contractId: this.contractId,
      baseCurrency: this.baseCurrency,
      startTime: this.startTime,
      endTime: this.endTime,
      scheduleHash: this.scheduleHash,
      totalEntries: this.entries.length,
      entries: this.entries,
      summary: this.generateSummary(),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Resumo do relatório
   */
  generateSummary() {
    const summary = {
      calculationStartCount: 0,
      rateAcquisitionCount: 0,
      interestCalculationCount: 0,
      amortizationCount: 0,
      exchangeVariationCount: 0,
      validationCount: 0,
      errorCount: 0
    };

    this.entries.forEach(entry => {
      switch (entry.eventType) {
        case 'CALCULATION_START':
          summary.calculationStartCount++;
          break;
        case 'RATE_ACQUISITION':
          summary.rateAcquisitionCount++;
          break;
        case 'INTEREST_CALCULATION':
          summary.interestCalculationCount++;
          break;
        case 'AMORTIZATION':
          summary.amortizationCount++;
          break;
        case 'EXCHANGE_VARIATION':
          summary.exchangeVariationCount++;
          break;
        case 'VALIDATION':
          summary.validationCount++;
          break;
        case 'ERROR':
          summary.errorCount++;
          break;
      }
    });

    return summary;
  }

  /**
   * Exporta para JSON (para armazenamento)
   */
  toJSON() {
    return this.generateReport();
  }

  /**
   * Exporta para CSV (auditoria simplificada)
   */
  toCSV() {
    const headers = ['Timestamp', 'Evento', 'Parcela', 'Valor', 'Moeda', 'Detalhes'];
    const rows = [headers.join(',')];

    this.entries.forEach(entry => {
      const row = [
        entry.timestamp,
        entry.eventType,
        entry.details.parcela || '-',
        entry.details.amortizacao || entry.details.jurosTotal || entry.details.rate || '-',
        this.baseCurrency,
        JSON.stringify(entry.details)
      ];
      rows.push(row.map(cell => `"${cell}"`).join(','));
    });

    return rows.join('\n');
  }

  /**
   * Valida integridade do log
   */
  validateIntegrity() {
    const issues = [];

    // Validar sequência de eventos
    let hasStart = false;
    let hasComplete = false;
    let lastTimestamp = null;

    for (const entry of this.entries) {
      if (entry.eventType === 'CALCULATION_START') hasStart = true;
      if (entry.eventType === 'CALCULATION_COMPLETE') hasComplete = true;

      // Verificar ordem cronológica
      if (lastTimestamp && entry.timestamp < lastTimestamp) {
        issues.push(`Timestamps fora de ordem: ${lastTimestamp} → ${entry.timestamp}`);
      }
      lastTimestamp = entry.timestamp;
    }

    if (!hasStart) issues.push('Log não começa com CALCULATION_START');
    if (!hasComplete) issues.push('Log não termina com CALCULATION_COMPLETE');

    return {
      valid: issues.length === 0,
      issueCount: issues.length,
      issues
    };
  }
}

/**
 * Factory para criar hash SHA-256 de schedule
 */
export async function generateScheduleHash(schedule) {
  const scheduleStr = JSON.stringify(schedule);
  const encoder = new TextEncoder();
  const data = encoder.encode(scheduleStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  AuditLog,
  generateScheduleHash
};