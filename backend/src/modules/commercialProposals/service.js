import { pool } from "../../db/pool.js";
import { generateCode } from "../integrations/crypto.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
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

export async function getById(id) {
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
