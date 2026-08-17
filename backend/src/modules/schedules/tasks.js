import { refreshPayableTitlesFromErp } from "../payables/erpIntegrate.js";
import { refreshReceivableTitlesFromErp } from "../receivables/erpIntegrate.js";

export const TASKS = {
  consultar_titulos_pagar: {
    key: "consultar_titulos_pagar",
    label: "Consultar títulos a pagar no ERP",
    rotina: "Contas a pagar",
    async run() {
      const result = await refreshPayableTitlesFromErp({ force: true, staleMinutes: 0 });
      if (result.unavailable) {
        return {
          ok: false,
          message: result.message || "Consulta de títulos a pagar indisponível no ERP",
          detalhes: result,
        };
      }
      const consulted = result.consulted || 0;
      const failed = result.failed || 0;
      const skipped = result.skipped || 0;
      return {
        ok: failed === 0,
        message: `${consulted} ${consulted === 1 ? "título consultado" : "títulos consultados"} · ${failed} com erro · ${skipped} ignorados`,
        detalhes: { consulted, failed, skipped, total: result.total },
      };
    },
  },
  consultar_titulos_receber: {
    key: "consultar_titulos_receber",
    label: "Consultar títulos a receber no ERP",
    rotina: "Contas a receber",
    async run() {
      const result = await refreshReceivableTitlesFromErp({ force: true, staleMinutes: 0 });
      if (result.unavailable) {
        return {
          ok: false,
          message: result.message || "Consulta de títulos a receber indisponível no ERP",
          detalhes: result,
        };
      }
      const consulted = result.consulted || 0;
      const failed = result.failed || 0;
      const skipped = result.skipped || 0;
      return {
        ok: failed === 0,
        message: `${consulted} ${consulted === 1 ? "título consultado" : "títulos consultados"} · ${failed} com erro · ${skipped} ignorados`,
        detalhes: { consulted, failed, skipped, total: result.total },
      };
    },
  },
};

export const TASK_KEYS = Object.keys(TASKS);

export function taskCatalog() {
  return TASK_KEYS.map((key) => ({
    key,
    label: TASKS[key].label,
    rotina: TASKS[key].rotina,
  }));
}

export function taskMeta(tarefa) {
  return TASKS[tarefa] || null;
}
