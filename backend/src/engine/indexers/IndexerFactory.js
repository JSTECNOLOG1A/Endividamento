import { CDIIndexer } from "./CDIIndexer.js";
import { SELICIndexer } from "./SELICIndexer.js";
import { DollarIndexer } from "./DollarIndexer.js";

/**
 * Factory de indexadores
 * Centraliza a criação e gestão de instâncias de indexadores
 */
export class IndexerFactory {
  constructor(cdiRates = [], selicRates = [], dollarRates = []) {
    this.cdiRates = cdiRates;
    this.selicRates = selicRates;
    this.dollarRates = dollarRates;

    // Inicializar indexadores
    this.indexers = {
      CDI: new CDIIndexer(cdiRates),
      SELIC: new SELICIndexer(selicRates),
      USD: new DollarIndexer(dollarRates),
      NA: null, // Sem indexador
    };
  }

  /**
   * Obtém o fator acumulado para um indexador em um período
   * @param {string} indexerType - Tipo: CDI, SELIC, USD, NA
   * @param {string} startDate - Data inicial (ISO format)
   * @param {string} endDate - Data final (ISO format)
   * @param {array} holidays - Array de feriados
   * @returns {object} {factor, rateApplied, daysWithRate}
   */
  getFactor(indexerType, startDate, endDate, holidays = []) {
    if (indexerType === "NA" || !indexerType) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0 };
    }

    const indexer = this.indexers[indexerType];
    if (!indexer) {
      console.warn(`Indexer type '${indexerType}' not found. Returning neutral factor.`);
      return { factor: 1, rateApplied: 0, daysWithRate: 0 };
    }

    return indexer.getFactor(startDate, endDate, holidays);
  }

  /**
   * Atualiza as taxas de um indexador
   * Útil para recalcular com dados atualizados
   */
  updateRates(indexerType, rates) {
    if (this.indexers[indexerType]) {
      this.indexers[indexerType].rates = rates;
    }
  }

  /**
   * Adiciona novos tipos de indexadores (extensibilidade)
   */
  registerIndexer(indexerType, indexerStrategy) {
    this.indexers[indexerType] = indexerStrategy;
  }
}