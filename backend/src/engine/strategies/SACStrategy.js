/**
 * Estratégia SAC (Sistema de Amortização Constante)
 * Amortização fixa, juros decrescentes
 */

export class SACStrategy {
  constructor(principal, principalInstallments) {
    this.principal = principal;
    this.principalInstallments = principalInstallments;
    // A fatia constante só é calculada no 1º evento de amortização (ver
    // calculatePayment), usando o saldo devedor NAQUELE momento — não o
    // principal original. Isso importa quando há carência com capitalização
    // (CAPITALIZAR): o saldo já cresceu com os juros capitalizados antes da
    // amortização começar, e a fatia precisa refletir esse saldo real para o
    // contrato fechar em 0,00 no fim (senão os juros capitalizados na
    // carência nunca são amortizados).
    this.sacAmort = null;
    // Juros compostos (juros sobre juros) desde a última parcela paga — só
    // usado pelo comportamento CAPITALIZAR_PERIODICO: diferente do
    // CAPITALIZAR "clássico" (que só desconta tudo na ÚLTIMA parcela do
    // contrato inteiro), esse modo desconta o que capitalizou desde a
    // parcela anterior a CADA parcela agendada — útil quando a periodicidade
    // de pagamento é maior que mensal (ex.: SAC anual, comum em FINAME/
    // crédito rural): os meses "silenciosos" entre parcelas compõem juros
    // sobre juros normalmente, mas isso é liquidado na parcela seguinte, não
    // vira saldo permanente que só fecha no fim do contrato.
    this.capitalizedSincePayment = 0;
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
    // Repassado ao Engine pra descontar do saldo que segue capitalizando —
    // senão o valor liquidado aqui continuaria "contando" como saldo devedor
    // (dupla contagem). Só não-zero no modo CAPITALIZAR_PERIODICO.
    let capitalizedPaidOut = 0;

    if (evt.hasPrincipal) {
      if (this.sacAmort === null) {
        this.sacAmort = sdInicial / this.principalInstallments;
      }
      // No CAPITALIZAR_PERIODICO, sdInicial desta linha já inclui o juro
      // composto acumulado desde a última parcela (this.capitalizedSincePayment)
      // — que vai ser pago separadamente como juro logo abaixo. Descontar
      // daqui antes de usar sdInicial como "saldo a liquidar" na última
      // parcela, senão esse mesmo valor seria amortizado E pago como juro
      // ao mesmo tempo (dupla contagem, contrato nunca fecha em 0,00).
      const pendingCapitalized = graceInterestBehavior === "CAPITALIZAR_PERIODICO" ? this.capitalizedSincePayment : 0;
      // REGRA DE OURO: a última parcela sempre liquida o saldo devedor total,
      // absorvendo qualquer resíduo de capitalização/arredondamento — garante
      // fechamento exato em 0,00.
      amortizacao = isLastPayment ? (sdInicial - pendingCapitalized) : this.sacAmort;

      // PMT = amortização + juros do mês + juros acumulados de períodos anteriores
      jurosPagos = jurosTotal + acumulatedUnpaidInterest;
      if (graceInterestBehavior === "CAPITALIZAR_PERIODICO") {
        jurosPagos += this.capitalizedSincePayment;
        capitalizedPaidOut = this.capitalizedSincePayment;
        this.capitalizedSincePayment = 0;
      }
      prestacao = amortizacao + jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else if (evt.hasInterest && !evt.hasPrincipal) {
      amortizacao = 0;
      jurosPagos = jurosTotal + acumulatedUnpaidInterest;
      if (graceInterestBehavior === "CAPITALIZAR_PERIODICO") {
        jurosPagos += this.capitalizedSincePayment;
        capitalizedPaidOut = this.capitalizedSincePayment;
        this.capitalizedSincePayment = 0;
      }
      prestacao = jurosPagos;
      acumulatedUnpaidInterest = 0;
    } else {
      // Período de carência - aplicar comportamento
      amortizacao = 0;
      if (graceInterestBehavior === "CAPITALIZAR" || graceInterestBehavior === "CAPITALIZAR_PERIODICO") {
        // Capitalizar: juros incorporados ao SD (sem PMT) — juros sobre
        // juros nos meses seguintes, igual nos dois modos. A diferença só
        // aparece na parcela: CAPITALIZAR deixa tudo pro saldo final do
        // contrato; CAPITALIZAR_PERIODICO desconta a cada parcela (acima).
        jurosCapitalizados = jurosTotal;
        prestacao = 0;
        acumulatedUnpaidInterest = 0; // Juros foram capitalizados, não acumulam
        if (graceInterestBehavior === "CAPITALIZAR_PERIODICO") {
          this.capitalizedSincePayment += jurosTotal;
        }
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

    return { amortizacao, prestacao, acumulatedUnpaidInterest, jurosCapitalizados, jurosPagos, jurosAcruados, capitalizedPaidOut };
  }

  /**
   * Verifica se há avisos específicos do sistema
   */
  getWarnings() {
    return [];
  }
}
