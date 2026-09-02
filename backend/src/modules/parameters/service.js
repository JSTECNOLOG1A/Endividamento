import { pool } from "../../db/pool.js";
import { getTenantScope, groupIdOrThrow } from "../tenants/access.js";
import { assertParameterAdmin } from "../tenants/policy.js";
import { getDefinition, listDefinitions, listCategories } from "./definitions.js";
import { cacheKey, getCached, invalidateParameterCache, setCached } from "./cache.js";

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function actorEmail() {
  return getTenantScope()?.email || "system";
}

function actorUserId() {
  return getTenantScope()?.userId || null;
}

function parseStoredValue(valueJson) {
  if (valueJson == null) return null;
  if (typeof valueJson === "object" && valueJson !== null && "v" in valueJson) {
    return valueJson.v;
  }
  return valueJson;
}

function toStoredValue(value) {
  return { v: value };
}

export function validateParameterValue(definition, value) {
  if (!definition) {
    throw httpError(404, "Parâmetro desconhecido", "PARAMETER_NOT_FOUND");
  }
  const { type, allowedValues } = definition;

  switch (type) {
    case "BOOLEAN":
      if (typeof value !== "boolean") {
        throw httpError(400, "Valor booleano inválido", "INVALID_PARAMETER_VALUE");
      }
      break;
    case "INTEGER":
      if (!Number.isInteger(value)) {
        throw httpError(400, "Valor inteiro inválido", "INVALID_PARAMETER_VALUE");
      }
      break;
    case "DECIMAL":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw httpError(400, "Valor decimal inválido", "INVALID_PARAMETER_VALUE");
      }
      break;
    case "STRING":
      if (typeof value !== "string") {
        throw httpError(400, "Valor texto inválido", "INVALID_PARAMETER_VALUE");
      }
      break;
    case "ENUM":
      if (typeof value !== "string" || !allowedValues?.includes(value)) {
        throw httpError(400, "Valor não permitido para este parâmetro", "INVALID_PARAMETER_VALUE");
      }
      break;
    case "JSON":
      if (value === undefined) {
        throw httpError(400, "JSON inválido", "INVALID_PARAMETER_VALUE");
      }
      break;
    case "DATE":
    case "TIME":
      if (typeof value !== "string" || !value.trim()) {
        throw httpError(400, "Data/hora inválida", "INVALID_PARAMETER_VALUE");
      }
      break;
    default:
      throw httpError(500, `Tipo de parâmetro não suportado: ${type}`, "PARAMETER_TYPE");
  }
  return value;
}

async function fetchScopedValue(scope, { groupId, userId, key }) {
  let query;
  let params;
  if (scope === "GLOBAL") {
    query = `SELECT value_json FROM system_parameters
             WHERE scope = 'GLOBAL' AND param_key = $1 AND group_id IS NULL AND user_id IS NULL
             LIMIT 1`;
    params = [key];
  } else if (scope === "TENANT") {
    query = `SELECT value_json FROM system_parameters
             WHERE scope = 'TENANT' AND group_id = $1 AND param_key = $2 AND user_id IS NULL
             LIMIT 1`;
    params = [groupId, key];
  } else if (scope === "USER") {
    query = `SELECT value_json FROM system_parameters
             WHERE scope = 'USER' AND group_id = $1 AND user_id = $2 AND param_key = $3
             LIMIT 1`;
    params = [groupId, userId, key];
  } else {
    return null;
  }
  const result = await pool.query(query, params);
  if (!result.rows[0]) return null;
  return parseStoredValue(result.rows[0].value_json);
}

export async function getGlobalParameter(key) {
  const ck = cacheKey({ groupId: null, userId: null, key, scope: "GLOBAL" });
  const cached = getCached(ck);
  if (cached !== undefined) return cached;
  const value = await fetchScopedValue("GLOBAL", { key });
  setCached(ck, value);
  return value;
}

export async function getTenantParameter(key, groupId = groupIdOrThrow()) {
  const ck = cacheKey({ groupId, userId: null, key, scope: "TENANT" });
  const cached = getCached(ck);
  if (cached !== undefined) return cached;
  const value = await fetchScopedValue("TENANT", { groupId, key });
  setCached(ck, value);
  return value;
}

export async function getUserParameter(key, { groupId = groupIdOrThrow(), userId = actorUserId() } = {}) {
  if (!userId) return null;
  const ck = cacheKey({ groupId, userId, key, scope: "USER" });
  const cached = getCached(ck);
  if (cached !== undefined) return cached;
  const value = await fetchScopedValue("USER", { groupId, userId, key });
  setCached(ck, value);
  return value;
}

/**
 * Precedência: USER → TENANT → GLOBAL → default do catálogo.
 */
export async function resolveParameter(key, { groupId, userId } = {}) {
  const definition = getDefinition(key);
  if (!definition) {
    if (key === "appearance.default_layout") return "classic";
    return null;
  }

  const gid = groupId ?? (() => {
    try { return groupIdOrThrow(); } catch { return null; }
  })();
  const uid = userId ?? actorUserId();

  const ck = cacheKey({ groupId: gid, userId: uid, key, scope: "resolve" });
  const cached = getCached(ck);
  if (cached !== undefined) return cached;

  let resolved = definition.defaultValue;

  try {
    const globalVal = await getGlobalParameter(key);
    if (globalVal !== null && globalVal !== undefined) resolved = globalVal;
  } catch {
    // tabela indisponível — fallback abaixo
  }

  if (gid) {
    try {
      const tenantVal = await getTenantParameter(key, gid);
      if (tenantVal !== null && tenantVal !== undefined) resolved = tenantVal;
    } catch {
      // ignore
    }
  }

  if (gid && uid) {
    try {
      const userVal = await getUserParameter(key, { groupId: gid, userId: uid });
      if (userVal !== null && userVal !== undefined) resolved = userVal;
    } catch {
      // ignore
    }
  }

  if (resolved == null && key === "appearance.default_layout") {
    resolved = "classic";
  }

  setCached(ck, resolved);
  return resolved;
}

export async function getParameter(key) {
  return resolveParameter(key);
}

async function upsertParameter(scope, { groupId, userId, key, value }) {
  const stored = JSON.stringify(toStoredValue(value));
  const email = actorEmail();

  if (scope === "GLOBAL") {
    const updated = await pool.query(
      `UPDATE system_parameters
       SET value_json = $2::jsonb, updated_date = now(), updated_by = $3
       WHERE scope = 'GLOBAL' AND param_key = $1 AND group_id IS NULL AND user_id IS NULL
       RETURNING id`,
      [key, stored, email]
    );
    if (!updated.rows[0]) {
      await pool.query(
        `INSERT INTO system_parameters (scope, group_id, user_id, param_key, value_json, updated_by)
         VALUES ('GLOBAL', NULL, NULL, $1, $2::jsonb, $3)`,
        [key, stored, email]
      );
    }
    return;
  }

  if (scope === "TENANT") {
    const updated = await pool.query(
      `UPDATE system_parameters
       SET value_json = $3::jsonb, updated_date = now(), updated_by = $4
       WHERE scope = 'TENANT' AND group_id = $1 AND param_key = $2 AND user_id IS NULL
       RETURNING id`,
      [groupId, key, stored, email]
    );
    if (!updated.rows[0]) {
      await pool.query(
        `INSERT INTO system_parameters (scope, group_id, user_id, param_key, value_json, updated_by)
         VALUES ('TENANT', $1, NULL, $2, $3::jsonb, $4)`,
        [groupId, key, stored, email]
      );
    }
    return;
  }

  const updated = await pool.query(
    `UPDATE system_parameters
     SET value_json = $4::jsonb, updated_date = now(), updated_by = $5
     WHERE scope = 'USER' AND group_id = $1 AND user_id = $2 AND param_key = $3
     RETURNING id`,
    [groupId, userId, key, stored, email]
  );
  if (!updated.rows[0]) {
    await pool.query(
      `INSERT INTO system_parameters (scope, group_id, user_id, param_key, value_json, updated_by)
       VALUES ('USER', $1, $2, $3, $4::jsonb, $5)`,
      [groupId, userId, key, stored, email]
    );
  }
}

async function deleteParameter(scope, { groupId, userId, key }) {
  if (scope === "GLOBAL") {
    await pool.query(
      `DELETE FROM system_parameters
       WHERE scope = 'GLOBAL' AND param_key = $1 AND group_id IS NULL AND user_id IS NULL`,
      [key]
    );
    return;
  }
  if (scope === "TENANT") {
    await pool.query(
      `DELETE FROM system_parameters
       WHERE scope = 'TENANT' AND group_id = $1 AND param_key = $2 AND user_id IS NULL`,
      [groupId, key]
    );
    return;
  }
  await pool.query(
    `DELETE FROM system_parameters
     WHERE scope = 'USER' AND group_id = $1 AND user_id = $2 AND param_key = $3`,
    [groupId, userId, key]
  );
}

export async function setParameter(key, value, { scope = "TENANT" } = {}) {
  await assertParameterAdmin();
  const definition = getDefinition(key);
  if (!definition) throw httpError(404, "Parâmetro desconhecido", "PARAMETER_NOT_FOUND");
  if (definition.isEditable === false) {
    throw httpError(403, "Parâmetro não editável", "PARAMETER_READONLY");
  }
  if (!definition.writableScopes?.includes(scope)) {
    throw httpError(400, `Escopo ${scope} não permitido para este parâmetro`, "INVALID_SCOPE");
  }

  const validated = validateParameterValue(definition, value);
  const groupId = groupIdOrThrow();
  const userId = actorUserId();

  const oldValue = await resolveParameter(key, { groupId, userId });

  if (scope === "GLOBAL") {
    if (!getTenantScope()?.platformAdmin) {
      throw httpError(403, "Somente master pode alterar parâmetros globais", "PLATFORM_FORBIDDEN");
    }
    await upsertParameter("GLOBAL", { key, value: validated });
  } else if (scope === "TENANT") {
    await upsertParameter("TENANT", { groupId, key, value: validated });
  } else {
    if (!userId) throw httpError(400, "Usuário não identificado", "USER_REQUIRED");
    await upsertParameter("USER", { groupId, userId, key, value: validated });
  }

  invalidateParameterCache({ groupId, userId, key });

  return { key, scope, oldValue, newValue: validated, definition };
}

export async function resetParameter(key, { scope = "TENANT" } = {}) {
  await assertParameterAdmin();
  const definition = getDefinition(key);
  if (!definition) throw httpError(404, "Parâmetro desconhecido", "PARAMETER_NOT_FOUND");

  const groupId = groupIdOrThrow();
  const userId = actorUserId();
  const oldValue = await resolveParameter(key, { groupId, userId });

  if (scope === "GLOBAL") {
    if (!getTenantScope()?.platformAdmin) {
      throw httpError(403, "Somente master pode resetar parâmetros globais", "PLATFORM_FORBIDDEN");
    }
    await deleteParameter("GLOBAL", { key });
  } else if (scope === "TENANT") {
    await deleteParameter("TENANT", { groupId, key });
  } else {
    if (!userId) throw httpError(400, "Usuário não identificado", "USER_REQUIRED");
    await deleteParameter("USER", { groupId, userId, key });
  }

  invalidateParameterCache({ groupId, userId, key });

  const newValue = await resolveParameter(key, { groupId, userId });
  return { key, scope, oldValue, newValue, definition };
}

export async function listParametersForTenant({ category, search, implementedOnly = true } = {}) {
  const groupId = groupIdOrThrow();
  const userId = actorUserId();
  const definitions = listDefinitions({ implementedOnly }).filter((def) => {
    if (category && category !== "all" && def.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return def.label.toLowerCase().includes(q)
        || def.key.toLowerCase().includes(q)
        || def.description.toLowerCase().includes(q);
    }
    return true;
  });

  const items = [];
  for (const def of definitions) {
    const resolved = await resolveParameter(def.key, { groupId, userId });
    const tenantOverride = await getTenantParameter(def.key, groupId);
    const userOverride = userId ? await getUserParameter(def.key, { groupId, userId }) : null;
    items.push({
      key: def.key,
      category: def.category,
      type: def.type,
      label: def.label,
      description: def.description,
      defaultValue: def.defaultValue,
      allowedValues: def.allowedValues || null,
      isEditable: def.isEditable !== false,
      value: resolved,
      tenantValue: tenantOverride,
      userValue: userOverride,
      source: userOverride != null ? "USER" : (tenantOverride != null ? "TENANT" : "DEFAULT"),
    });
  }
  return items;
}

export function getCategories() {
  return listCategories();
}

export async function getParameterDetail(key) {
  const definition = getDefinition(key);
  if (!definition || definition.implemented === false) {
    throw httpError(404, "Parâmetro não encontrado", "PARAMETER_NOT_FOUND");
  }
  let groupId = null;
  let userId = actorUserId();
  try {
    groupId = groupIdOrThrow();
  } catch (error) {
    if (!getTenantScope()?.platformAdmin) throw error;
    userId = null;
  }
  const value = await resolveParameter(key, { groupId, userId });
  return {
    key,
    definition,
    value,
    tenantValue: groupId ? await getTenantParameter(key, groupId) : null,
    userValue: groupId && userId ? await getUserParameter(key, { groupId, userId }) : null,
  };
}
