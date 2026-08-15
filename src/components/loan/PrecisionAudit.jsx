/**
 * 🔐 AUDITORIA DE PRECISÃO — SHADOW CALCULATION
 * 
 * ETAPA 2: Validação paralela sem alterar cálculos existentes
 * 
 * Função: Registrar divergências entre Number (atual) e Decimal (PrecisionLayer)
 * Propósito: Garantir migração determinística sem regressão
 */

import { toDecimal, toNumber, isEqual, initPrecision } from "./PrecisionLayer";
import { roundMoney } from "./roundMoney";

/**
 * Classe central de auditoria
 */
export class PrecisionAudit {
  constructor() {
    this.differences = [];
    this.summary = {
      total_differences: 0,
      max_difference: 0,
      parcela_max_diff: null,
      campo_afetado: null,
      details: []
    };
  }

  /**
   * Registra divergência se encontrada (com dual-rounding: raw + aligned)
   * @param {string} fieldName - Nome do campo (ex: "jurosFixos")
   * @param {number} numberValue - Valor calculado com Number (fluxo principal)
   * @param {number|Decimal} decimalValue - Valor calculado com Decimal (audit shadow)
   * @param {number} parcela - Número da parcela
   * @param {number} tolerance - Tolerância em centavos (default 0.01)
   */
  logIfDifferent(fieldName, numberValue, decimalValue, parcela, tolerance = 0.01) {
    // Inicializar Decimal se ainda não foi
    initPrecision();
    
    const nVal = parseFloat(numberValue);
    const dVal = typeof decimalValue === 'object' ? toNumber(decimalValue) : parseFloat(decimalValue);
    
    // 🔐 DUAL-ROUNDING: Comparar em dois cenários
    const diff_raw = Math.abs(nVal - dVal); // Diferença bruta (sem arredondar)
    
    // Aplicar MESMA política do roundMoney (HALF_EVEN)
    const nVal_rounded = roundMoney(nVal, 2);
    const dVal_rounded = roundMoney(dVal, 2);
    const diff_rounded = Math.abs(nVal_rounded - dVal_rounded); // Com arredondamento institucional
    
    // Registrar somente se ambas as diferenças excedem tolerância
    if (diff_raw > tolerance && diff_rounded > tolerance) {
      const entry = {
        parcela,
        field: fieldName,
        number_value: nVal,
        decimal_value: dVal,
        difference_raw: diff_raw,
        difference_rounded: diff_rounded,
        number_value_rounded: nVal_rounded,
        decimal_value_rounded: dVal_rounded,
        percentage_error: Math.abs((diff_rounded / Math.max(Math.abs(nVal_rounded), 0.01)) * 100)
      };
      
      this.differences.push(entry);
      this.summary.total_differences++;
      
      // Atualizar máximo (usar diff_rounded para consistência)
      if (diff_rounded > this.summary.max_difference) {
        this.summary.max_difference = diff_rounded;
        this.summary.parcela_max_diff = parcela;
        this.summary.campo_afetado = fieldName;
      }
    }
  }

  /**
   * Gera relatório final com dupla análise (raw + rounded)
   * @returns {Object} Resumo de divergências
   */
  generateReport() {
    this.summary.details = this.differences.slice(0, 20); // Top 20 divergências
    this.summary.total_differences_raw = this.differences.filter(d => d.difference_raw > 0.01).length;
    this.summary.total_differences_rounded = this.differences.length;
    
    return {
      passed: this.summary.total_differences === 0,
      status: this.summary.total_differences === 0 ? "PASS" : "FAIL",
      summary: this.summary,
      rounding_policy: "HALF_EVEN (Banker's Rounding)",
      message: this.summary.total_differences === 0
        ? "✅ Shadow Calculation passou: PrecisionLayer seguro para migração (rounding aligned com roundMoney)"
        : `⚠️ ${this.summary.total_differences} divergências após arredondamento (máx rounded: ${this.summary.max_difference.toFixed(6)} em parcela ${this.summary.parcela_max_diff}, campo: ${this.summary.campo_afetado})`
    };
  }

  /**
   * Reset para novo cálculo
   */
  reset() {
    this.differences = [];
    this.summary = {
      total_differences: 0,
      max_difference: 0,
      parcela_max_diff: null,
      campo_afetado: null,
      details: []
    };
  }
}

export default PrecisionAudit;