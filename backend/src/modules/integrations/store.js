import { pool } from "../../db/pool.js";
import { groupIdOrNull, groupIdOrThrow, isPlatformAdmin, scopedGroupSql } from "../tenants/access.js";

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

function toPublic(row, endpoints = []) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    nome: row.nome,
    descricao: row.descricao,
    erpNome: row.erp_nome,
    baseUrl: row.base_url,
    authType: row.auth_type,
    authHeader: row.auth_header,
    username: row.username,
    timeoutSeconds: row.timeout_seconds,
    grupoEmpresas: row.grupo_empresas,
    empresa: row.empresa,
    filial: row.filial,
    status: row.status,
    hasCredential: Boolean(row.has_credential ?? row.credential_encrypted),
    endpointsCount: Number(row.endpoints_count ?? endpoints.length),
    createdAt: row.created_date,
    updatedAt: row.updated_date,
    createdBy: row.created_by,
    endpoints: endpoints.map((endpoint) => ({
      id: endpoint.id,
      nome: endpoint.nome,
      metodo: endpoint.metodo,
      path: endpoint.path,
      cadastroKey: endpoint.cadastro_key,
      sortOrder: endpoint.sort_order,
    })),
  };
}

const LIST_SELECT = `
  SELECT i.*,
    (i.credential_encrypted IS NOT NULL) AS has_credential,
    (SELECT COUNT(*)::int FROM integration_endpoints e WHERE e.integration_id = i.id) AS endpoints_count
  FROM integrations i
`;

export async function list({ search, status, page = 1, limit = 10 }) {
  const scope = scopedGroupSql("i.group_id");
  const where = [scope.sql];
  const params = [...scope.params];
  let i = params.length + 1;
  if (search) {
    where.push(`(i.nome ILIKE $${i} OR COALESCE(i.erp_nome, '') ILIKE $${i} OR i.base_url ILIKE $${i})`);
    params.push(`%${search}%`);
    i += 1;
  }
  if (status === "ativo" || status === "inativo") {
    where.push(`i.status = $${i}`);
    params.push(status);
    i += 1;
  }
  const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const count = await pool.query(
    `SELECT COUNT(*)::int AS n FROM integrations i ${sqlWhere}`,
    params
  );
  const result = await pool.query(
    `${LIST_SELECT} ${sqlWhere} ORDER BY i.created_date DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...params, safeLimit, offset]
  );

  return {
    data: result.rows.map((row) => toPublic(row)),
    pagination: {
      total: count.rows[0].n,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(count.rows[0].n / safeLimit)),
    },
  };
}

function scopedByCode(code) {
  const scope = scopedGroupSql("i.group_id", 2);
  return {
    sql: `${LIST_SELECT} WHERE i.code = $1 AND ${scope.sql}`,
    params: [code, ...scope.params],
  };
}

function scopedById(id) {
  const scope = scopedGroupSql("i.group_id", 2);
  return {
    sql: `${LIST_SELECT} WHERE i.id = $1 AND ${scope.sql}`,
    params: [id, ...scope.params],
  };
}

function groupIdForRow(existing) {
  const scoped = groupIdOrNull();
  if (scoped) {
    if (existing?.group_id && existing.group_id !== scoped) {
      throw httpError(404, "Conexão não encontrada");
    }
    return scoped;
  }
  if (isPlatformAdmin() && existing?.group_id) return existing.group_id;
  return groupIdOrThrow();
}

export async function findByCode(code) {
  const query = scopedByCode(code);
  const result = await pool.query(query.sql, query.params);
  return result.rows[0] || null;
}

export async function findById(id) {
  const query = scopedById(id);
  const result = await pool.query(query.sql, query.params);
  return result.rows[0] || null;
}

export async function findEndpoints(integrationId) {
  const result = await pool.query(
    `SELECT * FROM integration_endpoints WHERE integration_id = $1 ORDER BY sort_order ASC, created_date ASC`,
    [integrationId]
  );
  return result.rows;
}

export async function findCredential(id) {
  const existing = await findById(id);
  if (!existing) return null;
  const result = await pool.query(
    `SELECT id, credential_encrypted FROM integrations WHERE id = $1 AND group_id = $2`,
    [id, groupIdForRow(existing)]
  );
  return result.rows[0] || null;
}

export async function findByCadastroKeyAndMetodo(cadastroKey, metodo, excludeIntegrationId) {
  const params = [cadastroKey, metodo, groupIdOrThrow()];
  let sql = `
    SELECT e.nome, e.metodo, e.cadastro_key, i.nome AS integration_nome
    FROM integration_endpoints e
    JOIN integrations i ON i.id = e.integration_id
    WHERE e.cadastro_key = $1 AND e.metodo = $2 AND i.group_id = $3
  `;
  if (excludeIntegrationId) {
    params.push(excludeIntegrationId);
    sql += ` AND e.integration_id <> $4`;
  }
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

export async function findLinkedCadastro(cadastroKey, metodo = "GET") {
  const result = await pool.query(
    `SELECT
       e.id AS endpoint_id,
       e.nome AS endpoint_nome,
       e.metodo,
       e.path,
       e.cadastro_key,
       i.id AS integration_id,
       i.nome,
       i.erp_nome,
       i.base_url,
       i.auth_type,
       i.auth_header,
       i.username,
       i.timeout_seconds,
       i.grupo_empresas,
       i.empresa,
       i.filial,
       i.status
     FROM integration_endpoints e
     JOIN integrations i ON i.id = e.integration_id
     WHERE e.cadastro_key = $1 AND e.metodo = $2 AND i.group_id = $3
     ORDER BY i.status ASC, e.sort_order ASC
     LIMIT 1`,
    [cadastroKey, metodo, groupIdOrThrow()]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    endpoint: {
      id: row.endpoint_id,
      nome: row.endpoint_nome,
      metodo: row.metodo,
      path: row.path,
      cadastroKey: row.cadastro_key,
    },
    integration: {
      id: row.integration_id,
      nome: row.nome,
      erpNome: row.erp_nome,
      baseUrl: row.base_url,
      authType: row.auth_type,
      authHeader: row.auth_header,
      username: row.username,
      timeoutSeconds: row.timeout_seconds,
      grupoEmpresas: row.grupo_empresas,
      empresa: row.empresa,
      filial: row.filial,
      status: row.status,
    },
  };
}

async function replaceEndpoints(client, integrationId, endpoints = []) {
  await client.query("DELETE FROM integration_endpoints WHERE integration_id = $1", [integrationId]);
  for (const [index, endpoint] of endpoints.entries()) {
    await client.query(
      `INSERT INTO integration_endpoints (integration_id, nome, metodo, path, cadastro_key, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        integrationId,
        endpoint.nome,
        endpoint.metodo,
        endpoint.path,
        endpoint.cadastroKey || null,
        index,
      ]
    );
  }
}

export async function create(row, endpoints, createdBy) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO integrations (
        code, nome, descricao, erp_nome, base_url, auth_type, auth_header, username,
        credential_encrypted, grupo_empresas, empresa, filial, timeout_seconds, status, created_by, group_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ativo',$14,$15)
      RETURNING *`,
      [
        row.code,
        row.nome,
        row.descricao,
        row.erpNome,
        row.baseUrl,
        row.authType,
        row.authHeader,
        row.username,
        row.credentialEncrypted,
        row.grupoEmpresas ?? "",
        row.empresa ?? "",
        row.filial ?? "",
        row.timeoutSeconds,
        createdBy,
        groupIdOrThrow(),
      ]
    );
    await replaceEndpoints(client, inserted.rows[0].id, endpoints);
    await client.query("COMMIT");
    const saved = await findById(inserted.rows[0].id);
    const savedEndpoints = await findEndpoints(saved.id);
    return toPublic(saved, savedEndpoints);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapDbError(error);
  } finally {
    client.release();
  }
}

export async function update(id, row, endpoints) {
  const assignments = [];
  const params = [];
  let i = 1;
  const map = {
    nome: row.nome,
    descricao: row.descricao,
    erp_nome: row.erpNome,
    base_url: row.baseUrl,
    auth_type: row.authType,
    auth_header: row.authHeader,
    username: row.username,
    credential_encrypted: row.credentialEncrypted,
    grupo_empresas: row.grupoEmpresas,
    empresa: row.empresa,
    filial: row.filial,
    timeout_seconds: row.timeoutSeconds,
    status: row.status,
  };
  for (const [column, value] of Object.entries(map)) {
    if (value === undefined) continue;
    assignments.push(`${column} = $${i++}`);
    params.push(value);
  }
  assignments.push("updated_date = now()");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await findById(id);
    if (!existing) throw httpError(404, "Conexão não encontrada");
    const groupId = groupIdForRow(existing);
    if (params.length > 0) {
      params.push(id, groupId);
      await client.query(
        `UPDATE integrations SET ${assignments.join(", ")} WHERE id = $${i} AND group_id = $${i + 1}`,
        params
      );
    }
    if (endpoints) {
      await replaceEndpoints(client, id, endpoints);
    }
    await client.query("COMMIT");
    const saved = await findById(id);
    if (!saved) throw httpError(404, "Conexão não encontrada");
    const savedEndpoints = await findEndpoints(id);
    return toPublic(saved, savedEndpoints);
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapDbError(error);
  } finally {
    client.release();
  }
}

export async function remove(id) {
  const existing = await findById(id);
  if (!existing) throw httpError(404, "Conexão não encontrada");
  await pool.query("DELETE FROM integrations WHERE id = $1 AND group_id = $2", [id, groupIdForRow(existing)]);
  return toPublic(existing);
}

function mapDbError(error) {
  if (error?.code === "23505") {
    return httpError(400, "Já existe um endpoint com este cadastro e método");
  }
  return error;
}

export { toPublic, httpError };
