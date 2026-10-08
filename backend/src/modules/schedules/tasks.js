import { refreshPayableTitlesFromErp } from "../payables/erpIntegrate.js";
import { convertPayablePrToTx } from "../payables/convertPrToTx.js";
import { autoIntegratePayableTitles } from "../payables/autoIntegrate.js";
import { refreshReceivableTitlesFromErp } from "../receivables/erpIntegrate.js";
import { autoIntegrateReceivableTitles } from "../receivables/autoIntegrate.js";
import { syncPtaxToCurrencies, syncRatesToCdiRates } from "../functions/bacen.js";
import { runAutomaticClosingForGroup } from "../accounting/automaticClosing.js";
import { consultTaxTitles, syncTaxTitles } from "../tax/taxTitles.js";
import { ALERT_FROM_HOUR, ALERT_MAX_INTERVAL_MINUTES, DUE_SOON_DAYS, runTaxAlerts } from "../tax/alerts.js";

export const TASKS = {
  integrar_titulos_pagar: {
    key: "integrar_titulos_pagar",
    label: "Integrar títulos a pagar no ERP",
    rotina: "Contas a pagar",
    descricao:
      "Integra no Protheus títulos a pagar abertos já classificados (natureza + fornecedor). Ignora incompletos.",
    defaultNome: "Integrar títulos a pagar",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 60,
    async run() {
      return autoIntegratePayableTitles();
    },
  },
  integrar_titulos_receber: {
    key: "integrar_titulos_receber",
    label: "Integrar títulos a receber no ERP",
    rotina: "Contas a receber",
    descricao:
      "Integra no Protheus títulos a receber abertos já classificados (natureza + cliente). Ignora incompletos.",
    defaultNome: "Integrar títulos a receber",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 60,
    async run() {
      return autoIntegrateReceivableTitles();
    },
  },
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
    label: "Converter títulos PR em JUR no virar do mês",
    rotina: "Contas a pagar",
    descricao: "No dia escolhido, consulta o PR no Protheus, estorna, troca o tipo para JUR e integra de novo.",
    defaultNome: "Converter juros PR em JUR no virar do mês",
    defaultModo: "mensal",
    defaultIntervaloMinutos: 1440,
    defaultDiaMes: 1,
    defaultHoraExecucao: "00:10",
    async run() {
      return convertPayablePrToTx();
    },
  },
  atualizar_ptax_bacen: {
    key: "atualizar_ptax_bacen",
    label: "Atualizar PTAX do BACEN",
    rotina: "Câmbio",
    descricao: "Busca a cotação PTAX (dólar) mais recente direto no Banco Central e grava no cadastro de Moedas.",
    defaultNome: "Atualizar PTAX do BACEN",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 1440,
    async run() {
      const result = await syncPtaxToCurrencies();
      const message = result.ok
        ? `${result.created} nova(s) · ${result.updated} atualizada(s) de ${result.fetched} consultada(s) · mais recente ${result.rate_date}: R$ ${result.exchange_rate}`
        : (result.message || "Falha ao consultar PTAX no BACEN");
      return {
        ok: result.ok,
        message,
        detalhes: result,
      };
    },
  },
  atualizar_indices_bacen: {
    key: "atualizar_indices_bacen",
    label: "Atualizar CDI e SELIC do BACEN",
    rotina: "Índices",
    descricao: "Busca CDI e SELIC diários direto no Banco Central (últimos 10 dias) e insere as datas ainda não cadastradas.",
    defaultNome: "Atualizar CDI e SELIC do BACEN",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 1440,
    async run() {
      const result = await syncRatesToCdiRates();
      const parts = Object.entries(result.summary).map(
        ([tipo, s]) => `${tipo}: ${s.inserted} nova(s) de ${s.fetched} consultada(s)`
      );
      return {
        ok: result.ok,
        message: parts.join(" · "),
        detalhes: result.summary,
      };
    },
  },
  fechamento_contabil_automatico: {
    key: "fechamento_contabil_automatico",
    label: "Fechamento contábil automático",
    rotina: "Fechamento Contábil",
    descricao: "Para empresas em modo API, deriva as baixas do ERP e roda o fechamento do mês — só posta os lançamentos se a empresa estiver em aprovação automática.",
    defaultNome: "Fechamento contábil automático",
    defaultModo: "mensal",
    defaultDiaMes: 31,
    defaultHoraExecucao: "22:00",
    async run() {
      return runAutomaticClosingForGroup();
    },
  },
  integrar_titulos_tributos: {
    key: "integrar_titulos_tributos",
    // Registro da auditoria da execução: os títulos de tributo e os alertas não são títulos de empréstimo.
    auditResourceType: "TaxPayableTitle",
    label: "Integrar títulos de tributo no ERP",
    rotina: "Gestão Tributária",
    descricao:
      "Envia ao Protheus os títulos das parcelas de tributo com guia vinculada e estorna os que a guia não sustenta mais. Só conta como feito o que o Protheus confirmar.",
    defaultNome: "Integrar títulos de tributo",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 60,
    async run() {
      const s = await syncTaxTitles();
      return {
        ok: s.incertos === 0 && s.outros === 0,
        message: `${s.enviados} integrado(s) · ${s.estornados} estornado(s) · ${s.pendentes} pendente(s) · ${s.incertos} sem confirmação · ${s.total} parcela(s) verificada(s)`,
        detalhes: s,
      };
    },
  },
  consultar_titulos_tributos: {
    key: "consultar_titulos_tributos",
    // Registro da auditoria da execução: os títulos de tributo e os alertas não são títulos de empréstimo.
    auditResourceType: "TaxPayableTitle",
    label: "Consultar títulos de tributo no ERP",
    rotina: "Gestão Tributária",
    descricao: "Atualiza saldo e baixa dos títulos de tributo já integrados no Protheus. Não altera a parcela.",
    defaultNome: "Consultar títulos de tributo",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 60,
    async run() {
      const s = await consultTaxTitles();
      return {
        ok: s.conferencia === 0,
        message: `${s.consultados} título(s) consultado(s) · ${s.conferencia} precisando de conferência`,
        detalhes: s,
      };
    },
  },
  alertas_tributarios: {
    key: "alertas_tributarios",
    // Registro da auditoria da execução: os títulos de tributo e os alertas não são títulos de empréstimo.
    auditResourceType: "TaxAlertSend",
    label: "Enviar alertas de vencimento dos tributos por e-mail",
    rotina: "Gestão Tributária",
    descricao:
      `Uma vez por dia, a partir das ${ALERT_FROM_HOUR}h, envia a cada usuário com acesso à Gestão Tributária um resumo das parcelas vencidas, das que vencem nos próximos ${DUE_SOON_DAYS} dias e das que estão sem guia. Só envia se houver algo a avisar; quem desligou os alertas não recebe. Agende no modo intervalo, a cada ${ALERT_MAX_INTERVAL_MINUTES} minutos: rodar mais de uma vez no dia não repete o e-mail.`,
    defaultNome: "Alertas de vencimento dos tributos",
    defaultModo: "intervalo",
    defaultIntervaloMinutos: 60,
    // O resumo sai uma vez por dia a partir das 7h: só um agendamento que roda ao menos de hora em hora garante uma
    // execução depois desse horário todo dia. Mensal, ou intervalo maior (um diário criado às 5h rodaria sempre às 5h),
    // pode nunca enviar — é recusado.
    scheduleRule(schedule) {
      if (schedule.modo !== "intervalo" || Number(schedule.intervaloMinutos) > ALERT_MAX_INTERVAL_MINUTES) {
        return `Os alertas de vencimento dos tributos precisam rodar no modo "intervalo", a cada ${ALERT_MAX_INTERVAL_MINUTES} minutos ou menos. O resumo é enviado uma vez por dia, a partir das ${ALERT_FROM_HOUR}h, e rodar de hora em hora garante que o envio aconteça sem repetir o e-mail.`;
      }
      return null;
    },
    async run() {
      return runTaxAlerts();
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

/**
 * Tipo de registro do resumo de auditoria de uma execução. Tarefa com tipo próprio (Gestão Tributária) usa o dela; as
 * demais seguem a regra de sempre: Contas a receber = título a receber, o resto = título a pagar.
 */
export function auditResourceTypeFor(meta) {
  if (meta?.auditResourceType) return meta.auditResourceType;
  return meta?.rotina === "Contas a receber" ? "ReceivableTitle" : "PayableTitle";
}

/** Mensagem de recusa quando o agendamento não serve para a tarefa (regra própria da tarefa), ou null. */
export function scheduleProblem(tarefa, schedule) {
  return TASKS[tarefa]?.scheduleRule?.(schedule) || null;
}

export function taskMeta(tarefa) {
  return TASKS[tarefa] || null;
}
