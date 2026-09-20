import { pool } from "../../db/pool.js";
import { logger } from "../../logger.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { actorEmail } from "../tenants/policy.js";
import { assertContractInTenant } from "../tenants/scope.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function loadTitle(id) {
  const groupId = groupIdOrThrow();
  const result = await pool.query(`SELECT * FROM payable_titles WHERE id = $1 AND group_id = $2`, [id, groupId]);
  if (!result.rows[0]) throw httpError(404, "Título não encontrado");
  return result.rows[0];
}

/**
 * Baixa manual de um título a pagar (Contas a Pagar): registra data e valor efetivamente pagos.
 * É uma das fontes de "baixa efetiva" do fechamento contábil (a outra é o retorno do ERP).
 * Aceita baixa parcial: o saldo do título cai e ele só vira "baixado" quando zera.
 */
export async function settlePayableTitleManually(payload = {}) {
  const { id, paymentDate, amountPaid } = payload;
  if (!id) throw httpError(400, "id do título é obrigatório");
  if (!ISO.test(String(paymentDate || ""))) throw httpError(400, "Informe a data do pagamento (AAAA-MM-DD)");

  const title = await loadTitle(id);
  if (title.erp_status === "baixado") throw httpError(409, "Título já baixado no ERP");
  if (title.status === "cancelado") throw httpError(409, "Título cancelado não pode ser baixado");
  if (title.status === "ignorado_implantacao") throw httpError(409, "Título tratado na implantação de saldos: não recebe baixa");
  const valor = r2(title.valor);
  const saldoAtual = r2(title.saldo);
  if (saldoAtual <= 0.009) throw httpError(409, "Título sem saldo em aberto");

  const paid = amountPaid === undefined || amountPaid === null || amountPaid === "" ? saldoAtual : r2(amountPaid);
  if (!(paid > 0)) throw httpError(400, "O valor pago deve ser maior que zero");
  if (paid - saldoAtual > 0.009) throw httpError(400, "O valor pago não pode passar do saldo em aberto");

  const novoSaldo = r2(saldoAtual - paid);
  const quitado = novoSaldo <= 0.009;
  await pool.query(
    `UPDATE payable_titles
        SET saldo = $1, status = $2, baixa_origem = 'manual', baixa_data = $3::date, baixa_por = $4, updated_date = now()
      WHERE id = $5 AND group_id = $6`,
    [quitado ? 0 : novoSaldo, quitado ? "baixado" : "aberto", paymentDate, actorEmail() || "sistema", id, groupIdOrThrow()]
  );
  logger.info({ titleId: id, paid, quitado }, "baixa manual de título a pagar");
  return { id, valor, pago: paid, saldo: quitado ? 0 : novoSaldo, status: quitado ? "baixado" : "aberto" };
}

/**
 * Desfaz uma baixa manual. Só vale para baixa de origem "manual" e enquanto não existir uma baixa de
 * contrato já derivada dela — nesse caso é preciso estornar a baixa no Fechamento Contábil.
 */
export async function undoManualPayableSettlement(payload = {}) {
  const { id } = payload;
  if (!id) throw httpError(400, "id do título é obrigatório");
  const title = await loadTitle(id);
  if (title.baixa_origem !== "manual") throw httpError(409, "Só baixas manuais podem ser desfeitas por aqui");
  if (title.contract_id) {
    await assertContractInTenant(title.contract_id);
    const used = await pool.query(
      `SELECT 1 FROM contract_settlements
        WHERE contract_id = $1 AND parcela = $2 AND group_id = $3 AND status <> 'estornado' LIMIT 1`,
      [title.contract_id, title.parcela, groupIdOrThrow()]
    );
    if (used.rows.length) {
      throw httpError(409, "Esta baixa já foi usada em um fechamento contábil. Estorne a baixa no Fechamento antes de desfazer.");
    }
  }
  await pool.query(
    `UPDATE payable_titles
        SET saldo = valor, status = 'aberto', baixa_origem = NULL, baixa_data = NULL, baixa_por = NULL, updated_date = now()
      WHERE id = $1 AND group_id = $2`,
    [id, groupIdOrThrow()]
  );
  return { id, status: "aberto" };
}
