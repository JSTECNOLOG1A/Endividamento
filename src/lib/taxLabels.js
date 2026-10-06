import { formatCivilDate } from "./taxDates.js";

// Rótulos da Gestão Tributária: tudo o que a tela mostra passa por aqui — nenhum valor interno aparece cru.

export const AGREEMENT_STATUS_LABELS = {
  ativo: "Ativo",
  quitado: "Quitado",
  rescindido: "Rescindido",
  suspenso: "Suspenso",
};

export const AGREEMENT_STATUS_OPTIONS = Object.entries(AGREEMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }));

// Situação da parcela como a equipe fala: "A vencer", "Vencida", "Paga, aguardando reconhecimento", "Paga".
// "em_aberto" vira "A vencer" ou "Vencida" conforme o vencimento; onde não há data para decidir (escolha no
// formulário), o rótulo cobre os dois casos.
export const INSTALLMENT_DUE_LABEL = "A vencer";
export const INSTALLMENT_OVERDUE_LABEL = "Vencida";

const INSTALLMENT_STATUS_LABELS = {
  paga_aguardando_reconhecimento: "Paga, aguardando reconhecimento",
  reconhecida: "Paga",
  cancelada: "Cancelada",
};

export const INSTALLMENT_STATUS_OPTIONS = [
  { value: "em_aberto", label: `${INSTALLMENT_DUE_LABEL} ou ${INSTALLMENT_OVERDUE_LABEL.toLowerCase()}` },
  ...Object.entries(INSTALLMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

/** Parcela "em_aberto" com vencimento antes de hoje. */
export function isInstallmentOverdue(installment, today) {
  return installment?.situacao === "em_aberto" && Boolean(installment.vencimento) && installment.vencimento < today;
}

/** Rótulo da situação de uma parcela, já resolvendo "A vencer" × "Vencida" pela data civil de hoje. */
export function installmentStatusLabel(installment, today) {
  if (!installment) return "—";
  if (installment.situacao === "em_aberto") {
    return isInstallmentOverdue(installment, today) ? INSTALLMENT_OVERDUE_LABEL : INSTALLMENT_DUE_LABEL;
  }
  return INSTALLMENT_STATUS_LABELS[installment.situacao] || "—";
}

export const PAID_INSTALLMENT_STATUSES = new Set(["paga_aguardando_reconhecimento", "reconhecida"]);

const ORIGIN_LABELS = {
  manual: "Informado manualmente",
  importado: "Importado de arquivo",
  api: "Obtido automaticamente",
};

export function originLabel(origem) {
  return ORIGIN_LABELS[origem] || ORIGIN_LABELS.manual;
}

export function conferenceLabel(ultimaConferencia) {
  return ultimaConferencia ? `conferido em ${formatCivilDate(ultimaConferencia)}` : "nunca conferido";
}

export const SPHERE_LABELS = {
  federal: "Federal",
  estadual: "Estadual",
};

export const FEDERAL_AGENCY_SUGGESTIONS = ["Receita Federal", "PGFN"];

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Número JS → texto no formato do campo de moeda (vírgula decimal, sem milhar). */
export function toCurrencyField(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value).replace(".", ",");
}

/** Texto do campo de moeda ("1234,56") → número, ou null quando vazio. */
export function parseCurrencyField(text) {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  const n = Number(String(text).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Visualizador só lê; a escrita é recusada pelo servidor (403 READ_ONLY). */
export function canWriteTax(user) {
  return Boolean(user) && user.role !== "viewer" && user.tenant_role !== "VIEWER";
}
