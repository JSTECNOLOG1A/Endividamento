/**
 * Testes de comparação de origem de endereços de ERP.
 * Regra: mesma origem = esquema + host + porta iguais; URL inválida nunca "bate".
 */
import assert from "node:assert/strict";
import { originOf, sameOrigin } from "./erpBaseUrl.js";

// Mesma origem, caminhos diferentes → true
assert.equal(sameOrigin("https://erp.cliente.com.br/rest", "https://erp.cliente.com.br/api/fin"), true);
// Esquema diferente → false
assert.equal(sameOrigin("http://erp.cliente.com.br", "https://erp.cliente.com.br"), false);
// Porta diferente → false
assert.equal(sameOrigin("https://erp.cliente.com.br:8443", "https://erp.cliente.com.br"), false);
// Host diferente → false
assert.equal(sameOrigin("https://erp.cliente.com.br", "https://outro.cliente.com.br"), false);
// Qualquer endereço inválido → false (conservador: trata como mudança)
assert.equal(sameOrigin("", "https://erp.cliente.com.br"), false);
assert.equal(sameOrigin("não-é-url", "https://erp.cliente.com.br"), false);
assert.equal(sameOrigin("https://erp.cliente.com.br", undefined), false);

// originOf
assert.equal(originOf("https://erp.cliente.com.br:8443/rest"), "https://erp.cliente.com.br:8443");
assert.equal(originOf("sem-esquema"), null);

console.log("erpBaseUrl ok: mesma-origem/esquema/porta/host/invalida");
