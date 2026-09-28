import { z } from "zod";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { sendCommercialProposal } from "../../services/emailsApiClient.js";
import { generateCode } from "../integrations/crypto.js";

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

const TEXT_FIELDS = [
  "client_name", "client_cnpj", "client_endereco", "contact_name", "contratante_cargo", "validity_days",
  "tier", "contract_count", "qtd_renegociados", "cadastro_qty",
  "pagamento_implantacao", "pagamento_mensalidade", "dia_vencimento", "outros_valores",
  "objeto", "escopo_disponibilizacao", "escopo_implantacao", "escopo_integracoes", "escopo_treinamento", "escopo_demais",
  "cronograma_inicio", "cronograma_prazo", "cronograma_contado_a", "equipe_clarity_ib", "equipe_contratante",
  "vigencia_duracao", "vigencia_inicio", "vigencia_renovacao", "foro_comarca", "foro_estado",
  "assinatura_cidade", "contratada_representante", "contratada_cargo",
];
const BOOLEAN_FIELDS = ["want_cadastro"];
const NUMERIC_FIELDS = ["valor_implantacao", "valor_mensalidade", "valor_cadastramento_total", "valor_total_primeiro_mes"];
const INT_FIELDS = ["blocos_count", "carteira_total"];
const JSON_FIELDS = ["pricing_snapshot"];

// Campos graváveis tanto na criação quanto na atualização — "numero" e
// "status" ficam fora: numero é imutável após criado, status não é
// alterado por este fluxo (ver regra de "Expirada" calculada em runtime).
const WRITABLE_FIELDS = [...TEXT_FIELDS, ...BOOLEAN_FIELDS, ...NUMERIC_FIELDS, ...INT_FIELDS, ...JSON_FIELDS];

function pickValue(body, field) {
  if (BOOLEAN_FIELDS.includes(field)) return Boolean(body[field]);
  if (NUMERIC_FIELDS.includes(field)) return Number(body[field]) || 0;
  if (INT_FIELDS.includes(field)) return Math.max(0, Math.round(Number(body[field]) || 0));
  if (JSON_FIELDS.includes(field)) return JSON.stringify(body[field] || {});
  const value = body[field];
  return value === undefined || value === null ? null : String(value);
}

export async function list({ q, limit, offset } = {}) {
  const params = [];
  let where = "";
  const term = String(q || "").trim().toLowerCase();
  if (term) {
    params.push(`%${term}%`);
    where = `WHERE lower(numero) LIKE $${params.length}
      OR lower(coalesce(client_name, '')) LIKE $${params.length}
      OR lower(coalesce(client_cnpj, '')) LIKE $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const result = await pool.query(
    `SELECT * FROM commercial_proposals ${where}
     ORDER BY created_date DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getById(id) {
  // id fora do formato não existe — sem isso o Postgres recusa o cast e a
  // resposta vira 500 em vez de 404.
  if (!UUID_PATTERN.test(String(id || ""))) throw httpError(404, "Proposta não encontrada");
  const result = await pool.query("SELECT * FROM commercial_proposals WHERE id = $1", [id]);
  if (!result.rows[0]) throw httpError(404, "Proposta não encontrada");
  return result.rows[0];
}

export async function create(body, user) {
  if (!body?.tier) throw httpError(400, "Plano (tier) é obrigatório");
  const numero = String(body.numero || "").trim() || generateCode("PC");
  const cols = ["numero", "status", ...WRITABLE_FIELDS, "created_by", "updated_by"];
  const values = [
    numero,
    "elaborando",
    ...WRITABLE_FIELDS.map((field) => pickValue(body, field)),
    user?.email || null,
    user?.email || null,
  ];
  const placeholders = values.map((_, i) => `$${i + 1}`);
  const result = await pool.query(
    `INSERT INTO commercial_proposals (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function update(id, body, user) {
  await getById(id);
  const setClauses = WRITABLE_FIELDS.map((field, i) => `${field} = $${i + 1}`);
  const values = WRITABLE_FIELDS.map((field) => pickValue(body, field));
  values.push(user?.email || null);
  values.push(id);
  const result = await pool.query(
    `UPDATE commercial_proposals
     SET ${setClauses.join(", ")}, updated_date = now(), updated_by = $${values.length - 1}
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Envio da proposta por e-mail
// ---------------------------------------------------------------------------

// Teto do PDF anexado (já decodificado). Em base64 ele ocupa 4/3 disso, o que
// cabe no limite global de corpo JSON do app (8mb, app.js).
export const MAX_PDF_BYTES = 3 * 1024 * 1024;
const MAX_PDF_BASE64_LENGTH = Math.ceil(MAX_PDF_BYTES / 3) * 4;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const PDF_SIGNATURE = "%PDF-";
// Só o nome do arquivo: sem barra (nada de caminho), sem caractere de
// controle, terminando em ".pdf".
const FILE_NAME_PATTERN = /^[^\\/\x00-\x1f\x7f]+\.pdf$/i;

const SEND_FAILED_MESSAGE = "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.";
const STATUS_NOT_UPDATED_MESSAGE = "O e-mail foi enviado e registrado, mas a situação da proposta não foi atualizada. Atualize a página para conferir.";
const SENT_BUT_NOT_RECORDED_MESSAGE = "O e-mail foi enviado, mas não conseguimos registrar o envio no histórico. Não é preciso reenviar.";

const optionalText = (max, message) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "") || value === null ? undefined : value,
  z.string().trim().max(max, message).optional()
);

const sendEmailSchema = z.object({
  to: z.string({ required_error: "Informe o e-mail do destinatário", invalid_type_error: "Informe o e-mail do destinatário" })
    .trim()
    .min(1, "Informe o e-mail do destinatário")
    .max(254, "E-mail do destinatário inválido")
    .email("E-mail do destinatário inválido"),
  // Sem preprocess de vazio: aqui "veio vazio" e "não veio" significam coisas
  // diferentes (ver recipientName).
  nomeDestinatario: z.string({ invalid_type_error: "Nome do destinatário inválido" })
    .trim()
    .max(120, "O nome do destinatário pode ter no máximo 120 caracteres")
    .refine((value) => !/[\r\n]/.test(value), "O nome do destinatário não pode ter quebra de linha")
    .nullable()
    .optional(),
  mensagem: optionalText(2000, "A mensagem pode ter no máximo 2000 caracteres"),
  pdfBase64: z.string({ required_error: "O PDF da proposta não foi enviado", invalid_type_error: "O PDF da proposta não foi enviado" })
    .min(1, "O PDF da proposta não foi enviado")
    .max(MAX_PDF_BASE64_LENGTH, "O PDF da proposta passa do tamanho máximo de 3 MB")
    .refine((value) => value.length % 4 === 0 && BASE64_PATTERN.test(value), "O PDF da proposta não está em base64 válido")
    .refine((value) => Buffer.from(value.slice(0, 12), "base64").toString("latin1").startsWith(PDF_SIGNATURE), "O arquivo enviado não é um PDF"),
  nomeArquivo: z.string({ required_error: "Informe o nome do arquivo", invalid_type_error: "Informe o nome do arquivo" })
    .trim()
    .min(1, "Informe o nome do arquivo")
    .max(150, "O nome do arquivo pode ter no máximo 150 caracteres")
    .regex(FILE_NAME_PATTERN, "O nome do arquivo deve terminar em .pdf e não pode conter pastas"),
});

function parseSendEmailInput(body) {
  const parsed = sendEmailSchema.safeParse(body || {});
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message || "Dados de envio inválidos", "VALIDATION");
  }
  return parsed.data;
}

const VALIDITY_DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const SAO_PAULO_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Sao_Paulo",
});

// Data de criação + dias de validade, por extenso ("13 de outubro de 2026").
// A soma é feita sobre o DIA de calendário em São Paulo — uma proposta criada
// às 23h de Brasília continua contando a partir daquele dia, não do seguinte
// em UTC. Prazo vazio vale o mesmo padrão que o PDF imprime (tela Proposta
// Comercial: `validityDays || "15"`), para o e-mail não anunciar outra data.
const DEFAULT_VALIDITY_DAYS = "15";

export function proposalValidUntil(createdDate, validityDays) {
  const days = Number(validityDays || DEFAULT_VALIDITY_DAYS);
  const created = createdDate ? new Date(createdDate) : null;
  if (!Number.isInteger(days) || days <= 0 || !created || Number.isNaN(created.getTime())) return undefined;
  const [year, month, day] = SAO_PAULO_DAY.format(created).split("-").map(Number);
  const expires = new Date(Date.UTC(year, month - 1, day + days));
  return VALIDITY_DATE_FORMAT.format(expires);
}

// Nome usado na saudação do e-mail. Chave ausente mantém o comportamento de
// antes (contato da proposta); chave presente decide sozinha — vazia significa
// "sem nome", para o reenvio a outra pessoa não saudar o contato original.
function recipientName(body, input, proposal) {
  if (Object.prototype.hasOwnProperty.call(body || {}, "nomeDestinatario")) {
    return input.nomeDestinatario || undefined;
  }
  return String(proposal.contact_name || "").trim() || undefined;
}

async function recordSend(db, { proposalId, to, nomeDestinatario, user, mensagem, nomeArquivo, result, errorDetail }) {
  const inserted = await db.query(
    `INSERT INTO commercial_proposal_sends
       (proposal_id, recipient_email, recipient_name, sent_by_email, sent_by_name, message, file_name, result, error_detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      proposalId,
      to,
      nomeDestinatario || null,
      user?.email || null,
      user?.full_name || null,
      mensagem || null,
      nomeArquivo,
      result,
      errorDetail ? String(errorDetail).slice(0, 2000) : null,
    ]
  );
  return inserted.rows[0];
}

export async function listSends(id) {
  await getById(id);
  const result = await pool.query(
    `SELECT id, proposal_id, recipient_email, recipient_name, sent_by_email, sent_by_name, message, file_name,
            result, error_detail, created_date
     FROM commercial_proposal_sends
     WHERE proposal_id = $1
     ORDER BY created_date DESC, id DESC`,
    [id]
  );
  return result.rows;
}

export async function sendByEmail(id, body, user) {
  const input = parseSendEmailInput(body);
  const proposal = await getById(id);
  const clienteNome = String(proposal.client_name || "").trim();
  if (!clienteNome) {
    throw httpError(422, "Informe o nome do cliente na proposta antes de enviá-la por e-mail", "PROPOSAL_INCOMPLETE");
  }

  const nomeDestinatario = recipientName(body, input, proposal);
  const outcome = await sendCommercialProposal({
    to: input.to,
    nomeDestinatario,
    clienteNome,
    numeroProposta: proposal.numero,
    remetenteNome: String(user?.full_name || "").trim() || user?.email,
    replyTo: user?.email || undefined,
    mensagem: input.mensagem,
    validadeAte: proposalValidUntil(proposal.created_date, proposal.validity_days),
    anexo: { nomeArquivo: input.nomeArquivo, conteudoBase64: input.pdfBase64 },
  });

  const record = {
    proposalId: proposal.id,
    to: input.to,
    nomeDestinatario,
    user,
    mensagem: input.mensagem,
    nomeArquivo: input.nomeArquivo,
  };

  if (!outcome.sent) {
    try {
      await recordSend(pool, { ...record, result: "falhou", errorDetail: outcome.error || "falha desconhecida" });
    } catch (error) {
      // O registro da falha é informativo; o que o usuário precisa saber é
      // que o e-mail não saiu — isso não pode virar outro erro.
      logger.error({ err: error, proposalId: proposal.id }, "falha ao registrar envio malsucedido da proposta");
    }
    const err = httpError(502, SEND_FAILED_MESSAGE, "EMAIL_SEND_FAILED");
    err.expose = true;
    throw err;
  }

  // O e-mail já saiu: daqui em diante nada desfaz o envio. Histórico e status
  // são gravados em passos separados, de propósito — numa transação única, uma
  // falha no status desfaria também a prova de que o e-mail foi entregue.
  let send = null;
  try {
    send = await recordSend(pool, { ...record, result: "enviado" });
  } catch (error) {
    logger.error({ err: error, proposalId: proposal.id }, "e-mail da proposta enviado, mas o registro do envio falhou");
  }

  let current = proposal;
  let statusError = null;
  try {
    const updated = await pool.query(
      `UPDATE commercial_proposals
       SET status = 'enviada', updated_date = now(), updated_by = $2
       WHERE id = $1 AND status = 'elaborando'
       RETURNING *`,
      [proposal.id, user?.email || null]
    );
    if (updated.rows[0]) current = updated.rows[0];
  } catch (error) {
    statusError = error;
    logger.error({ err: error, proposalId: proposal.id }, "e-mail da proposta enviado, mas o status não foi atualizado");
  }

  if (!send) {
    // Não é falha de envio: o cliente já recebeu. Dizer "tente novamente"
    // aqui faria a proposta chegar duas vezes.
    const err = httpError(500, SENT_BUT_NOT_RECORDED_MESSAGE, "EMAIL_SENT_NOT_RECORDED");
    err.expose = true;
    throw err;
  }

  // E-mail entregue e registrado: é sucesso. Status que não acompanhou vira
  // aviso, nunca erro — erro levaria a pessoa a reenviar.
  return {
    proposal: current,
    send,
    warning: statusError
      ? { code: "STATUS_NOT_UPDATED", message: STATUS_NOT_UPDATED_MESSAGE }
      : null,
  };
}
