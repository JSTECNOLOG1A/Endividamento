/** Comparação de "origem" de endereços de ERP (esquema + host + porta).
 *
 * Espelha a regra do backend: ao editar uma conexão e trocar o endereço base
 * para uma origem diferente, a credencial salva é apagada por segurança. O
 * frontend usa isto só para avisar o usuário e pedir a senha de novo — a decisão
 * de apagar é sempre do servidor.
 */

/** Retorna a origem (ex.: "https://erp.cliente.com.br:8443") ou null se inválida. */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** true quando os dois endereços têm a mesma origem (ambos precisam ser válidos). */
export function sameOrigin(urlA, urlB) {
  const a = originOf(urlA);
  const b = originOf(urlB);
  return a !== null && b !== null && a === b;
}
