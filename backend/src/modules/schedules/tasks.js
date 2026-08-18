import { refreshPayableTitlesFromErp } from "../payables/erpIntegrate.js";
import { convertPayablePrToTx } from "../payables/convertPrToTx.js";
import { refreshReceivableTitlesFromErp } from "../receivables/erpIntegrate.js";

export const TASKS = {
  consultar_titulos_pagar: {
    key: "consultar_titulos_pagar",
    label: "Consultar títulos a pagar no ERP",
    rotina: "Contas a pagar",
    descricao: "Atualiza status e saldo dos títulos a pagar já integrados no Protheus.",
    defaultNome: "Consultar títulos a pagar",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 60,
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
    descricao: "Atualiza status e saldo dos títulos a receber já integrados no Protheus.",
    defaultNome: "Consultar títulos a receber",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 60,
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
  converter_titulos_pr_tx: {
    key: "converter_titulos_pr_tx",
    label: "Converter títulos PR em TX no virar do mês",
    rotina: "Contas a pagar",
    descricao: "No dia escolhido, consulta o PR no Protheus, estorna, troca o tipo para TX e integra de novo.",
    defaultNome: "Converter juros PR em TX no virar do mês",
    defaultModo: "mensal",
    defaultIntervaloMinutos: 1440,
    defaultDiaMes: 1,
    defaultHoraExecucao: "00:10",
    async run() {
      return convertPayablePrToTx();
    },
  },
};

export const TASK_KEYS = Object.keys(TASKS);

export function taskCatalog() {
  return TASK_KEYS.map((key) => {
    const task = TASKS[key];
    return {
      key,
      label: task.label,
      rotina: task.rotina,
      descricao: task.descricao || "",
      defaultNome: task.defaultNome || task.label,
      defaultModo: task.defaultModo || "intervalo",
      defaultIntervaloMinutos: task.defaultIntervaloMinutos || 5,
      defaultDiaMes: task.defaultDiaMes || 1,
      defaultHoraExecucao: task.defaultHoraExecucao || "00:10",
    };
  });
}

export function taskMeta(tarefa) {
  return TASKS[tarefa] || null;
}
