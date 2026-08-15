/**
 * Estratégia SAC (Sistema de Amortização Constante)
 * Amortização fixa, juros decrescentes
 */

export class SACStrategy {
  constructor(principal, principalInstallments) {
    this.principal = principal;
    this.principalInstallments = principalInstallments;
    this.sacAmort = principal / principalInstallments;
  }

  /**
   * Calcula amortização e prestação para uma parcela
   */
  calculatePayment(evt, jurosTotal, acumulatedUnpaidInterest, isLastPayment, sdAtualizado, sdInicial, principalPaymentIndex, graceInterestBehavior = "CAPITALIZAR") {
    let amortizacao = 0;
    let prestacao = 0;
    let jurosCapitalizados = 0;
    let jurosPagos = 0;
    let jurosAcruados = 0;

    if (evt.hasPrincipal) {
      amortizacao = this.sacAmort;
      
      // PMT = amortização + juros do mês + juros acumulados de períodos anteriores
      jurosPagos = jurosTotal + acumulatedUnpaidInterest;
      prestacao = amortizacao + jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else if (evt.hasInterest && !evt.hasPrincipal) {
      amortizacao = 0;
      jurosPagos = jurosTotal + acumulatedUnpaidInterest;
      prestacao = jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else {
      // Período de carência - aplicar comportamento
      amortizacao = 0;
      if (graceInterestBehavior === "CAPITALIZAR") {
        // Capitalizar: juros incorporados ao SD (sem PMT)
        jurosCapitalizados = jurosTotal;
        prestacao = 0;
        acumulatedUnpaidInterest = 0; // Juros foram capitalizados, não acumulam
      } else if (graceInterestBehavior === "INTEREST_ONLY") {
        // Interest Only: pagar juros do período, SD não cresce
        jurosPagos = jurosTotal;
        prestacao = jurosTotal;
        acumulatedUnpaidInterest = 0;
      } else if (graceInterestBehavior === "BALLOON") {
        // Balloon: juros simples acruam (não capitalizam, não pagam)
        jurosAcruados = jurosTotal;
        prestacao = 0;
        acumulatedUnpaidInterest = 0;
      } else {
        // Fallback: acumular
        prestacao = 0;
        acumulatedUnpaidInterest += jurosTotal;
      }
    }

    return { amortizacao, prestacao, acumulatedUnpaidInterest, jurosCapitalizados, jurosPagos, jurosAcruados };
  }

  /**
   * Verifica se há avisos específicos do sistema
   */
  getWarnings() {
    return [];
  }
}