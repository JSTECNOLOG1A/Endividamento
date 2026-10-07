/**
 * Testes do rascunho dos fornecedores dos tributos (node src/lib/taxSuppliers.test.mjs).
 */
import assert from "node:assert/strict";
import {
  canEditParameters,
  draftFromValue,
  extraWarnings,
  isDraftDirty,
  newStateRow,
  stateRowsWithoutUf,
  supplierCheckLabel,
  supplierScopeLabel,
  valueFromDraft,
} from "./taxSuppliers.js";

const saved = {
  federal: { fornecedor: "UNIAO", loja: "00" },
  estadual: null,
  por_uf: { SP: { fornecedor: "SEFAZ", loja: "01" } },
};

// Ida e volta sem mudança: não está sujo.
const draft = draftFromValue(saved);
assert.deepEqual(valueFromDraft(draft), saved);
assert.equal(isDraftDirty(draft, saved), false);
assert.equal(isDraftDirty(draftFromValue({ federal: null, estadual: null, por_uf: {} }), { federal: null, estadual: null, por_uf: {} }), false);

// Diferença só de maiúsculas não conta como alteração (o servidor padroniza).
assert.equal(isDraftDirty({ ...draft, federal: { fornecedor: "uniao", loja: "00" } }, saved), false);
assert.equal(isDraftDirty({ ...draft, federal: { fornecedor: "", loja: "" } }, saved), true);

// Campos vazios viram null; linha de UF sem UF fica fora do valor, mas é apontada.
const withEmptyRow = { ...draft, estadual: { fornecedor: " ", loja: "" }, porUf: [...draft.porUf, { ...newStateRow(), fornecedor: "X" }] };
assert.equal(valueFromDraft(withEmptyRow).estadual, null);
assert.deepEqual(Object.keys(valueFromDraft(withEmptyRow).por_uf), ["SP"]);
assert.equal(stateRowsWithoutUf(withEmptyRow).length, 1);
assert.equal(isDraftDirty(withEmptyRow, saved), true);

// Rótulos: nada vira "encontrado" sem a situação encontrado.
assert.equal(supplierScopeLabel("por_uf.RJ"), "Tributos estaduais de RJ");
assert.equal(supplierCheckLabel("encontrado"), "Encontrado no Protheus");
assert.equal(supplierCheckLabel(undefined), "Não foi possível conferir no Protheus");
assert.deepEqual(
  extraWarnings({ fornecedores: [{ mensagem: "a" }], avisos: ["a", "b"] }),
  ["b"]
);

// Permissão.
assert.equal(canEditParameters({ role: "admin" }), true);
assert.equal(canEditParameters({ tenant_role: "ADMIN" }), true);
assert.equal(canEditParameters({ role: "user", tenant_role: "MEMBER" }), false);
assert.equal(canEditParameters({ role: "viewer", tenant_role: "OWNER" }), false);

console.log("taxSuppliers: ok");
