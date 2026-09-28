import { config } from "../config.js";
import { logger } from "../logger.js";

// Cliente HTTP do `emails-api`, o serviço central de e-mail da Clarity.
//
// Modelado a partir do cliente equivalente do SOLV
// (solv-backend/src/shared/services/emails-api-client.ts):
//   - best-effort: as funções exportadas nunca lançam. Devolvem `{ sent }`, a
//     mesma forma do sendMail() de modules/signup/mailer.js, pra que o fluxo de
//     negócio (criar usuário) jamais dependa do envio ter dado certo.
//   - retry com espera crescente só pra falha transitória (rede, timeout, 5xx).
//     4xx é terminal — payload ou chave errados não melhoram com retentativa.
//   - timeout por tentativa, pra não segurar a requisição do admin caso o
//     emails-api esteja no ar mas degradado.
//
// O template e o texto do e-mail são do emails-api; aqui só vão os dados.

const HTTP_TIMEOUT_MS = 15 * 1000;
const MAX_RETRIES = 3;
const MIN_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 4 * 1000;

class TerminalEmailError extends Error {
  constructor(message) {
    super(message);
    this.name = "TerminalEmailError";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isEmailsApiConfigured() {
  return Boolean(config.emailServiceUrl) && Boolean(config.emailServiceApiKey);
}

async function post(path, body, {
  timeoutMs = HTTP_TIMEOUT_MS,
  maxRetries = MAX_RETRIES,
  retryOnTimeout = true,
} = {}) {
  const url = `${config.emailServiceUrl}${path}`;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.emailServiceApiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) return;

      const text = await response.text().catch(() => "");
      const message = `emails-api ${path} respondeu ${response.status}: ${text.slice(0, 300)}`;
      if (response.status >= 400 && response.status < 500) {
        throw new TerminalEmailError(message);
      }
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof TerminalEmailError) throw error;
      // Timeout não diz se o e-mail saiu: o emails-api pode ter entregue e só
      // a resposta não chegou. Quem não tolera e-mail duplicado desliga a
      // retentativa nesse caso.
      if (controller.signal.aborted && !retryOnTimeout) {
        throw new Error(`emails-api ${path} não respondeu em ${timeoutMs} ms`);
      }
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxRetries) {
      const delay = Math.min(MIN_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
      logger.warn({ path, attempt, err: lastError }, "tentativa ao emails-api falhou; retentando");
      await sleep(delay);
    }
  }

  throw lastError || new Error(`emails-api ${path} falhou após ${maxRetries} tentativas`);
}

async function send(path, body, options) {
  if (!isEmailsApiConfigured()) {
    logger.warn({ path, to: body.to }, "emails-api não configurado; e-mail não enviado");
    return { sent: false, error: "emails-api não configurado" };
  }
  try {
    await post(path, body, options);
    return { sent: true };
  } catch (error) {
    logger.error({ err: error, path, to: body.to }, "falha ao enviar e-mail pelo emails-api");
    return { sent: false, error: error.message };
  }
}

/**
 * Convite de acesso enviado ao cadastrar (ou reenviado a) um usuário.
 * `convidadoPor` é opcional; os demais campos são obrigatórios no emails-api.
 * Não acrescente campos fora deste contrato: o emails-api recusa o que não
 * estiver no schema dele, e a recusa é 4xx (terminal, sem retentativa).
 */
export function sendUserInvite({ to, nome, convidadoPor, inviteUrl, expiraEmDias }) {
  const body = { to, nome, inviteUrl, expiraEmDias };
  if (convidadoPor) body.convidadoPor = convidadoPor;
  return send("/send/user-invite", body);
}

// Proposta comercial leva o PDF no corpo (alguns MB em base64): o emails-api
// repassa ao SMTP antes de responder, então 15 s não bastam. E aqui a
// retentativa em timeout fica desligada — o cliente receberia a proposta
// duas vezes, e quem clicou "Enviar" pode tentar de novo sabendo do erro.
const COMMERCIAL_PROPOSAL_OPTIONS = {
  timeoutMs: 60 * 1000,
  maxRetries: 2,
  retryOnTimeout: false,
};

/**
 * Proposta comercial enviada ao cliente, com o PDF anexado.
 * `nomeDestinatario`, `replyTo`, `mensagem` e `validadeAte` são opcionais e só
 * vão no corpo quando têm valor. Mesmo aviso do convite: nenhum campo fora
 * deste contrato — o emails-api recusa com 4xx.
 */
export function sendCommercialProposal({
  to,
  nomeDestinatario,
  clienteNome,
  numeroProposta,
  remetenteNome,
  replyTo,
  mensagem,
  validadeAte,
  anexo,
}) {
  const body = {
    to,
    clienteNome,
    numeroProposta,
    remetenteNome,
    anexo: { nomeArquivo: anexo.nomeArquivo, conteudoBase64: anexo.conteudoBase64 },
  };
  if (nomeDestinatario) body.nomeDestinatario = nomeDestinatario;
  if (replyTo) body.replyTo = replyTo;
  if (mensagem) body.mensagem = mensagem;
  if (validadeAte) body.validadeAte = validadeAte;
  return send("/send/commercial-proposal", body, COMMERCIAL_PROPOSAL_OPTIONS);
}
