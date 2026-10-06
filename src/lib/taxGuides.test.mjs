/**
 * Testes das regras de guia de pagamento das parcelas (node src/lib/taxGuides.test.mjs).
 */
import assert from "node:assert/strict";
import {
  amountComesFromGuide,
  amountToPay,
  canCorrectGuide,
  guideSendBlock,
  guideStatusKey,
  indexGuidesByInstallment,
  isEmailAddress,
  joinList,
  mergeRecipients,
  needsManualLine,
  openInstallmentsWithGuideException,
  showsAmountAsPayable,
  splitRecipients,
} from "./taxGuides.js";

const installment = { id: "p1", situacao: "em_aberto", valor: 1000, vencimento: "2026-10-20" };
const linked = { installment_id: "p1", situacao: "vinculada", motivos: [], valor_guia: 1234.56, valor_a_pagar: 1234.56 };
const linkedNoValue = { installment_id: "p1", situacao: "vinculada", motivos: [], valor_guia: null, valor_a_pagar: null };
const exception = {
  installment_id: "p1",
  situacao: "excecao",
  valor_guia: 1234.56,
  valor_a_pagar: null,
  linha_fonte: null,
  motivos: [{ codigo: "LINHA_NAO_LIDA", mensagem: "x" }],
};

// Valor para pagamento: o da guia OU o cadastrado — nunca somados.
assert.equal(amountToPay(installment, linked), 1234.56);
assert.equal(amountToPay(installment, linkedNoValue), 1000);
assert.equal(amountToPay(installment, exception), 1000, "guia em exceção não define o valor");
assert.equal(amountToPay(installment, null), 1000);
assert.equal(amountComesFromGuide(linked), true);
assert.equal(amountComesFromGuide(exception), false);
assert.equal(amountComesFromGuide(null), false);
assert.equal(showsAmountAsPayable(installment, linked), true);
assert.equal(showsAmountAsPayable(installment, linkedNoValue), false);
for (const situacao of ["paga_aguardando_reconhecimento", "reconhecida", "cancelada"]) {
  const closed = { ...installment, situacao };
  assert.equal(showsAmountAsPayable(closed, linked), false, `parcela ${situacao} não aparece como a pagar`);
  assert.equal(amountToPay(closed, linked), 1234.56, "um valor ou outro, nunca somados");
}

// Situação da guia; o desconhecido nunca vira "vinculada".
assert.equal(guideStatusKey(null), "sem_guia");
assert.equal(guideStatusKey(linked), "vinculada");
assert.equal(guideStatusKey(exception), "excecao");
assert.equal(guideStatusKey({ situacao: "qualquer" }), "excecao");

// Correção à mão: só quando a linha não veio do PDF.
assert.equal(needsManualLine(exception), true);
assert.equal(needsManualLine({ ...exception, linha_fonte: "pdf" }), false);
assert.equal(canCorrectGuide({ ...exception, motivos: [{ codigo: "CNPJ_DIFERENTE" }] }), false);
assert.equal(canCorrectGuide({ ...exception, linha_fonte: "pdf", motivos: [{ codigo: "PAGAR_ATE_FORA_DO_MES" }] }), true);

// Envio por e-mail bloqueado: sem guia, guia em exceção, parcela paga ou cancelada.
assert.equal(guideSendBlock(installment, linked).ok, true);
assert.equal(guideSendBlock(installment, null).ok, false);
assert.equal(guideSendBlock(installment, exception).ok, false);
for (const situacao of ["paga_aguardando_reconhecimento", "reconhecida", "cancelada"]) {
  assert.equal(guideSendBlock({ ...installment, situacao }, linked).ok, false, situacao);
}

// Parcelas em aberto com guia em exceção (pagas não entram), por vencimento.
const guides = indexGuidesByInstallment([
  { ...exception, installment_id: "a" },
  { ...exception, installment_id: "b" },
  { ...linked, installment_id: "c" },
  { ...exception, installment_id: "d" },
]);
const rows = [
  {
    installments: [
      { id: "a", situacao: "em_aberto", vencimento: "2026-12-10" },
      { id: "b", situacao: "paga_aguardando_reconhecimento", vencimento: "2026-09-10" },
      { id: "c", situacao: "em_aberto", vencimento: "2026-10-10" },
    ],
  },
  { installments: [{ id: "d", situacao: "em_aberto", vencimento: "2026-11-10" }] },
];
assert.deepEqual(openInstallmentsWithGuideException(rows, guides).map((item) => item.installment.id), ["d", "a"]);

// Destinatários.
assert.deepEqual(splitRecipients(" a@x.com, b@y.com;c@z.com\nd@w.com "), ["a@x.com", "b@y.com", "c@z.com", "d@w.com"]);
assert.deepEqual(mergeRecipients(["A@x.com"], ["a@x.com", "b@y.com"]), ["A@x.com", "b@y.com"]);
assert.equal(isEmailAddress("financeiro@empresa.com.br"), true);
assert.equal(isEmailAddress("financeiro@empresa"), false);
assert.equal(joinList(["a", "b", "c"]), "a, b e c");

console.log("taxGuides: ok");
