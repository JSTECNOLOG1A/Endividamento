/**
 * Estratégia AMERICANO (Sistema Americano)
 * Principal no final, juros periódicos
 */

export class AMERICANOStrategy {
  constructor(principal) {
    this.principal = principal;
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

    if (isLastPayment && evt.hasPrincipal) {
      // Última parcela: paga principal + todos juros acumulados
      amortizacao = sdInicial; // Liquidar saldo restante
      jurosPagos = acumulatedUnpaidInterest + jurosTotal;
      prestacao = amortizacao + jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else if (evt.hasPrincipal && !isLastPayment) {
      // Principal intermediário (não deve acontecer no AMERICANO puro, mas por segurança)
      amortizacao = 0;
      if (evt.hasInterest) {
        jurosPagos = acumulatedUnpaidInterest + jurosTotal;
        prestacao = jurosPagos;
        acumulatedUnpaidInterest = 0;
      } else {
        prestacao = 0;
        acumulatedUnpaidInterest += jurosTotal;
      }
    } else if (evt.hasInterest && !evt.hasPrincipal) {
      // Pagamento de juros periódico (trimestral, semestral, etc)
      amortizacao = 0;
      jurosPagos = acumulatedUnpaidInterest + jurosTotal;
      prestacao = jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else {
      // Sem pagamento neste mês: acumular juros
      amortizacao = 0;
      prestacao = 0;
      acumulatedUnpaidInterest += jurosTotal;
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