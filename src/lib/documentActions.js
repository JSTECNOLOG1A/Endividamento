import { toast } from "@/lib/notify";

// Usado para montar o nome do arquivo baixado (ex.: "Bradesco_6111879.pdf") —
// compartilhado entre qualquer tela que baixe um PDF anexado (contrato,
// comprovante de baixa etc.).
export function sanitizeFilename(name) {
  return String(name || "documento")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// Baixa um PDF já hospedado (contract_pdf_url, proof_url etc.) forçando o
// nome do arquivo — sem isso, o navegador usa o nome opaco do storage.
export async function downloadRenamed(url, filename) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    toast.error("Erro ao baixar o arquivo: " + (err.message || "tente novamente"));
  }
}
