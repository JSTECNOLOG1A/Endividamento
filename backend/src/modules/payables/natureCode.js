import { pool } from "../../db/pool.js";
import { entityMatchesNature } from "../natures/entityMatch.js";

function natureFitsEntity(nature, entity) {
  if (!nature || !entity) return false;
  if (nature.entity_id && nature.entity_id === entity.id) return true;
  return entityMatchesNature(entity, nature.empresa, nature.filial);
}

export async function resolveNatureForEntity(value, entity) {
  const text = String(value || "").trim();
  if (!text || !entity) return null;

  const result = await pool.query(
    `SELECT * FROM natures
     WHERE status = 'ativo'
       AND (
         codigo = $1
         OR upper(btrim(descricao)) = upper($1)
       )`,
    [text]
  );
  const fits = result.rows.filter((row) => natureFitsEntity(row, entity));
  const byCode = fits.find((row) => row.codigo === text);
  if (byCode) return byCode;
  if (fits.length === 1) return fits[0];
  return null;
}
