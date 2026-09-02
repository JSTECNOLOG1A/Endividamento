/**
 * Estratégia PRICE (Sistema Francês)
 * Prestação recalculada a cada evento de amortização, a partir do saldo devedor e
 * do juros efetivamente apurado naquele período (ver `jurosTotal`, calculado pelo
 * Engine com a MESMA fórmula usada por todos os demais sistemas — dias corridos
 * mais indexador, quando houver).
 *
 * Por que recalcular em vez de fixar uma prestação única no início:
 * - Com taxa prefixada, a taxa de período é idêntica em toda a vida do contrato,
 *   então recalcular reproduz EXATAMENTE a mesma prestação fixa do Price clássico
 *   (identidade matemática da fórmula de anuidade — nada muda para o caso mais comum).
 * - Com indexador variável (CDI/SELIC), a taxa não é conhecida de antemão; fixar a
 *   prestação usando só o spread (ignorando a variação real do indexador) deixava
 *   a amortização insuficiente e o contrato nunca fechava em 0,00. Recalcular a
 *   prestação a cada evento, sobre o saldo e a taxa REAIS daquele momento e as
 *   parcelas restantes, é a técnica padrão de mercado para Price pós-fixado e
 *   garante — por indução matemática — que a última parcela sempre zera o saldo.
 */

export class PRICEStrategy {
  constructor(principal, principalInstallments, interestGraceMonths, graceInterestBehavior = "CAPITALIZAR") {
    this.principal = principal;
    this.principalInstallments = principalInstallments;
    this.interestGraceMonths = interestGraceMonths;
    this.graceInterestBehavior = graceInterestBehavior;
    this.remainingInstallments = principalInstallments;
    this.hasNegativeAmortization = false;
    // Saldo logo após o último pagamento de principal (ou o principal original,
    // antes do primeiro). Junto com sdInicial+jurosTotal do evento atual, dá a
    // taxa composta REAL do período inteiro desde o último pagamento — mesmo
    // quando esse período abrange vários meses "silenciosos" (ex.: parcela
    // trimestral/semestral), pois o motor já capitaliza os juros desses meses
    // intermediários dentro de sdInicial (ver CalculationEngine.js, ramo
    // CAPITALIZAR). Sem isso, usar só o juros marginal do último mês como se
    // fosse a taxa de um período de 3 ou 6 meses subestimaria a prestação.
    this.balanceAtLastPayment = principal;

    // BLOQUEIO: PRICE incompatível com BALLOON
    if (graceInterestBehavior === "BALLOON") {
      throw new Error("Sistema PRICE é incompatível com comportamento BALLOON. A Tabela PRICE usa juros compostos, enquanto BALLOON acumula juros simples. Use CAPITALIZAR ou INTEREST_ONLY.");
    }
  }

  /**
   * Calcula PMT (Prestação) para uma taxa/período/saldo dados
   */
  calculatePMT(rate, nper, pv) {
    if (nper <= 0) return 0;
    if (rate === 0) return pv / nper;
    return (pv * rate * Math.pow(1 + rate, nper)) / (Math.pow(1 + rate, nper) - 1);
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
      jurosPagos = jurosTotal;

      if (isLastPayment) {
        // REGRA DE OURO: a última parcela sempre liquida o saldo devedor total,
        // absorvendo qualquer resíduo de capitalização/arredondamento acumulado
        // ao longo do contrato — garante fechamento exato em 0,00.
        amortizacao = sdInicial;
      } else {
        // Taxa composta REAL do período inteiro desde o último pagamento
        // (sdInicial + jurosTotal já reflete tudo que se acumulou/capitalizou
        // desde então — ver comentário no construtor). Com parcela mensal,
        // isso é idêntico à taxa de 1 mês; com trimestral/semestral, captura
        // corretamente o efeito composto dos meses "silenciosos" no meio.
        const periodRate = this.balanceAtLastPayment > 0
          ? (sdInicial + jurosTotal) / this.balanceAtLastPayment - 1
          : 0;
        const pmt = this.calculatePMT(periodRate, this.remainingInstallments, sdInicial);
        amortizacao = pmt - jurosPagos;

        if (amortizacao < 0) {
          this.hasNegativeAmortization = true;
          amortizacao = 0;
        }
      }

      prestacao = amortizacao + jurosPagos;
      this.balanceAtLastPayment = sdInicial - amortizacao;
      this.remainingInstallments -= 1;
      acumulatedUnpaidInterest = 0;
    } else if (evt.hasInterest && !evt.hasPrincipal) {
      // Pagamento de juros durante carência (INTEREST_ONLY)
      amortizacao = 0;
      jurosPagos = jurosTotal;
      prestacao = jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else {
      // Carência sem pagamento
      amortizacao = 0;
      prestacao = 0;
      if (graceInterestBehavior === "CAPITALIZAR") {
        jurosCapitalizados = jurosTotal;
      } else {
        // INTEREST_ONLY: não acumular, será pago no próximo período com hasInterest
        acumulatedUnpaidInterest = 0;
      }
    }

    return { amortizacao, prestacao, acumulatedUnpaidInterest, jurosCapitalizados, jurosPagos, jurosAcruados };
  }

  /**
   * Verifica se há avisos específicos do sistema
   */
  getWarnings() {
    const warnings = [];
    if (this.hasNegativeAmortization) {
      warnings.push({
        type: "NEGATIVE_AMORTIZATION",
        message: "Amortização negativa detectada: o saldo devedor está crescendo. Verifique as taxas do indexador.",
      });
    }
    return warnings;
  }
}
