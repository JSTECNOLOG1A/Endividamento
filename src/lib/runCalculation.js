import { calculateAmortizationSchedule as calculateOnEngine } from "@engine/CalculationEngine.js";

/**
 * Motor de cálculo: mesma implementação do backend (`backend/src/engine`).
 * Roda no cliente para o simulador refletir a âncora de vencimento na hora.
 */
export async function calculateAmortizationSchedule(params) {
  return calculateOnEngine(params);
}
