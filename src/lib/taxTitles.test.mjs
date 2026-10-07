/**
 * Testes das regras de tela do título de tributo (node src/lib/taxTitles.test.mjs).
 */
import assert from "node:assert/strict";
import {
  deletionBlockReasons,
  filterTaxTitles,
  formatPaymentLine,
  isTaxTitleForecast,
  taxTitlesConsultOutcome,
  taxTitleActionOutcome,
  taxTitleKey,
  taxTitleLink,
  taxTitleNeedsAttention,
  taxTitleNotes,
  taxTitleOrigin,
  taxTitleSituationOptions,
  taxTitleStatusLabel,
  taxTitleTone,
  taxTitleTotals,
} from "./taxTitles.js";

const base = {
  id: "t1",
  entity_id: "e1",
  entity_name: "Agro Alfa",
  codigo_parcelamento: "123456",
  orgao: "Receita Federal",
  numero_parcela: 4,
  prefixo: "TRB",
  numero: "000000123",
  parcela: "01",
  valor: 1500.5,
  saldo: 1500.5,
  situacao: "enviado",
  situacao_label: "Integrado",
  motivo: null,
  erp_mensagem: null,
};

// Link
assert.equal(taxTitleLink("abc 1"), "/AccountsPayable?tributo=abc+1");

// Selo
assert.equal(taxTitleTone(base), "success");
assert.equal(taxTitleTone({ situacao: "recusado" }), "danger");
assert.equal(taxTitleTone({ situacao: "algo_novo" }), "neutral");
assert.equal(taxTitleStatusLabel({ situacao: "algo_novo" }), "Situação não informada", "nunca mostra o valor interno");
assert.equal(taxTitleNeedsAttention({ situacao: "incerto" }), true);
assert.equal(taxTitleNeedsAttention(base), false);

// Identificação
assert.equal(taxTitleOrigin(base), "Parcelamento nº 123456 · Receita Federal · parcela 4");
assert.equal(taxTitleKey(base), "TRB 000000123/01");
assert.equal(taxTitleKey({ numero: "000000123", prefixo: null, parcela: "01" }), "", "sem prefixo ainda não há título no Protheus");
assert.equal(taxTitleKey({ numero: "000000123", prefixo: "TRB", parcela: "" }), "TRB 000000123");
assert.equal(taxTitleKey({}), "");

// Linha digitável
const arrecadacao = "858000000012345603282026123456789012345678901234";
assert.equal(formatPaymentLine(arrecadacao), "85800000001-2 34560328202-6 12345678901-2 34567890123-4");
const boleto = "23793381286000000001234567890123456789012345678";
assert.equal(formatPaymentLine(boleto), "23793.38128 60000.000012 34567.890123 4 56789012345678");
assert.equal(formatPaymentLine("123"), "123");
assert.equal(formatPaymentLine(null), "");

// Textos de apoio
assert.deepEqual(taxTitleNotes({ motivo: "A", erp_mensagem: "A" }), { motivo: "A", erpMensagem: null });
assert.deepEqual(taxTitleNotes({ motivo: " ", erp_mensagem: "Recusado: natureza" }), { motivo: null, erpMensagem: "Recusado: natureza" });

// Filtros
const other = { ...base, id: "t2", entity_id: "e2", entity_name: "Beta", codigo_parcelamento: "999", situacao: "pendente", situacao_label: "Pendente" };
assert.deepEqual(filterTaxTitles([base, other], { entityId: "e2" }).map((t) => t.id), ["t2"]);
assert.deepEqual(filterTaxTitles([base, other], { situacao: "enviado" }).map((t) => t.id), ["t1"]);
assert.deepEqual(filterTaxTitles([base, other], { term: "receita" }).map((t) => t.id), ["t1", "t2"]);
assert.deepEqual(filterTaxTitles([base, other], { term: "123456" }).map((t) => t.id), ["t1"]);
assert.deepEqual(filterTaxTitles([base, other], { term: "tributo" }).length, 2, "a palavra Tributo acha todos");
assert.deepEqual(taxTitleSituationOptions([base, other, { ...base, id: "t3" }]), [
  { value: "enviado", label: "Integrado" },
  { value: "pendente", label: "Pendente" },
]);

// Totais
assert.deepEqual(taxTitleTotals([base, { ...other, valor: "10", saldo: null }]), { valor: 1510.5, saldo: 1500.5 });

// Recado depois da ação
assert.equal(taxTitleActionOutcome(base).type, "success");
assert.deepEqual(taxTitleActionOutcome({ situacao: "recusado", situacao_label: "Recusado pelo Protheus", erp_mensagem: "Natureza inválida" }), {
  type: "warning",
  message: "O Protheus recusou o título de tributo.",
  description: "Natureza inválida",
});
assert.equal(taxTitleActionOutcome({ situacao: "pendente", motivo: "Informe o tipo" }).description, "Informe o tipo");
assert.equal(taxTitleActionOutcome({ situacao: "parcial", situacao_label: "Baixado parcialmente" }).message, "Título de tributo consultado: baixado parcialmente no Protheus.");

// Exclusão barrada
assert.equal(deletionBlockReasons({ code: "OUTRO" }), null);
assert.equal(deletionBlockReasons(null), null);
assert.deepEqual(
  deletionBlockReasons({ code: "TAX_TITLE_BLOCKS_DELETION", message: "Não foi possível excluir.", data: { details: { motivos: ["Parcela 1 paga.", ""] } } }),
  ["Parcela 1 paga."]
);
assert.deepEqual(deletionBlockReasons({ code: "TAX_TITLE_BLOCKS_DELETION", message: "Nada foi excluído." }), ["Nada foi excluído."]);

// Previsto
assert.equal(isTaxTitleForecast({ previsto: true }), true);
assert.equal(isTaxTitleForecast({ previsto: false, situacao: "pendente" }), false, "só o servidor diz se é previsto");

// Consultar títulos (tributos)
assert.deepEqual(taxTitlesConsultOutcome({ total: 0 }), { type: "info", message: "Tributos — nenhum título de tributo para consultar no Protheus." });
assert.deepEqual(
  taxTitlesConsultOutcome({ total: 2, consultados: 2, conferencia: 0, por_resultado: { encontrado: 2, nao_encontrado: 0, inconclusivo: 0, ocupado: 0, erro: 0 } }),
  { type: "success", message: "Tributos — 2 de 2 títulos consultados", description: "2 encontrados no Protheus." }
);
const mixed = taxTitlesConsultOutcome({ total: 4, consultados: 2, conferencia: 1, por_resultado: { encontrado: 1, nao_encontrado: 1, inconclusivo: 0, ocupado: 1, erro: 1 } });
assert.equal(mixed.type, "warning");
assert.equal(mixed.message, "Tributos — 2 de 4 títulos consultados");
assert.equal(
  mixed.description,
  "1 encontrado no Protheus · 1 não encontrado · 1 com outra operação em andamento (não consultado) · 1 com erro · 1 precisa de conferência."
);
const divergent = taxTitlesConsultOutcome({
  total: 3,
  consultados: 3,
  conferencia: 2,
  por_resultado: { encontrado: 1, nao_encontrado: 0, divergente: 2, inconclusivo: 0, ocupado: 0, erro: 0 },
});
assert.equal(divergent.type, "warning", "divergência pede conferência");
assert.equal(
  divergent.description,
  "1 encontrado no Protheus · 2 com divergência no Protheus, precisam de conferência.",
  "a conferência dos divergentes não é contada duas vezes"
);
assert.equal(
  taxTitlesConsultOutcome({ total: 2, consultados: 2, conferencia: 2, por_resultado: { divergente: 1, nao_encontrado: 1 } }).description,
  "1 não encontrado · 1 com divergência no Protheus, precisa de conferência · 1 precisa de conferência."
);

console.log("taxTitles: ok");
