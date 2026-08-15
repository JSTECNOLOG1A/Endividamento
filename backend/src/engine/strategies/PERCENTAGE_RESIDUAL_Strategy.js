/**
 * Estratégia de Amortização por Percentual Customizado
 * Base 1: SALDO_DEVEDOR (Incide sobre Principal + Juros Acumulados)
 * Base 2: SALDO_PRINCIPAL (Incide apenas sobre o Saldo do Principal original restante)
 */
export class PERCENTAGE_RESIDUAL_Strategy {
  constructor(amortizationSchedule, interestGraceMonths = 0, calcBase = "SALDO_DEVEDOR") {
    /**
     * amortizationSchedule: Objeto {1: 0.2418, 2: 0.2809...}
     * calcBase: "SALDO_DEVEDOR" ou "SALDO_PRINCIPAL"
     */
    this.amortizationSchedule = amortizationSchedule;
    this.interestGraceMonths = interestGraceMonths;
    this.calcBase = calcBase; 
    this.warnings = [];
  }

  /**
   * @param {number} principalPaymentIndex - O índice da parcela enviado pelo Motor
   */
  calculatePayment(evt, jurosTotal, acumulatedUnpaidInterest, isLast, sdAtualizado, sdInicial, principalPaymentIndex, graceInterestBehavior = "CAPITALIZAR") {
    let jurosCapitalizados = 0;
    let jurosPagos = 0;
    let jurosAcruados = 0;
    
    // 1. Fase de Carência: Enquanto o Motor não sinaliza 'hasPrincipal'
    if (!evt.hasPrincipal) {
      // Aplicar comportamento de juros
      if (graceInterestBehavior === "CAPITALIZAR") {
        jurosCapitalizados = jurosTotal;
      } else if (graceInterestBehavior === "BALLOON") {
        jurosAcruados = jurosTotal;
      } else if (graceInterestBehavior === "INTEREST_ONLY" && evt.hasInterest) {
        jurosPagos = jurosTotal;
      }
      return {
        amortizacao: 0,
        prestacao: evt.hasInterest && graceInterestBehavior === "INTEREST_ONLY" ? jurosPagos : 0,
        acumulatedUnpaidInterest: acumulatedUnpaidInterest,
        jurosCapitalizados,
        jurosPagos,
        jurosAcruados
      };
    }

    // 2. Busca o percentual correto usando o contador de parcelas (principalPaymentIndex)
    const percentage = this.amortizationSchedule[principalPaymentIndex] || 0;
    
    // Alerta se o usuário esqueceu de preencher o percentual de uma parcela intermediária
    if (percentage === 0 && !isLast) {
      this.warnings.push({
        type: "MISSING_PERCENTAGE",
        message: `⚠️ Parcela ${principalPaymentIndex}: Percentual 0% ou não configurado no cronograma.`
      });
    }

    // 3. Cálculo da Amortização baseada na variável escolhida (SEMPRE sobre SD limpo)
    let amortizacao = 0;

    if (isLast) {
      // REGRA DE OURO: A última parcela sempre liquida o saldo total para evitar resíduos de centavos
      amortizacao = sdInicial; // SD limpo, sem balloon
    } else {
      if (this.calcBase === "SALDO_DEVEDOR") {
        // Variável 1: % sobre Saldo Devedor (SD limpo, sem balloon)
        amortizacao = sdInicial * percentage;
      } else {
        // Variável 2: % sobre o Principal original
        amortizacao = sdInicial * percentage;
      }
    }
    
    // 4. Prestação Final (Amortização + Juros pendentes)
    jurosPagos = jurosTotal + acumulatedUnpaidInterest;
    const prestacao = amortizacao + jurosPagos;

    return {
      amortizacao,
      prestacao,
      acumulatedUnpaidInterest: 0,
      jurosCapitalizados,
      jurosPagos,
      jurosAcruados
    };
  }

  getWarnings() {
    return this.warnings;
  }

  processGrace() {
    // Implementação para compatibilidade de interface com outras Strategies
  }
}