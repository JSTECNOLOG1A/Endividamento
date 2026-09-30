// Desfecho da proposta comercial (aceite ou recusa pelo cliente). Proposta com
// desfecho registrado fica travada: o servidor recusa edição, envio por e-mail
// e um segundo desfecho.

export const CLOSED_STATUSES = ["aceita", "recusada"];

export const PROPOSAL_STATUS_LABELS = {
  elaborando: "Elaborando",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
};

export function isProposalClosed(record) {
  return Boolean(record) && CLOSED_STATUSES.includes(record.status);
}

export const ACCEPTANCE_CHANNEL_OPTIONS = [
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "em_maos", label: "Em mãos" },
];

export function acceptanceChannelLabel(value) {
  return ACCEPTANCE_CHANNEL_OPTIONS.find((option) => option.value === value)?.label || "—";
}

export const MAX_SIGNED_FILE_BYTES = 20 * 1024 * 1024;
export const SIGNER_NAME_MAX_LENGTH = 150;
export const SIGNER_ROLE_MAX_LENGTH = 120;
export const OUTCOME_TEXT_MAX_LENGTH = 2000;

// "Hoje" no calendário de São Paulo, no formato do campo de data (AAAA-MM-DD)
// — o mesmo dia que o servidor usa para recusar datas futuras.
export function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

// Data guardada como texto (AAAA-MM-DD): convertida com new Date, cairia no dia
// anterior por causa do fuso.
export function formatDateOnlyBR(value) {
  const [year, month, day] = String(value || "").split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year}`;
}

export function formatDateTimeLongBR(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (!isoTimestamp || Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("pt-BR");
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${day} às ${time}`;
}

export function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  if (size >= 1024) return `${Math.round(size / 1024).toLocaleString("pt-BR")} KB`;
  return `${size} bytes`;
}

// Fecha a frase com ponto sem duplicá-lo quando o texto já termina em
// pontuação (ex.: razão social "Empresa S.A.").
export function asSentence(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// Proposta travada no servidor enquanto a tela ainda a mostrava aberta.
export function isProposalClosedError(error) {
  return error?.status === 409 && error?.code === "PROPOSAL_CLOSED";
}

// Mensagem do servidor quando houver; "HTTP 500" e afins não dizem nada a
// quem usa a tela.
export function serverMessage(error, fallback) {
  if (error?.data?.error) return error.data.error;
  const message = String(error?.message || "");
  return message && !/^HTTP \d+$/.test(message) ? message : fallback;
}
