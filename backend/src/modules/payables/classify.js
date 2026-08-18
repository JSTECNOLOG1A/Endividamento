import { pool } from "../../db/pool.js";
import { resolveNatureForEntity } from "./natureCode.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function asIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))];
}

function padFornecedor(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits && digits === text.replace(/\s/g, "")) {
    return digits.padStart(6, "0").slice(-6);
  }
  return text;
}

export async function classifyPayableTitles(payload = {}) {
  const ids = asIdList(payload.ids);
  const tipo = String(payload.tipo || "").trim().toUpperCase();
  const natureza = String(payload.natureza || "").trim();
  const applyByType = payload.applyByType !== false;
  const fornecedor = payload.fornecedor !== undefined ? padFornecedor(payload.fornecedor) : undefined;
  const fornecedorLoja = payload.fornecedor_loja !== undefined
    ? String(payload.fornecedor_loja || "").trim() || "01"
    : undefined;
  const fornecedorNome = payload.fornecedor_nome !== undefined
    ? String(payload.fornecedor_nome || "").trim()
    : undefined;

  if (!tipo) throw httpError(400, "Informe o tipo do título");
  if (!natureza) throw httpError(400, "Informe a natureza");
  if (!applyByType && !ids.length) {
    throw httpError(400, "Selecione ao menos um título para classificar");
  }

  const selected = ids.length
    ? (await pool.query(`SELECT * FROM payable_titles WHERE id = ANY($1::text[])`, [ids])).rows
    : [];
  if (ids.length && selected.length !== ids.length) {
    throw httpError(400, "Um ou mais títulos selecionados não existem");
  }

  const entityId = String(payload.entity_id || selected[0]?.entity_id || "").trim();
  if (!entityId) throw httpError(400, "Informe a entidade dos títulos");

  if (selected.some((row) => row.entity_id !== entityId)) {
    throw httpError(400, "Classifique títulos da mesma entidade");
  }
  if (selected.some((row) => String(row.tipo || "").toUpperCase() !== tipo)) {
    throw httpError(400, "Os títulos selecionados não são deste tipo");
  }

  const entityResult = await pool.query(`SELECT * FROM company_entities WHERE id = $1`, [entityId]);
  const entity = entityResult.rows[0];
  if (!entity) throw httpError(400, "A entidade informada não existe");

  const nature = await resolveNatureForEntity(natureza, entity);
  if (!nature) {
    throw httpError(400, "Informe o código da natureza (ED_CODIGO), não a descrição");
  }
  if (String(nature.tipo_natureza || "").toLowerCase() === "sintetica") {
    throw httpError(400, "Use uma natureza analítica para classificar o título");
  }

  const params = [nature.codigo, entityId, tipo];
  const sets = ["natureza = $1", "updated_date = now()"];
  if (fornecedor !== undefined) {
    params.push(fornecedor);
    sets.push(`fornecedor = $${params.length}`);
  }
  if (fornecedorLoja !== undefined) {
    params.push(fornecedorLoja);
    sets.push(`fornecedor_loja = $${params.length}`);
  }
  if (fornecedorNome !== undefined) {
    params.push(fornecedorNome);
    sets.push(`fornecedor_nome = $${params.length}`);
  }

  let where = `entity_id = $2 AND upper(tipo) = $3 AND integrado_erp IS NOT TRUE AND COALESCE(erp_status, 'pendente') NOT IN ('integrado', 'baixado') AND status = 'aberto'`;
  if (!applyByType) {
    params.push(ids);
    where += ` AND id = ANY($${params.length}::text[])`;
  }

  const result = await pool.query(
    `UPDATE payable_titles SET ${sets.join(", ")} WHERE ${where} RETURNING id`,
    params
  );

  return {
    updated: result.rowCount,
    tipo,
    natureza: nature.codigo,
    applyByType,
    entity_id: entityId,
  };
}
