import { IndexerStrategy } from "./IndexerStrategy.js";

/**
 * TJLP Indexer - Taxa de Juros de Longo Prazo (linhas BNDES legadas,
 * anteriores à TLP de 2018 — algumas ainda vigentes).
 *
 * Diferente de CDI/SELIC (taxa DIÁRIA de mercado) e do IPCA (índice mensal
 * retroativo): a TJLP é definida pelo CMN para vigorar por todo um trimestre
 * (jan-mar, abr-jun, ...), publicada com antecedência — por isso NÃO há
 * defasagem aqui (usa a taxa vigente na PRÓPRIA data de início do período,
 * ao contrário do IPCA que usa o mês anterior). `this.rates` guarda
 * `annual_rate` como taxa ANUAL (% a.a.), igual a CDI/SELIC — a série do
 * BACEN (SGS 256) já publica assim, geralmente repetindo o mesmo valor nos 3
 * meses de cada trimestre.
 *
 * Capitalização: exponencial por dias corridos (base 360) — mesma convenção
 * usada para `fixedRate` prefixado no restante do motor (ver
 * `fixedRateForPeriod` em CalculationEngine.js) — pois a TJLP não tem
 * cotação diária de mercado que justifique uma base de dias úteis/252 como
 * CDI/SELIC.
 */
export class TJLPIndexer extends IndexerStrategy {
  getFactor(startDate, endDate) {
    if (!this.rates || this.rates.length === 0) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0, hasProjection: false };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const lastRateDate = new Date(this.getLastAvailableRate().rate_date);

    // TJLP não muda dentro do período entre duas linhas mensais do motor
    // (a vigência é trimestral) — usa a taxa vigente na data de início.
    const rate = this.getRateForDate(start);
    if (!rate || !Number.isFinite(rate.annual_rate)) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0, hasProjection: false };
    }

    const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const factor = Math.pow(1 + rate.annual_rate / 100, days / 360);
    const hasProjection = start > lastRateDate;

    return {
      factor,
      rateApplied: factor > 1 ? (factor - 1) * 100 : 0,
      daysWithRate: days,
      hasProjection,
      lastAvailableRateDate: lastRateDate.toISOString().split("T")[0],
    };
  }
}
