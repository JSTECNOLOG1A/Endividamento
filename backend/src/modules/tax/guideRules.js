// Quando a guia de uma parcela vira EXCEÇÃO (alguém precisa olhar antes de pagar). A guia nunca dá baixa
// na parcela: aqui só se decide se ela está vinculada ou em exceção, e por quê.
// Valor da guia diferente do valor cadastrado da parcela NÃO é exceção — o cadastrado é estimativa.

import { READ_FAILURES } from "./guidePdf.js";

export const GUIDE_STATUSES = {
  vinculada: "vinculada",
  excecao: "excecao",
};

export const GUIDE_STATUS_LABELS = {
  vinculada: "Vinculada",
  excecao: "Em exceção",
};

export const EXCEPTION_CODES = {
  leitura: "LINHA_NAO_LIDA",
  leituraMultipla: "VARIAS_LINHAS_NO_PDF",
  cnpj: "CNPJ_DIFERENTE",
  duplicidade: "GUIA_EM_OUTRA_PARCELA",
  pagarAte: "PAGAR_ATE_FORA_DO_MES",
};

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function civilDateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

function monthLabel(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value || ""));
  return match ? `${MONTHS[Number(match[2]) - 1]} de ${match[1]}` : null;
}

export function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function formatCnpj(digits) {
  const d = onlyDigits(digits);
  if (d.length !== 14) return d || null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function peerLabel(peer) {
  const agreement = [peer.codigo_parcelamento, peer.orgao].filter(Boolean).join(" — ");
  return `parcela ${peer.numero_parcela} do parcelamento ${agreement}`;
}

/**
 * Motivos de exceção de uma guia, na ordem em que a tela mostra.
 * @param {object} facts
 * @param {string|null} facts.barcode código de barras conhecido da guia (null quando a leitura do PDF falhou)
 * @param {string|null} facts.readFailure motivo da falha de leitura do PDF (READ_FAILURES)
 * @param {string|null} facts.guideCnpj CNPJ da guia, quando conhecido
 * @param {string|null} facts.companyCnpj CNPJ da empresa do parcelamento
 * @param {string|null} facts.payBy "pagar até" da guia (AAAA-MM-DD), quando conhecido
 * @param {string} facts.dueDate vencimento da parcela (AAAA-MM-DD)
 * @param {object[]} facts.peers outras parcelas do mesmo grupo com guia atual de mesmo código de barras
 * @returns {{ codigo: string, mensagem: string }[]}
 */
export function guideExceptionReasons({ barcode, readFailure, guideCnpj, companyCnpj, payBy, dueDate, peers = [] }) {
  const reasons = [];
  if (!barcode) {
    reasons.push(readFailure === READ_FAILURES.multiplas
      ? {
        codigo: EXCEPTION_CODES.leituraMultipla,
        mensagem: "Este PDF tem mais de uma linha digitável. Informe à mão a linha digitável da guia desta parcela.",
      }
      : {
        codigo: EXCEPTION_CODES.leitura,
        mensagem: "Não foi possível ler a linha digitável deste PDF. Informe a linha digitável à mão.",
      });
  }
  const guideDigits = onlyDigits(guideCnpj);
  const companyDigits = onlyDigits(companyCnpj);
  if (guideDigits.length === 14 && companyDigits.length === 14 && guideDigits !== companyDigits) {
    reasons.push({
      codigo: EXCEPTION_CODES.cnpj,
      mensagem: `O CNPJ da guia (${formatCnpj(guideDigits)}) não é o da empresa do parcelamento (${formatCnpj(companyDigits)}).`,
    });
  }
  if (barcode && peers.length) {
    reasons.push({
      codigo: EXCEPTION_CODES.duplicidade,
      mensagem: `Esta mesma guia também está anexada à ${peers.map(peerLabel).join("; à ")}. Uma guia paga uma parcela só.`,
    });
  }
  if (payBy && dueDate && String(payBy).slice(0, 7) !== String(dueDate).slice(0, 7)) {
    reasons.push({
      codigo: EXCEPTION_CODES.pagarAte,
      mensagem: `O "pagar até" da guia (${civilDateLabel(payBy)}) não é do mês de vencimento da parcela (${monthLabel(dueDate)}).`,
    });
  }
  return reasons;
}

export function guideStatusFor(reasons) {
  return reasons.length ? GUIDE_STATUSES.excecao : GUIDE_STATUSES.vinculada;
}

/**
 * Valor que a parcela passa a ter para pagamento: o da guia, só quando a guia está vinculada e traz valor.
 * Sem isso, vale o valor cadastrado (estimado). Um ou outro — nunca os dois somados.
 */
export function amountToPay(guide) {
  if (!guide || guide.situacao !== GUIDE_STATUSES.vinculada) return null;
  return guide.valor_guia ?? null;
}
