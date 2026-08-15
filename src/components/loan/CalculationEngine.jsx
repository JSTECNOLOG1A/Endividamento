/**
 * Fonte única do motor: backend/src/engine.
 * Suítes de teste na UI importam daqui e executam o mesmo código da API.
 */
export {
  calculateAmortizationSchedule,
  ENGINE_VERSION,
  ENGINE_BUILD_ID,
  ROUNDING_POLICY,
  addMonths,
  nextBusinessDay,
  daysBetween,
  businessDaysBetween,
  roundTo,
  calculateCET,
  roundMoney,
} from "@engine/CalculationEngine.js";
