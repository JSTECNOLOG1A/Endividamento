// Pré-implantação: empresa aguardando a implantação de saldos (marco zero).
// Enquanto company_entities.implantacao_pendente = true: contratos aprovados não geram títulos, nada é integrado ao
// ERP e o fechamento contábil automático não roda. A chave desliga ao aplicar a implantação.
import { pool } from "../../db/pool.js";

export const PRE_IMPLANTACAO_MESSAGE = "Empresa aguardando a implantação de saldos";

export async function isAwaitingImplantation(entityId) {
  if (!entityId) return false;
  const found = await pool.query(`SELECT implantacao_pendente FROM company_entities WHERE id = $1`, [entityId]);
  return found.rows[0]?.implantacao_pendente === true;
}

/** Ids das empresas do grupo que ainda aguardam a implantação. */
export async function awaitingEntityIds(groupId) {
  const rows = (await pool.query(`SELECT id FROM company_entities WHERE group_id = $1 AND implantacao_pendente = true`, [groupId])).rows;
  return new Set(rows.map((r) => r.id));
}
