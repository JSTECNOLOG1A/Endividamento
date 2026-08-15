import { IndexerStrategy } from "./IndexerStrategy.js";

/**
 * CDI Indexer - Capitalização exponencial (base 252 DU)
 * Fórmula: factor = produto de (1 + taxa_diária)^1 para cada dia útil
 */
export class CDIIndexer extends IndexerStrategy {
  getFactor(startDate, endDate, holidays = []) {
    if (!this.rates || this.rates.length === 0) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0, hasProjection: false };
    }

    let factor = 1;
    let businessDays = 0;
    let hasProjection = false;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);
    const lastRateDate = new Date(this.getLastAvailableRate().rate_date);

    // Começar no dia seguinte
    current.setDate(current.getDate() + 1);

    while (current <= end) {
      if (this.isBusinessDay(current, holidays)) {
        const rate = this.getRateForDate(current);
        if (rate && rate.annual_rate) {
          // Marcar se está usando projeção (taxa após última disponível)
          if (current > lastRateDate) {
            hasProjection = true;
          }
          
          // Base 252 DU - fator diário exponencial
          const dailyFactor = Math.pow(1 + rate.annual_rate / 100, 1 / 252);
          factor *= dailyFactor;
          businessDays++;
        }
      }
      current.setDate(current.getDate() + 1);
    }

    return {
      factor,
      rateApplied: factor > 1 ? (factor - 1) * 100 : 0,
      daysWithRate: businessDays,
      hasProjection,
      lastAvailableRateDate: lastRateDate.toISOString().split('T')[0],
    };
  }
}