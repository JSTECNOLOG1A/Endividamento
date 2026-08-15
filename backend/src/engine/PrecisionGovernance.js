/**
 * 🔐 GOVERNANÇA DE PRECISÃO — ETAPA 3
 * 
 * Consolida divergências do precision_audit em relatório de governança
 * Define tolerâncias por tipo (moeda, câmbio, percentual)
 * Aplica rules de status (PASS/WARNING/FAIL)
 * 
 * IMPORTANTE: Determinístico, sem side-effects, somente leitura do audit
 */

/**
 * Define tolerâncias padrão por tipo de valor
 */
export const PRECISION_TOLERANCES = {
  raw: 1e-10,           // Arredondamento limite (praticamente zero)
  money: 0.01,          // Moeda BRL/USD: 1 centavo
  exchange: 0.0001,     // PTAX: 4 casas decimais
  percent: 1e-8,        // Percentual: 8 casas decimais
  description: "Padrão Bancário (BACEN)"
};

/**
 * Classifica campo por tipo (para aplicar tolerância correta)
 * @param {string} fieldName - Nome do campo (ex: "jurosFixosMes", "ptax_rate")
 * @returns {string} Tipo: "money" | "exchange" | "percent" | "raw"
 */
function classifyFieldType(fieldName) {
  if (fieldName.includes("ptax") || fieldName.includes("PTAX") || fieldName.includes("rate")) {
    return "exchange";
  }
  if (fieldName.includes("percent") || fieldName.includes("%") || fieldName.includes("indexador")) {
    return "percent";
  }
  // Campos monetários: sd*, juros*, amort*, prest*, var*
  if (fieldName.match(/^(sd|juros|amort|prest|var)/i)) {
    return "money";
  }
  return "raw";
}

/**
 * Classe central de governança de precisão
 * Consome relatório do PrecisionAudit e gera assessment de conformidade
 */
export class PrecisionGovernance {
  constructor(precisionAuditReport = null, config = {}) {
    this.auditReport = precisionAuditReport;
    this.tolerances = config.tolerances || PRECISION_TOLERANCES;
    this.result = {
      status: "PASS",
      tolerance: this.tolerances,
      totals: {
        parcels_checked: 0,
        divergences_found: 0,
        affected_parcels: new Set(),
        affected_fields: new Set()
      },
      max: {
        raw: 0,
        rounded: 0,
        field: null,
        parcela: null
      },
      top_fields: [],
      notes: []
    };
  }

  /**
   * Processa relatório do precision_audit
   * Aplica tolerâncias e determina status (PASS/WARNING/FAIL)
   * @returns {Object} Relatório de governança
   */
  analyze() {
    // Se não há auditoria, retorna PASS (auditoria desativada)
    if (!this.auditReport || !this.auditReport.summary || !this.auditReport.details) {
      return {
        status: "PASS",
        tolerance: this.tolerances,
        totals: {
          parcels_checked: 0,
          divergences_found: 0,
          affected_parcels: [],
          affected_fields: []
        },
        max: { raw: 0, rounded: 0, field: null, parcela: null },
        top_fields: [],
        notes: ["Auditoria de precisão desativada ou sem relatório"]
      };
    }

    // Processar divergências
    const divergences = this.auditReport.details || [];
    this.result.totals.parcels_checked = new Set(divergences.map(d => d.parcela)).size;

    // Agrupar por campo
    const fieldStats = {};
    let hasRoundedFailure = false;
    let hasRawWarning = false;

    divergences.forEach(div => {
      const fieldType = classifyFieldType(div.field);
      const tolerance = this.tolerances[fieldType];

      // Registrar divergência
      this.result.totals.divergences_found++;
      this.result.totals.affected_parcels.add(div.parcela);
      this.result.totals.affected_fields.add(div.field);

      // Atualizar máximo
      if (div.difference_rounded > this.result.max.rounded) {
        this.result.max.rounded = div.difference_rounded;
        this.result.max.field = div.field;
        this.result.max.parcela = div.parcela;
      }
      if (div.difference_raw > this.result.max.raw) {
        this.result.max.raw = div.difference_raw;
      }

      // Aplicar tolerância
      if (div.difference_rounded > tolerance) {
        hasRoundedFailure = true;
      }
      if (div.difference_raw > this.tolerances.raw) {
        hasRawWarning = true;
      }

      // Agrupar estatísticas por campo
      if (!fieldStats[div.field]) {
        fieldStats[div.field] = {
          count: 0,
          max_rounded: 0,
          max_raw: 0,
          max_parcela: null
        };
      }
      fieldStats[div.field].count++;
      fieldStats[div.field].max_rounded = Math.max(fieldStats[div.field].max_rounded, div.difference_rounded);
      fieldStats[div.field].max_raw = Math.max(fieldStats[div.field].max_raw, div.difference_raw);
      if (div.difference_rounded > fieldStats[div.field].max_rounded) {
        fieldStats[div.field].max_parcela = div.parcela;
      }
    });

    // Top 5 campos com maiores divergências
    this.result.top_fields = Object.entries(fieldStats)
      .map(([field, stats]) => ({
        field,
        divergences: stats.count,
        max_rounded: stats.max_rounded.toFixed(8),
        max_raw: stats.max_raw.toFixed(12),
        max_parcela: stats.max_parcela
      }))
      .sort((a, b) => parseFloat(b.max_rounded) - parseFloat(a.max_rounded))
      .slice(0, 5);

    // Determinar status
    if (hasRoundedFailure) {
      this.result.status = "FAIL";
      this.result.notes.push(
        `❌ FALHA: Divergências arredondadas excedem tolerância monetária (${this.tolerances.money}). ` +
        `Campo crítico: ${this.result.max.field} na parcela ${this.result.max.parcela} (${this.result.max.rounded.toFixed(8)})`
      );
    } else if (hasRawWarning && !hasRoundedFailure) {
      this.result.status = "WARNING";
      this.result.notes.push(
        `⚠️ AVISO: Divergências brutas > ${this.tolerances.raw}, mas arredondadas estão OK. ` +
        `Campo afetado: ${this.result.max.field} (raw: ${this.result.max.raw.toFixed(12)})`
      );
    } else {
      this.result.status = "PASS";
      this.result.notes.push("✅ PASSOU: Todas as divergências dentro das tolerâncias.");
    }

    // Converter Sets para Arrays
    this.result.totals.affected_parcels = Array.from(this.result.totals.affected_parcels).sort((a, b) => a - b);
    this.result.totals.affected_fields = Array.from(this.result.totals.affected_fields).sort();

    return this.result;
  }

  /**
   * Retorna resultado final
   */
  getResult() {
    return this.result;
  }
}

/**
 * Factory para criar governança a partir de auditoria
 * @param {Object} precisionAuditReport - Relatório do PrecisionAudit.generateReport()
 * @param {Object} config - Configuração de tolerâncias
 * @returns {Object} Relatório de governança
 */
export function createPrecisionGovernance(precisionAuditReport = null, config = {}) {
  const gov = new PrecisionGovernance(precisionAuditReport, config);
  return gov.analyze();
}

export default { PrecisionGovernance, createPrecisionGovernance, PRECISION_TOLERANCES };