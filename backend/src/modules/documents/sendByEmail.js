import { config } from "../../config.js";
import * as entityStore from "../entities/store.js";
import { sendNotification } from "../notifications/mailer.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toAbsoluteUrl(url) {
  return url.startsWith("http") ? url : `${config.appBaseUrl}${url}`;
}

async function bankName(bankId) {
  if (!bankId) return null;
  try {
    return (await entityStore.getById("Bank", bankId))?.bank_name || null;
  } catch {
    return null;
  }
}

/**
 * Envia um PDF já hospedado no sistema (contrato ou comprovante de baixa)
 * por e-mail — hoje isso passa pelo mesmo "log-only" de sendNotification
 * (ver mailer.js), então o resultado é sempre status "simulado" até um
 * provedor de e-mail real ser configurado.
 */
export async function sendDocumentByEmail(payload = {}) {
  const documentType = payload.document_type;
  const documentId = String(payload.document_id || "").trim();
  const to = String(payload.to_email || "").trim();
  if (!to) throw httpError(400, "Informe o e-mail do destinatário");
  if (!documentId) throw httpError(400, "Documento não informado");

  let pdfUrl;
  let contractId;
  let label;

  if (documentType === "contract_pdf") {
    const contract = await entityStore.getById("LoanContract", documentId);
    if (!contract.contract_pdf_url) throw httpError(404, "Este contrato não tem PDF anexado");
    const bank = await bankName(contract.bank_id);
    label = `${bank || "Contrato"} — nº ${contract.contract_number}`;
    pdfUrl = contract.contract_pdf_url;
    contractId = contract.id;
  } else if (documentType === "settlement_proof") {
    const settlement = await entityStore.getById("ContractSettlement", documentId);
    if (!settlement.proof_url) throw httpError(404, "Esta baixa não tem comprovante anexado");
    const contract = await entityStore.getById("LoanContract", settlement.contract_id).catch(() => null);
    const bank = contract ? await bankName(contract.bank_id) : null;
    label = `Comprovante de baixa — parcela ${settlement.parcela || "-"} — ${bank || ""} ${contract?.contract_number || settlement.contract_id}`.trim();
    pdfUrl = settlement.proof_url;
    contractId = settlement.contract_id;
  } else {
    throw httpError(400, "Tipo de documento inválido");
  }

  const link = toAbsoluteUrl(pdfUrl);
  const [record] = await sendNotification({
    eventType: "documento_pdf",
    contractId,
    to,
    subject: `Documento: ${label}`,
    body: `Segue o documento solicitado: ${label}.\n\nAcesse o link para baixar: ${link}`,
  });

  return { status: record?.status || "simulado" };
}
