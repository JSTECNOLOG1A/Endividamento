import { createPdfStore } from "../../services/pdfStore.js";

// PDFs das guias das parcelas: pasta própria, chave "<id da guia>/guia-<uuid>.pdf". O nome original do arquivo
// fica só no banco, para o download.
export const guideFiles = createPdfStore({
  folder: "tax-guides",
  keyPattern: /^[0-9a-f-]{36}\/guia-[0-9a-f-]{36}\.pdf$/,
  label: "guia de tributo",
});

/**
 * Guias que saem junto com parcelas excluídas (cascata do banco). Chamar dentro da transação da exclusão, antes
 * do DELETE: os arquivos só podem ser apagados depois do COMMIT, e as guias de outras parcelas com o mesmo código
 * de barras precisam ser verificadas de novo (a duplicidade pode ter acabado).
 * Também conta o que sai (guias atuais, todas as guias, envios por e-mail) para a auditoria da exclusão.
 * @returns {Promise<{ groupId: string, fileKeys: string[], barcodes: string[], currentGuides: number, totalGuides: number, sends: number }>}
 */
export async function collectGuidesForDeletion(client, { groupId, installmentId = null, agreementId = null }) {
  // Trava as parcelas que vão sair: uma guia anexada a uma delas durante a exclusão espera, em vez de sair na
  // cascata sem ter o arquivo coletado.
  await client.query(
    `SELECT id FROM tax_installments WHERE group_id = $1 AND (id = $2 OR agreement_id = $3) FOR UPDATE`,
    [groupId, installmentId, agreementId]
  );
  const result = await client.query(
    `SELECT g.arquivo_chave, g.codigo_barras, g.encerrada_em
       FROM tax_installment_guides g
       JOIN tax_installments i ON i.id = g.installment_id
      WHERE g.group_id = $1 AND (i.id = $2 OR i.agreement_id = $3)`,
    [groupId, installmentId, agreementId]
  );
  const sends = await client.query(
    `SELECT count(*)::int AS total
       FROM tax_guide_sends s
       JOIN tax_installments i ON i.id = s.installment_id
      WHERE s.group_id = $1 AND (i.id = $2 OR i.agreement_id = $3)`,
    [groupId, installmentId, agreementId]
  );
  const fileKeys = result.rows.map((row) => row.arquivo_chave).filter(Boolean);
  const barcodes = [...new Set(result.rows.filter((row) => !row.encerrada_em && row.codigo_barras).map((row) => row.codigo_barras))];
  return {
    groupId,
    fileKeys,
    barcodes,
    currentGuides: result.rows.filter((row) => !row.encerrada_em).length,
    totalGuides: result.rows.length,
    sends: sends.rows[0].total,
  };
}
