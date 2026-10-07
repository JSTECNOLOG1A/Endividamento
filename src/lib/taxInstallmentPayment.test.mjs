/**
 * Testes do pagamento registrado pelo Protheus e da versão da parcela (node src/lib/taxInstallmentPayment.test.mjs).
 */
import assert from "node:assert/strict";
import {
  erpPaymentNote,
  isInstallmentConflict,
  isPaidByErp,
  undoesErpPayment,
  withInstallmentVersion,
} from "./taxInstallmentPayment.js";

const erpPaid = {
  id: "p1",
  situacao: "paga_aguardando_reconhecimento",
  data_pagamento: "2026-03-30",
  valor_pago: 999.99,
  pagamento_origem: "protheus",
  pagamento_registrado_em: "2026-04-02T12:00:00.000Z",
  updated_date: "2026-04-02T12:00:00.123Z",
};
const manualPaid = { ...erpPaid, pagamento_origem: null };

// Conflitos
assert.equal(isInstallmentConflict({ code: "TAX_INSTALLMENT_CHANGED" }), true);
assert.equal(isInstallmentConflict({ code: "TAX_INSTALLMENT_PAID_BY_ERP" }), true);
assert.equal(isInstallmentConflict({ code: "TAX_VALIDATION" }), false);
assert.equal(isInstallmentConflict(null), false);

// Versão
assert.deepEqual(withInstallmentVersion({ situacao: "reconhecida" }, erpPaid), { situacao: "reconhecida", updated_date: "2026-04-02T12:00:00.123Z" });
assert.deepEqual(withInstallmentVersion({ situacao: "reconhecida" }, {}), { situacao: "reconhecida" });

// Origem
assert.equal(isPaidByErp(erpPaid), true);
assert.equal(isPaidByErp(manualPaid), false);
assert.equal(erpPaymentNote(erpPaid), "Pagamento registrado pela baixa no Protheus em 30/03/2026");
assert.equal(erpPaymentNote({ ...erpPaid, data_pagamento: null }), "Pagamento registrado pela baixa no Protheus em 02/04/2026");
assert.equal(erpPaymentNote(manualPaid), null);

// Desfazer o pagamento do Protheus
assert.equal(undoesErpPayment(erpPaid, { situacao: "reconhecida", data_pagamento: "2026-03-30", valor_pago: 999.99 }), false, "confirmar reconhecimento não desfaz");
assert.equal(undoesErpPayment(erpPaid, { situacao: "em_aberto", data_pagamento: null, valor_pago: null }), true, "reabrir desfaz");
assert.equal(undoesErpPayment(erpPaid, { situacao: "cancelada" }), true, "cancelar desfaz");
assert.equal(undoesErpPayment(erpPaid, { situacao: "paga_aguardando_reconhecimento", data_pagamento: "2026-03-31", valor_pago: 999.99 }), true, "outra data");
assert.equal(undoesErpPayment(erpPaid, { situacao: "paga_aguardando_reconhecimento", data_pagamento: "2026-03-30", valor_pago: "999.990" }), false, "mesmo valor em centavos");
assert.equal(undoesErpPayment(erpPaid, { situacao: "paga_aguardando_reconhecimento", data_pagamento: "2026-03-30", valor_pago: 1000 }), true, "outro valor");
assert.equal(undoesErpPayment(manualPaid, { situacao: "em_aberto" }), false, "pagamento manual segue livre");

console.log("taxInstallmentPayment: ok");
