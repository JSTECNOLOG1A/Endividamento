import { IndexerStrategy } from "./IndexerStrategy.js";

/**
 * Dollar Indexer - Variação cambial simples
 * Captura a variação entre taxa inicial e final (spread entre datas)
 */
export class DollarIndexer extends IndexerStrategy {
  getFactor(startDate, endDate, holidays = []) {
    if (!this.rates || this.rates.length === 0) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0 };
    }

    // Busca taxa no início e no final do período
    const rateStart = this.getRateForDate(startDate);
    const rateEnd = this.getRateForDate(endDate);

    if (!rateStart || !rateEnd) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0 };
    }

    // Fator = taxa final / taxa inicial (variação cambial)
    const factor = rateEnd.annual_rate / rateStart.annual_rate;
    const rateApplied = (factor - 1) * 100;

    return {
      factor,
      rateApplied,
      daysWithRate: 1, // Apenas dois pontos de comparação
    };
  }
}