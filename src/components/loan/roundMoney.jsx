/**
 * 🏦 POLÍTICA DE ARREDONDAMENTO FINANCEIRO INSTITUCIONAL
 * 
 * REGRA INSTITUCIONAL:
 * - Método: HALF_EVEN (Banker's Rounding / Arredondamento Bancário)
 * - Justificativa: Minimiza viés acumulado em séries longas
 * - Casas: money=2, percent=6, exchange=4
 * - Proteção: Number.EPSILON contra erro binário IEEE 754
 * - STAGE ROUNDING: Proibido arredondar em etapas intermediárias
 * 
 * HALF_EVEN (Banker's Rounding):
 * - 2.5 → 2 (arredonda para par)
 * - 3.5 → 4 (arredonda para par)
 * - Reduz viés estatístico em operações de longo prazo
 * - Padrão IEEE 754 e usado por bancos centrais
 * 
 * JUSTIFICATIVA LEGAL:
 * Art. 5º da Lei 8.078/90 (CDC) exige clareza nos cálculos.
 * Arredondamento inconsistente = risco jurídico.
 * 
 * NOTA TÉCNICA:
 * Erro silencioso é PROIBIDO. Valores inválidos lançam exceção.
 * 
 * POLÍTICA: BANKERS_ROUNDING_FINAL_ONLY
 * 
 * USO:
 * import { roundMoney } from './roundMoney';
 * const valor = roundMoney(1234.567); // 1234.57
 */

/**
 * Arredonda valor monetário usando HALF_EVEN (Banker's Rounding)
 * @param {number} value - Valor a arredondar
 * @param {number} decimals - Casas decimais (padrão: 2)
 * @returns {number} Valor arredondado
 * @throws {Error} Se value for NaN ou Infinity
 */
export function roundMoney(value, decimals = 2) {
  const n = Number(value);
  
  // 🔐 FAIL-SAFE: NUNCA mascarar erro com zero silencioso
  if (!Number.isFinite(n)) {
    throw new Error(`roundMoney recebeu valor inválido: ${value} (tipo: ${typeof value})`);
  }
  
  // HALF_EVEN (Banker's Rounding): Arredonda para o número par mais próximo
  // Minimiza viés acumulado em séries longas (padrão bancário)
  const factor = Math.pow(10, decimals);
  const shifted = n * factor;
  const rounded = Math.round(shifted + Number.EPSILON);
  
  // Se exatamente 0.5, arredondar para par
  const fraction = Math.abs(shifted - Math.floor(shifted));
  if (Math.abs(fraction - 0.5) < Number.EPSILON) {
    const floor = Math.floor(shifted);
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  
  return rounded / factor;
}

/**
 * Arredonda percentuais com 6 casas decimais
 * @param {number} value - Taxa percentual
 * @returns {number} Valor arredondado
 */
export function roundPercent(value) {
  return roundMoney(value, 6);
}

/**
 * Arredonda taxas de câmbio com 4 casas decimais
 * @param {number} value - Taxa de câmbio
 * @returns {number} Valor arredondado
 */
export function roundExchangeRate(value) {
  return roundMoney(value, 4);
}