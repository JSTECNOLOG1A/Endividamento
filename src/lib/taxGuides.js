// Guia de pagamento das parcelas (DARF / guia estadual): regras e rótulos que a tela usa.
// A guia nunca muda a situação de pagamento da parcela — só diz quanto e como pagar.

export const GUIDE_STATUS = {
  none: "sem_guia",
  linked: "vinculada",
  exception: "excecao",
};

const GUIDE_STATUS_LABELS = {
  sem_guia: "Sem guia",
  vinculada: "Guia vinculada",
  excecao: "Guia em exceção",
};

/** Situação da guia de uma parcela: sem guia, vinculada ou em exceção. */
export function guideStatusKey(guide) {
  if (!guide) return GUIDE_STATUS.none;
  return guide.situacao === GUIDE_STATUS.linked ? GUIDE_STATUS.linked : GUIDE_STATUS.exception;
}

export function guideStatusLabel(guide) {
  return GUIDE_STATUS_LABELS[guideStatusKey(guide)];
}

export function isGuideException(guide) {
  return Boolean(guide) && guide.situacao === GUIDE_STATUS.exception;
}

/**
 * Valor para pagamento da parcela: o da guia (quando vinculada e com valor) ou, sem isso, o valor cadastrado.
 * Um ou outro — nunca os dois somados.
 */
export function amountToPay(installment, guide) {
  if (guide && guide.valor_a_pagar !== null && guide.valor_a_pagar !== undefined) return guide.valor_a_pagar;
  return installment?.valor ?? null;
}

/** True quando o valor para pagamento vem da guia (e o cadastrado passa a ser só a estimativa). */
export function amountComesFromGuide(guide) {
  return Boolean(guide) && guide.valor_a_pagar !== null && guide.valor_a_pagar !== undefined;
}

/**
 * True quando a tela deve apresentar o valor como "a pagar", com o cadastrado como "estimado": só em parcela em aberto
 * com valor vindo da guia. Parcela paga ou cancelada não tem nada a pagar — o valor pago aparece no pagamento.
 */
export function showsAmountAsPayable(installment, guide) {
  return installment?.situacao === "em_aberto" && amountComesFromGuide(guide);
}

/** Guias atuais indexadas pela parcela. */
export function indexGuidesByInstallment(guides) {
  const map = new Map();
  for (const guide of guides || []) map.set(guide.installment_id, guide);
  return map;
}

/**
 * Parcelas em aberto (a vencer ou vencidas) cuja guia está em exceção — as que precisam de alguém antes do pagamento.
 * @param {{ installments: object[] }[]} rows linhas da carteira (cada uma com as parcelas pendentes do acordo)
 * @param {Map<string, object>} guidesByInstallment
 */
export function openInstallmentsWithGuideException(rows, guidesByInstallment) {
  const result = [];
  for (const row of rows || []) {
    for (const installment of row.installments || []) {
      if (installment.situacao !== "em_aberto") continue;
      const guide = guidesByInstallment?.get(installment.id);
      if (isGuideException(guide)) result.push({ row, installment, guide });
    }
  }
  return result.sort((a, b) => String(a.installment.vencimento).localeCompare(String(b.installment.vencimento)));
}

// Códigos de motivo de exceção que o servidor devolve (guideRules.js) e o que a pessoa pode fazer em cada caso.
export const EXCEPTION_CODES = {
  unreadLine: "LINHA_NAO_LIDA",
  multipleLines: "VARIAS_LINHAS_NO_PDF",
  companyMismatch: "CNPJ_DIFERENTE",
  duplicate: "GUIA_EM_OUTRA_PARCELA",
  payByOutsideMonth: "PAGAR_ATE_FORA_DO_MES",
};

const EXCEPTION_HINTS = {
  LINHA_NAO_LIDA: "Informe a linha digitável impressa na guia. O PDF continua anexado.",
  VARIAS_LINHAS_NO_PDF: "Informe a linha digitável da guia desta parcela. O PDF continua anexado.",
  CNPJ_DIFERENTE: "Confira se a guia é desta empresa. Se não for, substitua pela guia correta.",
  GUIA_EM_OUTRA_PARCELA: "Confira a qual parcela esta guia pertence e remova ou substitua a guia da parcela errada.",
  PAGAR_ATE_FORA_DO_MES: "Confira o “pagar até” impresso na guia e corrija a data, ou substitua a guia se ela for de outro mês.",
};

export function exceptionHint(code) {
  return EXCEPTION_HINTS[code] || "Confira a guia e, se precisar, substitua por outra.";
}

function hasReason(guide, codes) {
  return (guide?.motivos || []).some((item) => codes.includes(item.codigo));
}

/** A linha não foi lida do PDF e pode ser informada à mão (a lida do PDF não pode ser trocada). */
export function needsManualLine(guide) {
  return Boolean(guide) && guide.linha_fonte !== "pdf" && hasReason(guide, [EXCEPTION_CODES.unreadLine, EXCEPTION_CODES.multipleLines]);
}

/** Exceção que se resolve corrigindo dados da própria guia (linha não lida ou "pagar até" fora do mês). */
export function canCorrectGuide(guide) {
  return needsManualLine(guide) || hasReason(guide, [EXCEPTION_CODES.payByOutsideMonth]);
}

const CLOSED_INSTALLMENT_REASONS = {
  paga_aguardando_reconhecimento: "Esta parcela já está paga (aguardando reconhecimento). A guia não pode ser enviada para pagamento de novo.",
  reconhecida: "Esta parcela já está paga. A guia não pode ser enviada para pagamento de novo.",
  cancelada: "Esta parcela está cancelada. A guia não pode ser enviada para pagamento.",
};

/**
 * Se a guia pode ser enviada por e-mail agora e, se não, por quê. O servidor confere de novo na hora do envio.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function guideSendBlock(installment, guide) {
  if (!guide) return { ok: false, reason: "Esta parcela não tem guia anexada. Anexe a guia antes de enviar." };
  const closed = CLOSED_INSTALLMENT_REASONS[installment?.situacao];
  if (closed) return { ok: false, reason: closed };
  if (isGuideException(guide)) {
    return { ok: false, reason: "Esta guia está em exceção e não pode ser enviada. Resolva os motivos abaixo ou substitua a guia antes de enviar." };
  }
  return { ok: true };
}

export function guideOriginLabel(guide) {
  if (!guide) return "—";
  return guide.origem === "pdf" ? "PDF anexado" : "Linha digitável informada à mão";
}

/** Origem da linha digitável quando o PDF foi anexado: lida do arquivo ou informada depois. */
export function guideLineSourceLabel(guide) {
  if (!guide?.linha_digitavel) return null;
  if (guide.origem !== "pdf") return null;
  return guide.linha_fonte === "pdf" ? "lida do PDF" : "informada à mão";
}

const CLOSING_LABELS = {
  substituida: "Substituída",
  removida: "Removida",
};

export function guideClosingLabel(guide) {
  return CLOSING_LABELS[guide?.motivo_encerramento] || "Encerrada";
}

const SEND_RESULT_LABELS = {
  enviado: "Enviado",
  parcial: "Enviado em parte",
  falhou: "Não enviado",
};

export function sendResultLabel(result) {
  return SEND_RESULT_LABELS[result] || "—";
}

export const MAX_GUIDE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_GUIDE_RECIPIENTS = 10;
export const GUIDE_MESSAGE_MAX = 2000;

/** Separa o que a pessoa digitou em endereços (vírgula, ponto e vírgula, espaço ou quebra de linha). */
export function splitRecipients(text) {
  return String(text || "")
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value) {
  return value.length <= 254 && EMAIL.test(value);
}

/** Junta listas de destinatários sem repetir (sem diferenciar maiúsculas). */
export function mergeRecipients(current, added) {
  const seen = new Set(current.map((item) => item.toLowerCase()));
  const next = [...current];
  for (const item of added) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Data e hora (fuso de Brasília) de um instante gravado pelo servidor. */
export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_TIME.format(date).replace(",", " às");
}

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** "a", "a e b", "a, b e c". */
export function joinList(items) {
  const list = (items || []).filter(Boolean);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

/** Parâmetro da URL que abre a guia de uma parcela no detalhe do parcelamento. */
export const GUIDE_URL_PARAM = "guia";
