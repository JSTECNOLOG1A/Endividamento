// Escape de HTML dos e-mails da Gestão Tributária. Próprio do módulo: o de signup/mailer.js mostra 0 como vazio e não
// escapa aspa simples. Aqui só null/undefined viram vazio; número (inclusive 0) vira o próprio texto.
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}
