/**
 * 🧪 TESTES OBRIGATÓRIOS DE ARREDONDAMENTO
 * 
 * FINALIDADE:
 * Garantir que roundMoney não regride em casos críticos de ponto flutuante.
 * 
 * CASOS CRÍTICOS IEEE 754:
 * - 1.005 × 100 = 100.499999... (não 100.5)
 * - 2.675 × 100 = 267.499999... (não 267.5)
 * 
 * STATUS: OBRIGATÓRIO
 * Qualquer mudança em roundMoney deve passar nestes testes.
 * 
 * USO:
 * import { runRoundingTests } from './roundMoney.test';
 * import { roundMoney } from './roundMoney';
 */

/**
 * Suite de testes de arredondamento monetário
 */
export const ROUNDING_TESTS = [
  {
    name: "Caso crítico: 1.005 → 1.01",
    input: 1.005,
    expected: 1.01,
    decimals: 2
  },
  {
    name: "Caso crítico: 2.675 → 2.68",
    input: 2.675,
    expected: 2.68,
    decimals: 2
  },
  {
    name: "Caso crítico: 10.335 → 10.34",
    input: 10.335,
    expected: 10.34,
    decimals: 2
  },
  {
    name: "Caso negativo: -1.005 → -1.01",
    input: -1.005,
    expected: -1.01,
    decimals: 2
  },
  {
    name: "Caso negativo: -2.675 → -2.68",
    input: -2.675,
    expected: -2.68,
    decimals: 2
  },
  {
    name: "Zero deve permanecer zero",
    input: 0,
    expected: 0,
    decimals: 2
  },
  {
    name: "Valor já arredondado",
    input: 1.23,
    expected: 1.23,
    decimals: 2
  },
  {
    name: "Arredondamento para baixo",
    input: 1.234,
    expected: 1.23,
    decimals: 2
  },
  {
    name: "Arredondamento para cima",
    input: 1.236,
    expected: 1.24,
    decimals: 2
  }
];

/**
 * Testes de valores inválidos (devem lançar erro)
 */
export const ERROR_TESTS = [
  {
    name: "NaN deve lançar erro",
    input: NaN,
    shouldThrow: true
  },
  {
    name: "Infinity deve lançar erro",
    input: Infinity,
    shouldThrow: true
  },
  {
    name: "-Infinity deve lançar erro",
    input: -Infinity,
    shouldThrow: true
  },
  {
    name: "undefined deve lançar erro",
    input: undefined,
    shouldThrow: true
  }
];

/**
 * Executa todos os testes de arredondamento
 * @param {Function} roundMoneyFn - Função roundMoney a ser testada
 * @returns {Object} Resultado dos testes
 */
export function runRoundingTests(roundMoneyFn) {
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  // Testes de valores válidos
  ROUNDING_TESTS.forEach(test => {
    try {
      const result = roundMoneyFn(test.input, test.decimals);
      if (result === test.expected) {
        results.passed++;
      } else {
        results.failed++;
        results.errors.push({
          test: test.name,
          input: test.input,
          expected: test.expected,
          received: result
        });
      }
    } catch (error) {
      results.failed++;
      results.errors.push({
        test: test.name,
        error: error.message
      });
    }
  });

  // Testes de erros
  ERROR_TESTS.forEach(test => {
    try {
      roundMoneyFn(test.input);
      // Se não lançou erro, falhou
      results.failed++;
      results.errors.push({
        test: test.name,
        error: "Deveria ter lançado erro mas não lançou"
      });
    } catch (error) {
      // Se lançou erro, passou
      results.passed++;
    }
  });

  return results;
}

/**
 * Testes específicos para roundPercent (6 decimais)
 */
export const PERCENT_TESTS = [
  {
    name: "Taxa com 6 decimais",
    input: 0.1234567,
    expected: 0.123457
  },
  {
    name: "Taxa arredondada para baixo",
    input: 0.1234564,
    expected: 0.123456
  }
];

/**
 * Testes específicos para roundExchangeRate (4 decimais)
 */
export const EXCHANGE_RATE_TESTS = [
  {
    name: "PTAX típica",
    input: 5.12345,
    expected: 5.1235
  },
  {
    name: "PTAX arredondada para baixo",
    input: 5.12344,
    expected: 5.1234
  }
];