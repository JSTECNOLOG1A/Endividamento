import { calculateAmortizationSchedule, ENGINE_VERSION, ENGINE_BUILD_ID } from "../../engine/CalculationEngine.js";
import * as store from "../entities/store.js";
import { writeAudit } from "../../middleware/audit.js";

async function loadMarketData(params) {
  const next = { ...params };
  const indexer = params.indexer || "NA";

  if (!Array.isArray(next.cdiRates) || next.cdiRates.length === 0) {
    if (indexer === "CDI" || indexer === "SELIC") {
      next.cdiRates = await store.list("CDIRate", "rate_date", 20000);
    }
  }

  if (!Array.isArray(next.holidays) || next.holidays.length === 0) {
    next.holidays = await store.list("Holiday", "holiday_date", 20000);
  }

  if (params.currencyId && (!Array.isArray(next.exchangeRates) || next.exchangeRates.length === 0)) {
    const currencies = await store.list("Currency", "rate_date", 20000);
    next.exchangeRates = currencies
      .filter((row) => row.currency_code && row.currency_code !== "BRL" && row.exchange_rate)
      .map((row) => ({
        rate_date: row.rate_date,
        ptax_rate: Number(row.exchange_rate),
        source: "DB_CURRENCY",
      }));
  }

  return next;
}

export async function calculateAmortizationScheduleOnServer(payload = {}, req) {
  const params = await loadMarketData(payload);
  const result = await calculateAmortizationSchedule(params);
  const wrapped = {
    ...result,
    execution: {
      source: "server",
      calculated_at: new Date().toISOString(),
      engine_version: ENGINE_VERSION,
      engine_build_id: ENGINE_BUILD_ID,
    },
  };
  if (req) {
    await writeAudit({
      req,
      action: "CALCULATE",
      resourceType: "LoanContract",
      resourceId: payload.contractId || null,
      payload: {
        calculationSystem: params.calculationSystem,
        indexer: params.indexer,
        engine_build_id: ENGINE_BUILD_ID,
      },
    });
  }
  return wrapped;
}
