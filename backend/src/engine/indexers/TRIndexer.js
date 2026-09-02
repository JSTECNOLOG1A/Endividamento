import { IndexerStrategy } from "./IndexerStrategy.js";

/**
 * TR Indexer - Taxa Referencial (financiamento imobiliário SFH/SBPE,
 * poupança, alguns contratos legados).
 *
 * Diferente de CDI/SELIC (compostas dia útil a dia útil) e do IPCA (índice
 * mensal com defasagem de 1 mês): a TR é publicada DIARIAMENTE pelo BACEN
 * (SGS série 226), mas cada cotação já representa a taxa de um PERÍODO
 * inteiro (~1 mês, "da data à mesma data no mês seguinte") — pronta para
 * aplicar de uma vez, sem defasagem (ao contrário do IPCA, a TR já "olha
 * para frente": a cotação de hoje já é a taxa que vale dela em diante).
 *
 * `this.rates` guarda `rate_date` = a data de início de cada período
 * publicado e `annual_rate` (nome reaproveitado do mesmo schema de
 * CDI/SELIC/IPCA/TJLP) = a taxa do PERÍODO (não anual, apesar do nome).
 *
 * Convenção: usa a cotação vigente na data de INÍCIO do período do motor
 * (mês corrido entre duas parcelas) — que é exatamente a mesma janela que a
 * série do BACEN já publica.
 */
export class TRIndexer extends IndexerStrategy {
  getFactor(startDate) {
    if (!this.rates || this.rates.length === 0) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0, hasProjection: false };
    }

    const start = new Date(startDate);
    const lastRateDate = new Date(this.getLastAvailableRate().rate_date);
    const rate = this.getRateForDate(start);
    if (!rate || !Number.isFinite(rate.annual_rate)) {
      return { factor: 1, rateApplied: 0, daysWithRate: 0, hasProjection: false };
    }

    const factor = 1 + rate.annual_rate / 100;
    const hasProjection = start > lastRateDate;

    return {
      factor,
      rateApplied: factor > 1 ? (factor - 1) * 100 : 0,
      daysWithRate: 1,
      hasProjection,
      lastAvailableRateDate: lastRateDate.toISOString().split("T")[0],
    };
  }
}
