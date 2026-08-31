import { IndexerStrategy } from "./IndexerStrategy.js";

/**
 * IPCA Indexer - Correção monetária por mês de referência (defasagem de 1 mês)
 *
 * Diferente de CDI/SELIC (taxa DIÁRIA de mercado, capitalizada dia útil a dia
 * útil, base 252): o IPCA é um índice de preços divulgado UMA VEZ POR MÊS pelo
 * IBGE. Cada linha em `this.rates` representa a variação percentual do IPCA
 * NAQUELE mês de referência (rate_date = primeiro dia do mês; annual_rate,
 * apesar do nome do campo — reaproveitado da mesma tabela de CDI/SELIC —
 * guarda aqui a variação MENSAL, não anualizada).
 *
 * Convenção de defasagem: o IPCA do mês M só é publicado por volta do dia 10
 * do mês M+1, então contratos indexados a IPCA praticamente sempre usam
 * "IPCA do mês anterior" como referência para cada mês corrido — a mesma
 * lógica de defasagem que o PTAX já usa para câmbio (exchangeLag), só que
 * aqui fixada em 1 mês por ser a convenção de mercado esmagadoramente mais
 * comum (financiamento imobiliário, CRI/CRA, mútuos corrigidos por IPCA).
 */
export class IPCAIndexer extends IndexerStrategy {
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

    // Cada MÊS CORRIDO entre startDate (exclusive) e endDate (inclusive)
    // contribui com o fator do IPCA do mês anterior a ele.
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    if (start.getDate() > 1) cursor.setMonth(cursor.getMonth() + 1);
    const endCursor = new Date(end.getFullYear(), end.getMonth(), 1);
    if (end.getDate() > 1) endCursor.setMonth(endCursor.getMonth() + 1);

    while (cursor < endCursor) {
      const refMonth = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
      const rate = this.getRateForDate(refMonth);
      if (rate && Number.isFinite(rate.annual_rate)) {
        if (refMonth > lastRateDate) hasProjection = true;
        // Variação mensal direta (NÃO exponencial por dia — é um índice
        // publicado inteiro para o mês, aplicado de uma vez).
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
