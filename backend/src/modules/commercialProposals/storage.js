import { randomUUID } from "node:crypto";
import { createPdfStore, isPdf } from "../../services/pdfStore.js";

// Pasta própria das propostas, dentro do diretório de uploads: cada arquivo pertence a uma proposta e só sai
// pelas rotas do módulo. Chave = "<id da proposta>/<tipo>-<uuid>.pdf"; o nome original só é guardado no banco,
// para o download.
const store = createPdfStore({
  folder: "commercial-proposals",
  keyPattern: /^[0-9a-f-]{36}\/(assinado|enviado)-[0-9a-f-]{36}\.pdf$/,
  label: "proposta comercial",
});

export { isPdf };

export function saveProposalFile(proposalId, kind, buffer) {
  return store.save(`${proposalId}/${kind}-${randomUUID()}.pdf`, buffer);
}

export const removeProposalFile = store.remove;
export const resolveProposalFile = store.resolve;
export const proposalFileExists = store.exists;
