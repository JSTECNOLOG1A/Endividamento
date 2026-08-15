/**
 * Estratégia PRICE (Sistema Francês)
 * Prestação fixa, amortização crescente
 */

export class PRICEStrategy {
  constructor(principal, principalInstallments, priceRate, interestGraceMonths, graceInterestBehavior = "CAPITALIZAR") {
    this.principal = principal;
    this.principalInstallments = principalInstallments;
    this.priceRate = priceRate;
    this.interestGraceMonths = interestGraceMonths;
    this.graceInterestBehavior = graceInterestBehavior;
    this.pricePMTFixed = 0;
    this.pmtCalculated = false;
    this.hasNegativeAmortization = false;
    
    // BLOQUEIO: PRICE incompatível com BALLOON
    if (graceInterestBehavior === "BALLOON") {
      throw new Error("Sistema PRICE é incompatível com comportamento BALLOON. A Tabela PRICE usa juros compostos, enquanto BALLOON acumula juros simples. Use CAPITALIZAR ou INTEREST_ONLY.");
    }
  }

  /**
   * Calcula PMT (Prestação)
   */
  calculatePMT(rate, nper, pv) {
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
      // ⚠️ CRÍTICO: Calcular PMT apenas na PRIMEIRA parcela de amortização (após capitalizações)
      if (!this.pmtCalculated) {
        // 🔐 DIAGNÓSTICO: Verificar se estamos usando saldo capitalizado correto
        console.log('🔍 DIAGNÓSTICO CARÊNCIA CAPITALIZADA:', {
          principalOriginalConstructor: this.principal,
          saldoAposCarencia: sdInicial,
          principalUsadoPMT: sdInicial,
          divergencia: Math.abs(this.principal - sdInicial),
          bugConfirmado: Math.abs(this.principal - sdInicial) < 0.01 ? 'NÃO - usando saldo correto' : 'SIM - usando saldo capitalizado'
        });
        
        // 🔐 CORREÇÃO FASE 4.2: Usar sdInicial (com capitalizações) + nper correto
        // sdInicial já inclui juros capitalizados da carência
        // principalInstallments é o número de parcelas DE AMORTIZAÇÃO (não conta carência)
        this.pricePMTFixed = this.calculatePMT(this.priceRate, this.principalInstallments, sdInicial);
        this.pmtCalculated = true;
        
        console.log('💰 PMT PRICE calculada (pós-carência):', {
          sdInicialCapitalizado: sdInicial,
          nper: this.principalInstallments,
          rate: this.priceRate,
          pmt: this.pricePMTFixed
        });
      }

      // PRICE: TODAS as parcelas têm PMT fixa (inclusive a última)
      prestacao = this.pricePMTFixed;
      jurosPagos = jurosTotal;
      amortizacao = prestacao - jurosPagos;

      if (amortizacao < 0) {
        this.hasNegativeAmortization = true;
        amortizacao = 0;
      }

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