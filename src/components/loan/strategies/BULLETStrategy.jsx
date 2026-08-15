/**
 * Estratégia BULLET (Pagamento Único)
 * Principal e juros no final
 */

export class BULLETStrategy {
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

    if (isLastPayment) {
      // Última parcela: amortiza O SALDO DEVEDOR ATUAL (garantindo zeragem perfeita)
      amortizacao = sdInicial; // Saldo devedor que EXISTE (inclui capitalizações)
      jurosPagos = acumulatedUnpaidInterest + jurosTotal; // Todos os juros acumulados
      prestacao = amortizacao + jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else {
      // Linhas intermediárias: sempre acumula juros para pagamento final
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