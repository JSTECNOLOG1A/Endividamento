import { z } from "zod";
import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { sendCommercialProposal } from "../../services/emailsApiClient.js";
import { generateCode } from "../integrations/crypto.js";
import {
  isPdf,
  proposalFileExists,
  removeProposalFile,
  resolveProposalFile,
  saveProposalFile,
} from "./storage.js";

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
const BOOLEAN_FIELDS = ["want_cadastro", "cobrar_implantacao"];
const NUMERIC_FIELDS = ["valor_implantacao", "valor_mensalidade", "valor_cadastramento_total", "valor_total_primeiro_mes"];
const INT_FIELDS = ["blocos_count", "carteira_total"];
const JSON_FIELDS = ["pricing_snapshot"];
// Diferente de NUMERIC_FIELDS/INT_FIELDS: ausente vira NULL (= "usa o valor
// automático do plano" / "usa o nº de parcelas padrão da forma de
// pagamento"), não 0 — 0 seria um valor manual de verdade.
const NULLABLE_NUMERIC_FIELDS = ["implantacao_valor_manual"];
const NULLABLE_INT_FIELDS = ["implantacao_parcelas"];

// Campos graváveis tanto na criação quanto na atualização — "numero" e
// "status" ficam fora: numero é imutável após criado, status não é
// alterado por este fluxo (ver regra de "Expirada" calculada em runtime).
const WRITABLE_FIELDS = [
  ...TEXT_FIELDS, ...BOOLEAN_FIELDS, ...NUMERIC_FIELDS, ...NULLABLE_NUMERIC_FIELDS,
  ...INT_FIELDS, ...NULLABLE_INT_FIELDS, ...JSON_FIELDS,
];

function pickValue(body, field) {
  if (BOOLEAN_FIELDS.includes(field)) return Boolean(body[field]);
  if (NUMERIC_FIELDS.includes(field)) return Number(body[field]) || 0;
  if (NULLABLE_NUMERIC_FIELDS.includes(field)) {
    const value = body[field];
    return value === undefined || value === null || value === "" ? null : Number(value);
  }
  if (INT_FIELDS.includes(field)) return Math.max(0, Math.round(Number(body[field]) || 0));
  if (NULLABLE_INT_FIELDS.includes(field)) {
    const value = body[field];
    return value === undefined || value === null || value === "" ? null : Math.max(1, Math.round(Number(value)));
  }
  if (JSON_FIELDS.includes(field)) return JSON.stringify(body[field] || {});
  const value = body[field];
  return value === undefined || value === null ? null : String(value);
}

const optionalText = (max, message) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "") || value === null ? undefined : value,
  z.string().trim().max(max, message).optional()
);

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Evento da linha do tempo, gravado pela mesma conexão (e transação) da
// operação que o gera.
async function recordHistory(db, proposalId, { eventType, previousValue, newValue, note, user, sendId }) {
  await db.query(
    `INSERT INTO commercial_proposal_history
       (proposal_id, event_type, previous_value, new_value, note, actor, actor_name, send_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      proposalId,
      eventType,
      previousValue ?? null,
      newValue ?? null,
      note ? String(note).slice(0, 2000) : null,
      user?.email || null,
      user?.full_name || null,
      sendId || null,
    ]
  );
}

// Situações gravadas. "Expirada" não é uma delas: é calculada na tela a partir
// da validade e não é filtrada aqui.
const PROPOSAL_STATUSES = ["elaborando", "enviada", "aceita", "recusada"];

// ?status=aceita ou lista separada por vírgula (?status=elaborando,enviada).
function parseStatusFilter(value) {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value.join(",") : String(value);
  const statuses = [...new Set(raw.split(",").map((item) => item.trim()).filter(Boolean))];
  const invalid = statuses.filter((status) => !PROPOSAL_STATUSES.includes(status));
  if (invalid.length || !statuses.length) {
    throw httpError(400, "Situação inválida. Use elaborando, enviada, aceita ou recusada.", "VALIDATION");
  }
  return statuses;
}

export async function list({ q, status, limit, offset } = {}) {
  const params = [];
  const conditions = [];
  const statuses = parseStatusFilter(status);
  if (statuses.length) {
    params.push(statuses);
    conditions.push(`status = ANY($${params.length}::text[])`);
  }
  const term = String(q || "").trim().toLowerCase();
  if (term) {
    params.push(`%${term}%`);
    conditions.push(`(lower(numero) LIKE $${params.length}
      OR lower(coalesce(client_name, '')) LIKE $${params.length}
      OR lower(coalesce(client_cnpj, '')) LIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const result = await pool.query(
    `SELECT * FROM commercial_proposals ${where}
     ORDER BY created_date DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows.map(presentProposal);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Situações que encerram a proposta: dali em diante ela não é editada, não é
// enviada e não muda de novo de situação.
const OPEN_STATUSES = ["elaborando", "enviada"];
const CLOSED_MESSAGES = {
  aceita: {
    edit: "Esta proposta já foi aceita pelo cliente e não pode mais ser alterada.",
    send: "Esta proposta já foi aceita pelo cliente e não pode mais ser enviada por e-mail.",
    transition: "Esta proposta já foi aceita pelo cliente. Não é possível registrar outro desfecho.",
  },
  recusada: {
    edit: "Esta proposta foi recusada pelo cliente e não pode mais ser alterada.",
    send: "Esta proposta foi recusada pelo cliente e não pode mais ser enviada por e-mail.",
    transition: "Esta proposta já foi recusada pelo cliente. Não é possível registrar outro desfecho.",
  },
};

function closedError(status, action) {
  const message = CLOSED_MESSAGES[status]?.[action]
    || "A situação desta proposta não permite esta ação. Atualize a página para conferir.";
  return httpError(409, message, "PROPOSAL_CLOSED");
}

function assertOpen(proposal, action) {
  if (!OPEN_STATUSES.includes(proposal.status)) throw closedError(proposal.status, action);
}

// DATE chega do pg como Date na meia-noite local; devolvido assim, vira ISO em
// UTC e a tela mostraria o dia anterior. A data do cliente sai como texto.
function dateOnly(value) {
  if (!(value instanceof Date)) return value ?? null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

// O caminho do arquivo no disco é interno: a resposta diz só se há arquivo.
function presentProposal(row) {
  if (!row) return row;
  const { arquivo_assinado_chave: signedFileKey, ...rest } = row;
  return {
    ...rest,
    data_assinatura: dateOnly(row.data_assinatura),
    tem_arquivo_assinado: Boolean(signedFileKey),
  };
}

async function findById(id) {
  // id fora do formato não existe — sem isso o Postgres recusa o cast e a
  // resposta vira 500 em vez de 404.
  if (!UUID_PATTERN.test(String(id || ""))) throw httpError(404, "Proposta não encontrada", "NOT_FOUND");
  const result = await pool.query("SELECT * FROM commercial_proposals WHERE id = $1", [id]);
  if (!result.rows[0]) throw httpError(404, "Proposta não encontrada", "NOT_FOUND");
  return result.rows[0];
}

export async function getById(id) {
  return presentProposal(await findById(id));
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
  return inTransaction(async (db) => {
    const result = await db.query(
      `INSERT INTO commercial_proposals (${cols.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      values
    );
    const row = result.rows[0];
    await recordHistory(db, row.id, { eventType: "criada", newValue: row.status, user });
    return presentProposal(row);
  });
}

// Conteúdo editável como texto canônico do próprio Postgres: comparar antes e
// depois diz se o salvamento mudou alguma coisa, sem diff campo a campo.
const CONTENT_SNAPSHOT = `ROW(${WRITABLE_FIELDS.join(", ")})::text`;

export async function update(id, body, user) {
  await findById(id);
  const setClauses = WRITABLE_FIELDS.map((field, i) => `${field} = $${i + 1}`);
  const values = WRITABLE_FIELDS.map((field) => pickValue(body, field));
  values.push(user?.email || null);
  values.push(id);
  return inTransaction(async (db) => {
    // Trava a linha: aceite ou recusa simultâneos esperam este salvamento
    // terminar (ou este espera o deles e vê a proposta já encerrada).
    const locked = await db.query(
      `SELECT status, ${CONTENT_SNAPSHOT} AS content FROM commercial_proposals WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!locked.rows[0]) throw httpError(404, "Proposta não encontrada", "NOT_FOUND");
    assertOpen(locked.rows[0], "edit");
    const result = await db.query(
      `UPDATE commercial_proposals
       SET ${setClauses.join(", ")}, updated_date = now(), updated_by = $${values.length - 1}
       WHERE id = $${values.length} AND status IN ('elaborando', 'enviada')
       RETURNING *, ${CONTENT_SNAPSHOT} AS content`,
      values
    );
    const { content, ...row } = result.rows[0];
    // Salvar sem ter mudado nada não vira evento: a linha do tempo mostra
    // edições, não cliques em "Salvar".
    if (content !== locked.rows[0].content) {
      await recordHistory(db, id, { eventType: "editada", user });
    }
    return presentProposal(row);
  });
}

// ---------------------------------------------------------------------------
// Desfecho: aceite e recusa
// ---------------------------------------------------------------------------

// Teto do arquivo assinado. Assinatura costuma voltar digitalizada (imagem por
// página), bem maior que o PDF gerado pela tela.
export const MAX_SIGNED_FILE_BYTES = 20 * 1024 * 1024;

const SAO_PAULO_TODAY = () => new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Sao_Paulo",
}).format(new Date());

function isRealDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const ACCEPTANCE_CHANNELS = ["email", "whatsapp", "em_maos"];

const acceptSchema = z.object({
  data_assinatura: z.string({ required_error: "Informe a data em que o cliente assinou", invalid_type_error: "Informe a data em que o cliente assinou" })
    .trim()
    .min(1, "Informe a data em que o cliente assinou")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de assinatura inválida")
    .refine(isRealDate, "Data de assinatura inválida")
    // Dia de calendário em São Paulo: quem registra às 22h de Brasília ainda
    // está "hoje", mesmo que em UTC já seja amanhã.
    .refine((value) => value <= SAO_PAULO_TODAY(), "A data de assinatura não pode ser uma data futura"),
  nome_assinante: z.string({ required_error: "Informe o nome de quem assinou pelo cliente", invalid_type_error: "Informe o nome de quem assinou pelo cliente" })
    .trim()
    .min(1, "Informe o nome de quem assinou pelo cliente")
    .max(150, "O nome de quem assinou pode ter no máximo 150 caracteres"),
  cargo_assinante: optionalText(120, "O cargo de quem assinou pode ter no máximo 120 caracteres"),
  canal_aceite: z.enum(ACCEPTANCE_CHANNELS, {
    errorMap: () => ({ message: "Informe por onde o cliente devolveu a proposta: e-mail, WhatsApp ou em mãos" }),
  }),
  observacao_aceite: optionalText(2000, "A observação pode ter no máximo 2000 caracteres"),
});

const rejectSchema = z.object({
  motivo_recusa: z.string({ required_error: "Informe o motivo da recusa", invalid_type_error: "Informe o motivo da recusa" })
    .trim()
    .min(1, "Informe o motivo da recusa")
    .max(2000, "O motivo da recusa pode ter no máximo 2000 caracteres"),
});

function parseInput(schema, body, fallbackMessage) {
  const parsed = schema.safeParse(body || {});
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message || fallbackMessage, "VALIDATION");
  }
  return parsed.data;
}

// Nome guardado só para o download: sem caminho, sem caractere de controle, e
// sempre terminando em ".pdf".
function safeOriginalName(name, fallback) {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f"]/g, "").trim().slice(0, 150);
  if (!base) return fallback;
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function validateSignedFile(file) {
  if (!file) return null;
  if (!file.buffer?.length) throw httpError(400, "O arquivo assinado está vazio", "VALIDATION");
  if (!isPdf(file.buffer)) throw httpError(400, "O arquivo assinado precisa ser um PDF", "INVALID_FILE");
  return file;
}

// Colunas que um desfecho pode gravar, por situação de destino. Nome de coluna
// não vira parâmetro no SQL, então só entra o que estiver nesta lista; todo
// valor (inclusive a situação) vai como parâmetro.
const OUTCOME_COLUMNS = {
  aceita: {
    stamp: "accepted_at",
    columns: [
      "accepted_by_email", "accepted_by_name", "data_assinatura", "nome_assinante", "cargo_assinante",
      "canal_aceite", "observacao_aceite", "arquivo_assinado_chave", "arquivo_assinado_nome", "arquivo_assinado_tamanho",
    ],
  },
  recusada: {
    stamp: "rejected_at",
    columns: ["rejected_by_email", "rejected_by_name", "motivo_recusa"],
  },
};

// Troca de situação atômica: a linha é travada e a condição de origem vai no
// próprio UPDATE, então de duas requisições simultâneas só uma encontra a
// proposta ainda aberta. O evento da linha do tempo entra na mesma transação.
async function closeProposal(id, targetStatus, fields, user, note) {
  const spec = OUTCOME_COLUMNS[targetStatus];
  if (!spec) throw new Error(`situação de desfecho desconhecida: ${targetStatus}`);
  const unknown = Object.keys(fields).filter((column) => !spec.columns.includes(column));
  if (unknown.length) throw new Error(`colunas fora do desfecho ${targetStatus}: ${unknown.join(", ")}`);

  const params = [id, targetStatus, user?.email || null];
  const assignments = Object.entries(fields).map(([column, value]) => {
    params.push(value);
    return `${column} = $${params.length}`;
  });
  return inTransaction(async (db) => {
    const locked = await db.query("SELECT status FROM commercial_proposals WHERE id = $1 FOR UPDATE", [id]);
    const previousStatus = locked.rows[0]?.status;
    if (!OPEN_STATUSES.includes(previousStatus)) return null;
    const result = await db.query(
      `UPDATE commercial_proposals
       SET status = $2, ${spec.stamp} = now(), ${assignments.join(", ")}, updated_by = $3, updated_date = now()
       WHERE id = $1 AND status IN ('elaborando', 'enviada')
       RETURNING *`,
      params
    );
    const row = result.rows[0];
    if (!row) return null;
    await recordHistory(db, id, { eventType: targetStatus, previousValue: previousStatus, newValue: targetStatus, note, user });
    return row;
  });
}

export async function accept(id, body, file, user) {
  const before = await findById(id);
  assertOpen(before, "transition");
  const input = parseInput(acceptSchema, body, "Dados do aceite inválidos");
  const signedFile = validateSignedFile(file);

  // O arquivo é gravado antes da troca de situação para a linha nunca apontar
  // para um arquivo que não existe; se a troca não acontecer, ele é removido.
  const stored = signedFile ? await saveProposalFile(before.id, "assinado", signedFile.buffer) : null;
  let row;
  try {
    row = await closeProposal(before.id, "aceita", {
      accepted_by_email: user?.email || null,
      accepted_by_name: user?.full_name || null,
      data_assinatura: input.data_assinatura,
      nome_assinante: input.nome_assinante,
      cargo_assinante: input.cargo_assinante || null,
      canal_aceite: input.canal_aceite,
      observacao_aceite: input.observacao_aceite || null,
      arquivo_assinado_chave: stored?.key || null,
      arquivo_assinado_nome: stored ? safeOriginalName(signedFile.originalname, `Proposta-${before.numero}-assinada.pdf`) : null,
      arquivo_assinado_tamanho: stored?.size ?? null,
    }, user);
  } catch (error) {
    await removeProposalFile(stored?.key);
    throw error;
  }
  if (!row) {
    await removeProposalFile(stored?.key);
    throw closedError((await findById(id)).status, "transition");
  }
  return { before: presentProposal(before), proposal: presentProposal(row) };
}

export async function reject(id, body, user) {
  const before = await findById(id);
  assertOpen(before, "transition");
  const input = parseInput(rejectSchema, body, "Dados da recusa inválidos");
  const row = await closeProposal(before.id, "recusada", {
    rejected_by_email: user?.email || null,
    rejected_by_name: user?.full_name || null,
    motivo_recusa: input.motivo_recusa,
  }, user, input.motivo_recusa);
  if (!row) throw closedError((await findById(id)).status, "transition");
  return { before: presentProposal(before), proposal: presentProposal(row) };
}

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------

export async function listHistory(id) {
  await findById(id);
  const result = await pool.query(
    `SELECT h.id, h.event_type, h.previous_value, h.new_value, h.note, h.actor, h.actor_name, h.send_id,
            CASE WHEN h.send_id IS NULL THEN NULL ELSE s.file_key IS NOT NULL END AS send_has_file,
            h.occurred_at
     FROM commercial_proposal_history h
     LEFT JOIN commercial_proposal_sends s ON s.id = h.send_id
     WHERE h.proposal_id = $1
     ORDER BY h.occurred_at DESC, h.id DESC`,
    [id]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Resumo para a diretoria
// ---------------------------------------------------------------------------

const SUMMARY_TIME_ZONE = "America/Sao_Paulo";

function currentMonthInSaoPaulo() {
  const [year, month] = SAO_PAULO_TODAY().split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { de: `${year}-${pad(month)}-01`, ate: `${year}-${pad(month)}-${pad(lastDay)}` };
}

const periodDate = (label) => z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string({ invalid_type_error: `Data ${label} inválida` })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Data ${label} inválida. Use o formato AAAA-MM-DD`)
    .refine(isRealDate, `Data ${label} inválida`)
    .optional()
);

const summarySchema = z.object({ de: periodDate("inicial"), ate: periodDate("final") });

// Período em dias de calendário de São Paulo, com as duas pontas incluídas:
// de 00:00 do primeiro dia até antes de 00:00 do dia seguinte ao último.
// "Em aberto" é a foto de agora (elaborando + enviada), não um recorte do
// período: é a carteira que ainda depende de retorno do cliente.
export async function summary(query = {}) {
  const input = parseInput(summarySchema, query, "Período inválido");
  const defaults = currentMonthInSaoPaulo();
  const de = input.de || defaults.de;
  const ate = input.ate || defaults.ate;
  if (de > ate) throw httpError(400, "A data inicial não pode ser depois da data final", "VALIDATION");

  const result = await pool.query(
    `WITH bounds AS (
       SELECT ($1::date)::timestamp AT TIME ZONE $3 AS starts_at,
              ($2::date + 1)::timestamp AT TIME ZONE $3 AS ends_at
     )
     SELECT
       count(*) FILTER (WHERE p.status = 'elaborando')::int AS elaborando,
       count(*) FILTER (WHERE p.status = 'enviada')::int AS enviada,
       count(*) FILTER (WHERE p.status = 'aceita' AND p.accepted_at >= b.starts_at AND p.accepted_at < b.ends_at)::int AS aceitas,
       count(*) FILTER (WHERE p.status = 'recusada' AND p.rejected_at >= b.starts_at AND p.rejected_at < b.ends_at)::int AS recusadas,
       COALESCE(SUM(p.valor_mensalidade) FILTER (
         WHERE p.status = 'aceita' AND p.accepted_at >= b.starts_at AND p.accepted_at < b.ends_at
       ), 0)::numeric(16,2) AS valor_mensalidade_aceitas,
       COALESCE(SUM(p.valor_implantacao) FILTER (
         WHERE p.status = 'aceita' AND p.accepted_at >= b.starts_at AND p.accepted_at < b.ends_at
       ), 0)::numeric(16,2) AS valor_implantacao_aceitas
     FROM bounds b
     LEFT JOIN commercial_proposals p ON true
     GROUP BY b.starts_at, b.ends_at`,
    [de, ate, SUMMARY_TIME_ZONE]
  );
  const row = result.rows[0];
  return {
    periodo: { de, ate, fuso: SUMMARY_TIME_ZONE },
    em_aberto: row.elaborando + row.enviada,
    em_aberto_por_situacao: { elaborando: row.elaborando, enviada: row.enviada },
    aceitas: row.aceitas,
    recusadas: row.recusadas,
    // NUMERIC chega do pg como texto e segue assim: sem passar por float.
    valor_mensalidade_aceitas: row.valor_mensalidade_aceitas,
    valor_implantacao_aceitas: row.valor_implantacao_aceitas,
  };
}

// ---------------------------------------------------------------------------
// Download dos PDFs guardados
// ---------------------------------------------------------------------------

async function storedFile(key, fileName, missingMessage) {
  if (!key) throw httpError(404, missingMessage, "FILE_NOT_FOUND");
  if (!(await proposalFileExists(key))) {
    throw httpError(404, "O arquivo não foi encontrado no servidor. Fale com o suporte.", "FILE_NOT_FOUND");
  }
  return { path: resolveProposalFile(key), fileName };
}

export async function getSignedFile(id) {
  const proposal = await findById(id);
  return storedFile(
    proposal.arquivo_assinado_chave,
    proposal.arquivo_assinado_nome || `Proposta-${proposal.numero}-assinada.pdf`,
    "Esta proposta não tem arquivo assinado"
  );
}

export async function getSentFile(id, sendId) {
  await findById(id);
  if (!UUID_PATTERN.test(String(sendId || ""))) throw httpError(404, "Envio não encontrado", "NOT_FOUND");
  const result = await pool.query(
    "SELECT file_key, file_name FROM commercial_proposal_sends WHERE id = $1 AND proposal_id = $2",
    [sendId, id]
  );
  const send = result.rows[0];
  if (!send) throw httpError(404, "Envio não encontrado", "NOT_FOUND");
  return storedFile(send.file_key, send.file_name, "O PDF deste envio não foi guardado");
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
const PDF_NOT_STORED_MESSAGE = "Não foi possível guardar o PDF da proposta, e por isso o e-mail não foi enviado. Tente novamente em alguns minutos.";
const SENT_BUT_NOT_RECORDED_MESSAGE = "O e-mail foi enviado, mas não conseguimos registrar o envio no histórico. Não é preciso reenviar.";

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

// Colunas do envio devolvidas na resposta do send-email: o caminho do PDF no
// disco fica de fora, só se diz se há PDF guardado para baixar.
const SEND_COLUMNS = `id, proposal_id, recipient_email, recipient_name, sent_by_email, sent_by_name, message, file_name,
            result, error_detail, created_date, (file_key IS NOT NULL) AS has_file, file_size`;

// Envio e seu evento na linha do tempo gravam juntos, ou nenhum dos dois.
async function recordSend(record) {
  return inTransaction(async (db) => {
    const send = await insertSend(db, record);
    await recordHistory(db, record.proposalId, {
      eventType: record.result === "enviado" ? "email_enviado" : "email_falhou",
      note: record.to,
      user: record.user,
      sendId: send.id,
    });
    return send;
  });
}

async function insertSend(db, { proposalId, to, nomeDestinatario, user, mensagem, nomeArquivo, result, errorDetail, stored }) {
  const inserted = await db.query(
    `INSERT INTO commercial_proposal_sends
       (proposal_id, recipient_email, recipient_name, sent_by_email, sent_by_name, message, file_name, result, error_detail,
        file_key, file_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${SEND_COLUMNS}`,
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
      stored?.key || null,
      stored?.size ?? null,
    ]
  );
  return inserted.rows[0];
}

export async function sendByEmail(id, body, user) {
  const input = parseSendEmailInput(body);
  const proposal = await findById(id);
  assertOpen(proposal, "send");
  const clienteNome = String(proposal.client_name || "").trim();
  if (!clienteNome) {
    throw httpError(422, "Informe o nome do cliente na proposta antes de enviá-la por e-mail", "PROPOSAL_INCOMPLETE");
  }

  // O PDF é guardado antes de sair: e-mail enviado sem a cópia do que foi
  // anexado deixaria o histórico sem prova do documento entregue.
  let stored;
  try {
    stored = await saveProposalFile(proposal.id, "enviado", Buffer.from(input.pdfBase64, "base64"));
  } catch (error) {
    logger.error({ err: error, proposalId: proposal.id }, "falha ao guardar o PDF da proposta antes do envio");
    const err = httpError(500, PDF_NOT_STORED_MESSAGE, "PDF_NOT_STORED");
    err.expose = true;
    throw err;
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
    // Nada chegou ao cliente: a cópia não prova envio nenhum e sai do disco.
    await removeProposalFile(stored.key);
    try {
      await recordSend({ ...record, result: "falhou", errorDetail: outcome.error || "falha desconhecida" });
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
    send = await recordSend({ ...record, result: "enviado", stored });
  } catch (error) {
    // A cópia fica no disco: é o único registro do que foi anexado.
    logger.error({ err: error, proposalId: proposal.id, fileKey: stored.key }, "e-mail da proposta enviado, mas o registro do envio falhou");
  }

  let current = presentProposal(proposal);
  let statusError = null;
  try {
    const updated = await pool.query(
      `UPDATE commercial_proposals
       SET status = 'enviada', updated_date = now(), updated_by = $2
       WHERE id = $1 AND status = 'elaborando'
       RETURNING *`,
      [proposal.id, user?.email || null]
    );
    if (updated.rows[0]) current = presentProposal(updated.rows[0]);
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
