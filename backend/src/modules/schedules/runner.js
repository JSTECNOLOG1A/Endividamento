import { logger } from "../../logger.js";
import { refreshUpcomingRuns, runDueJobs } from "./service.js";
import { releaseStuckJobs } from "./store.js";

const TICK_MS = 20_000;
let timer = null;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const results = await runDueJobs();
    if (results.length) {
      logger.info({ count: results.length, results }, "agendamentos executados");
    }
  } catch (error) {
    logger.error({ err: error }, "falha no worker de agendamentos");
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  if (timer) return stopScheduler;
  (async () => {
    try {
      await releaseStuckJobs();
      await refreshUpcomingRuns();
    } catch (error) {
      logger.warn({ err: error }, "não foi possível preparar os agendamentos");
    }
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
    tick();
    logger.info({ everyMs: TICK_MS }, "worker de agendamentos iniciado");
  })();
  return stopScheduler;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
