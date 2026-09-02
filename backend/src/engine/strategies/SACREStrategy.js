/**
 * Estratégia SACRE (Sistema de Amortização Crescente)
 * Desenvolvida pela Caixa Econômica Federal para financiamento imobiliário —
 * híbrido SAC + PRICE:
 *
 * - A cada bloco de 12 parcelas (configurável), a prestação é recalculada
 *   como no SAC: amortização = saldo devedor atual ÷ parcelas restantes,
 *   juros = saldo × taxa do mês, prestação = amortização + juros.
 * - Essa prestação fica FIXA pelas próximas até-12 parcelas (como no PRICE):
 *   a amortização cresce mês a mês dentro do bloco (juros cai conforme o
 *   saldo cai, prestação constante absorve a diferença), até o próximo
 *   aniversário do bloco, quando recalcula de novo.
 *
 * Resultado: prestação fixa e amortização crescente DENTRO de cada ano,
 * dando um "degrau" para baixo a cada aniversário — mais suave que o SAC
 * puro (que dá um pequeno degrau todo mês), mais decrescente que o PRICE
 * puro (que fica achatado o contrato inteiro).
 */
export class SACREStrategy {
  constructor(principal, principalInstallments, blockSize = 12) {
    this.principal = principal;
    this.principalInstallments = principalInstallments;
    this.blockSize = blockSize;
    this.remainingInstallments = principalInstallments;
    this.eventsIntoBlock = 0; // 0 = precisa recalcular a prestação do bloco
    this.fixedInstallmentThisBlock = null;
    this.hasNegativeAmortization = false;
  }

  calculatePayment(evt, jurosTotal, acumulatedUnpaidInterest, isLastPayment, sdAtualizado, sdInicial, principalPaymentIndex, graceInterestBehavior = "CAPITALIZAR") {
    let amortizacao = 0;
    let prestacao = 0;
    let jurosCapitalizados = 0;
    let jurosPagos = 0;
    let jurosAcruados = 0;

    if (evt.hasPrincipal) {
      jurosPagos = jurosTotal + acumulatedUnpaidInterest;

      if (isLastPayment) {
        // REGRA DE OURO: a última parcela sempre liquida o saldo devedor
        // total — garante fechamento exato em 0,00.
        amortizacao = sdInicial;
      } else {
        if (this.eventsIntoBlock === 0) {
          // Início de bloco (ou 1ª parcela): recalcula a prestação fixa do
          // bloco com base SAC sobre o saldo devedor ATUAL.
          const sacSlice = sdInicial / this.remainingInstallments;
          this.fixedInstallmentThisBlock = sacSlice + jurosPagos;
        }
        amortizacao = this.fixedInstallmentThisBlock - jurosPagos;
        if (amortizacao < 0) {
          this.hasNegativeAmortization = true;
          amortizacao = 0;
        }
      }

      prestacao = amortizacao + jurosPagos;
      this.remainingInstallments -= 1;
      this.eventsIntoBlock = (this.eventsIntoBlock + 1) % this.blockSize;
      acumulatedUnpaidInterest = 0;
    } else if (evt.hasInterest && !evt.hasPrincipal) {
      amortizacao = 0;
      jurosPagos = jurosTotal;
      prestacao = jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else {
      amortizacao = 0;
      prestacao = 0;
      if (graceInterestBehavior === "CAPITALIZAR") {
        jurosCapitalizados = jurosTotal;
      } else if (graceInterestBehavior === "BALLOON") {
        jurosAcruados = jurosTotal;
      } else {
        acumulatedUnpaidInterest = 0;
      }
    }

    return { amortizacao, prestacao, acumulatedUnpaidInterest, jurosCapitalizados, jurosPagos, jurosAcruados };
  }

  getWarnings() {
    const warnings = [];
    if (this.hasNegativeAmortization) {
      warnings.push({
        type: "NEGATIVE_AMORTIZATION",
        message: "Amortização negativa detectada dentro de um bloco SACRE: o indexador subiu o suficiente para que a prestação fixa do bloco não cubra nem os juros. Verifique as taxas do indexador.",
      });
    }
    return warnings;
  }
}
