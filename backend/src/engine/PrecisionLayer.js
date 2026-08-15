/**
 * 🏦 CAMADA DE PRECISÃO DECIMAL — PADRÃO BANCÁRIO
 * 
 * Wrapper sobre Decimal.js para operações financeiras
 * Garante: 8+ casas decimais internas, rounding determinístico
 * 
 * REGRA OURO: Operações monetárias SEMPRE via Decimal, NUNCA float JS
 */

import Decimal from 'decimal.js';

/**
 * 🔐 INICIALIZAÇÃO IDEMPOTENTE: Decimal.set() só executa quando explicitamente chamado
 * ZERO SIDE EFFECTS no import
 */
let _precisionInitialized = false;

export function initPrecision(config = {}) {
  if (_precisionInitialized) return; // Idempotente
  
  Decimal.set({
    precision: config.precision ?? 28,           // 28 dígitos significativos
    rounding: config.rounding ?? Decimal.ROUND_HALF_EVEN,  // Banker's Rounding
    toExpNeg: config.toExpNeg ?? -7,
    toExpPos: config.toExpPos ?? 21
  });
  
  _precisionInitialized = true;
}

/**
 * PRECISÃO BANCÁRIA: Tipos de valor
 */
export const PRECISION_MODES = {
  INTERNAL: 8,   // Cálculos internos: 8 casas decimais
  DISPLAY: 2,    // Exibição: 2 casas (centavos/cent)
  PERCENT: 6,    // Porcentagem: 6 casas
  EXCHANGE: 4    // Taxa cambial: 4 casas
};

/**
 * Wrapper: Cria Decimal a partir de número, string ou Decimal
 * @param {number|string|Decimal} value
 * @returns {Decimal} Valor preciso
 */
export function toDecimal(value) {
  if (value instanceof Decimal) return value;
  if (typeof value === 'string') return new Decimal(value);
  if (typeof value === 'number') {
    // ⚠️ Conversão segura de float: string intermediária
    return new Decimal(String(value));
  }
  return new Decimal(0);
}

/**
 * Extrai valor numérico (para JSON, logs)
 * @param {Decimal} decimalValue
 * @returns {number}
 */
export function toNumber(decimalValue) {
  return parseFloat(decimalValue.toString());
}

/**
 * Soma com precisão
 * @param {Decimal[]} values
 * @returns {Decimal}
 */
export function sum(values) {
  return values.reduce((acc, val) => acc.plus(toDecimal(val)), new Decimal(0));
}

/**
 * Arredonda para modo específico
 * @param {Decimal|number} value
 * @param {string} mode - 'INTERNAL', 'DISPLAY', 'PERCENT', 'EXCHANGE'
 * @returns {Decimal}
 */
export function round(value, mode = 'INTERNAL') {
  const d = toDecimal(value);
  const places = PRECISION_MODES[mode] || PRECISION_MODES.INTERNAL;
  return d.toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN);
}

/**
 * 🔐 UTILITÁRIO SHADOW: Arredonda Decimal mantendo precisão até conversão final
 * Padrão bancário: manter Decimal até imediatamente antes do log
 * @param {Decimal} decimalValue
 * @param {number} decimals - casas decimais (2 para money, 6 para percent, etc)
 * @returns {Decimal} Valor arredondado em Decimal
 */
export function roundDecimal(decimalValue, decimals = 2) {
  const d = toDecimal(decimalValue);
  return d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN);
}

/**
 * Valida precisão (detectar NaN/Infinity)
 * @param {Decimal} value
 * @returns {boolean}
 */
export function isValid(value) {
  if (!(value instanceof Decimal)) return false;
  return value.isFinite() && !value.isNaN();
}

/**
 * Comparação com tolerância
 * @param {Decimal|number} a
 * @param {Decimal|number} b
 * @param {number} tolerance - em casas decimais (default 2)
 * @returns {boolean}
 */
export function isEqual(a, b, tolerance = 2) {
  const da = toDecimal(a);
  const db = toDecimal(b);
  const diff = da.minus(db).abs();
  const tol = new Decimal(10).pow(-tolerance);
  return diff.lte(tol);
}

/**
 * Montante final com capitalização composta
 * Fórmula: M = P × (1 + taxa)^períodos
 * @param {Decimal|number} principal
 * @param {Decimal|number} rate - taxa decimal (ex: 0.05 = 5%)
 * @param {number} periods
 * @returns {Decimal}
 */
export function compoundAmount(principal, rate, periods) {
  const p = toDecimal(principal);
  const r = toDecimal(rate);
  const factor = r.plus(1).pow(periods);
  return p.times(factor);
}

/**
 * Juros simples
 * Fórmula: J = P × i × t
 * @param {Decimal|number} principal
 * @param {Decimal|number} rate - taxa decimal
 * @param {number} periods
 * @returns {Decimal}
 */
export function simpleInterest(principal, rate, periods) {
  const p = toDecimal(principal);
  const r = toDecimal(rate);
  return p.times(r).times(periods);
}

/**
 * Taxa equivalente (converter entre períodos)
 * Fórmula: i_eq = (1 + i)^(1/n) - 1
 * @param {Decimal|number} annualRate - taxa anual decimal
 * @param {number} periodsPerYear - ex: 12 para mensal, 252 para dias úteis
 * @returns {Decimal}
 */
export function equivalentRate(annualRate, periodsPerYear) {
  const rate = toDecimal(annualRate);
  const factor = rate.plus(1).pow(new Decimal(1).div(periodsPerYear));
  return factor.minus(1);
}

/**
 * Fator acumulado (juros compostos desde 1.0)
 * Fórmula: fator = (1 + i)^períodos
 * @param {Decimal|number} rate - taxa decimal
 * @param {number} periods
 * @returns {Decimal}
 */
export function accumulationFactor(rate, periods) {
  const r = toDecimal(rate);
  return r.plus(1).pow(periods);
}

/**
 * Conversão cambial (com validação)
 * @param {Decimal|number} value - valor na moeda origem
 * @param {Decimal|number} rate - taxa de câmbio
 * @returns {Decimal} Valor convertido
 */
export function convertCurrency(value, rate) {
  const v = toDecimal(value);
  const r = toDecimal(rate);
  
  if (!isValid(r) || r.lte(0)) {
    throw new Error(`Taxa de câmbio inválida: ${r.toString()}`);
  }
  
  return v.times(r);
}

/**
 * Variação cambial (isolada)
 * Fórmula: varCambial = saldo × (ptax_atual - ptax_anterior)
 * @param {Decimal|number} saldo
 * @param {Decimal|number} ptaxAnterior
 * @param {Decimal|number} ptaxAtual
 * @returns {Decimal}
 */
export function exchangeVariation(saldo, ptaxAnterior, ptaxAtual) {
  const s = toDecimal(saldo);
  const pAnt = toDecimal(ptaxAnterior);
  const pAtu = toDecimal(ptaxAtual);
  
  return s.times(pAtu.minus(pAnt));
}

/**
 * Formatação para exibição (sem perder precisão interna)
 * @param {Decimal|number} value
 * @param {string} currency - 'BRL', 'USD', etc
 * @returns {string}
 */
export function formatCurrency(value, currency = 'BRL') {
  const d = toDecimal(value);
  const rounded = round(d, 'DISPLAY');
  const num = toNumber(rounded);
  
  const formatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  
  return formatter.format(num);
}

/**
 * Validação integral: não usar float nativo em cálculos críticos
 * @param {*} value
 * @returns {boolean}
 */
export function isSafeDecimal(value) {
  return value instanceof Decimal || typeof value === 'string';
}

export default {
  toDecimal,
  toNumber,
  sum,
  round,
  isValid,
  isEqual,
  compoundAmount,
  simpleInterest,
  equivalentRate,
  accumulationFactor,
  convertCurrency,
  exchangeVariation,
  formatCurrency,
  isSafeDecimal,
  Decimal,
  PRECISION_MODES
};