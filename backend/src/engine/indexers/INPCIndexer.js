import { IndexerStrategy } from "./IndexerStrategy.js";

/**
 * INPC Indexer - Correção monetária por mês de referência (defasagem de 1 mês)
 *
 * Mesma mecânica do IPCA (ver IPCAIndexer.js): índice de preços divulgado
 * UMA VEZ POR MÊS pelo IBGE (série BACEN SGS 188), cada linha em
 * `this.rates` guarda a variação percentual MENSAL do INPC naquele mês de
 * referência (rate_date = primeiro dia do mês; annual_rate, apesar do nome
 * do campo — reaproveitado da mesma tabela de CDI/SELIC —, guarda aqui a
 * variação MENSAL, não anualizada). Mesma defasagem de 1 mês do IPCA
 * (divulgação por volta do dia 10 do mês seguinte).
 */
export class INPCIndexer extends IndexerStrategy {
  getFactor(startDate, endDate) {
    if (!this.rates || this.rates.length === 0) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0, hasProjection: false };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    let factor = 1;
    let monthsApplied = 0;
    let hasProjection = false;
    const lastRateDate = new Date(this.getLastAvailableRate().rate_date);

    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    if (start.getDate() > 1) cursor.setMonth(cursor.getMonth() + 1);
    const endCursor = new Date(end.getFullYear(), end.getMonth(), 1);
    if (end.getDate() > 1) endCursor.setMonth(endCursor.getMonth() + 1);

    while (cursor < endCursor) {
      const refMonth = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
      const rate = this.getRateForDate(refMonth);
      if (rate && Number.isFinite(rate.annual_rate)) {
        if (refMonth > lastRateDate) hasProjection = true;
        factor *= 1 + rate.annual_rate / 100;
        monthsApplied++;
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return {
      factor,
      rateApplied: factor > 1 ? (factor - 1) * 100 : 0,
      daysWithRate: monthsApplied,
      hasProjection,
      lastAvailableRateDate: lastRateDate.toISOString().split("T")[0],
    };
  }
}
