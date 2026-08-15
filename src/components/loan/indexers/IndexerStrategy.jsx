/**
 * Classe abstrata para indexadores
 * Define a interface que todos os indexadores devem implementar
 */
export class IndexerStrategy {
  constructor(rates = []) {
    this.rates = rates; // Array de {rate_date, annual_rate}
  }

  /**
   * Calcula o fator acumulado para um período
   * @param {string} startDate - Data inicial (ISO format)
   * @param {string} endDate - Data final (ISO format)
   * @param {array} holidays - Array de feriados {holiday_date}
   * @returns {object} {factor, rateApplied, daysWithRate}
   */
  getFactor(startDate, endDate, holidays = []) {
    throw new Error("getFactor() deve ser implementado pela subclasse");
  }

  /**
   * Busca taxa para uma data específica
   * Se data não existe, retorna última taxa disponível (projeção pragmática)
   * @param {string} targetDate - Data alvo (ISO format)
   * @returns {object} Taxa encontrada ou última taxa disponível; null se sem dados
   */
  getRateForDate(targetDate) {
    if (!this.rates || this.rates.length === 0) return null;

    const target = new Date(targetDate);
    const sortedRates = [...this.rates]
      .sort((a, b) => new Date(b.rate_date).getTime() - new Date(a.rate_date).getTime());

    // Busca taxa exata ou do dia anterior
    for (const rate of sortedRates) {
      const rateDate = new Date(rate.rate_date);
      if (rateDate <= target) {
        return rate;
      }
    }

    // Se nenhuma taxa anterior encontrada, retorna a última disponível (projeção)
    // Isso evita falhas em contratos com datas futuras
    return sortedRates[0] || null;
  }

  /**
   * Obtém a última taxa conhecida
   * @returns {object} Última taxa ou null
   */
  getLastAvailableRate() {
    if (!this.rates || this.rates.length === 0) return null;
    const sorted = [...this.rates]
      .sort((a, b) => new Date(b.rate_date).getTime() - new Date(a.rate_date).getTime());
    return sorted[0] || null;
  }

  /**
   * Verifica se é dia útil
   */
  isBusinessDay(date, holidays = []) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    
    const dateStr = date.toISOString().split('T')[0];
    return !holidays.some(h => h.holiday_date === dateStr);
  }

  /**
   * Conta dias úteis entre duas datas
   */
  businessDaysBetween(d1, d2, holidays = []) {
    let count = 0;
    const start = new Date(d1);
    const end = new Date(d2);
    const current = new Date(start);
    current.setDate(current.getDate() + 1);
    while (current <= end) {
      if (this.isBusinessDay(current, holidays)) count++;
      current.setDate(current.getDate() + 1);
    }
    return count;
  }
}