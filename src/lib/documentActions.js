import { toast } from "@/lib/notify";
import { getToken } from "@/api/base44Client";

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

// /uploads/* exige autenticação, mas <iframe src>, <a href> e download direto
// não têm como mandar o header Authorization — o backend previu isso e aceita
// o token como query string (?token=...) nessas rotas (ver app.js). Anexa o
// token só em caminhos internos (/uploads/...); um link externo não precisa
// (e não deve receber) o token.
export function withAuthToken(url) {
  if (!url || !url.startsWith("/uploads/")) return url;
  const token = getToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

// Baixa um PDF já hospedado (contract_pdf_url, proof_url etc.) forçando o
// nome do arquivo — sem isso, o navegador usa o nome opaco do storage.
export async function downloadRenamed(url, filename) {
  try {
    const response = await fetch(withAuthToken(url));
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

// Tempo que o endereço temporário do arquivo continua válido depois de aberto
// — o bastante para a nova aba terminar de carregar o PDF.
const OBJECT_URL_LIFETIME_MS = 60_000;

function asPdfBlob(blob) {
  return blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
}

// Abre um PDF protegido numa nova aba. A aba é aberta já no clique, antes do
// download terminar: aberta depois, o navegador a trataria como pop-up e a
// bloquearia. `loadBlob` baixa o arquivo com o header de autenticação.
// O PDF fica num quadro dentro de uma página própria, que leva o nome do
// arquivo no título da aba — aberto direto, o título seria o endereço
// temporário do arquivo.
export async function openPdfInNewTab(loadBlob, title = "") {
  const tab = window.open("", "_blank");
  if (tab) {
    tab.opener = null;
    tab.document.title = "Carregando...";
    tab.document.body.textContent = "Carregando o arquivo...";
  }
  try {
    const objectUrl = URL.createObjectURL(asPdfBlob(await loadBlob()));
    if (tab) {
      const doc = tab.document;
      doc.title = title || "Documento";
      doc.body.textContent = "";
      doc.body.style.margin = "0";
      const frame = doc.createElement("iframe");
      frame.src = objectUrl;
      frame.title = title || "Documento";
      frame.style.cssText = "border:0;width:100vw;height:100vh;display:block";
      doc.body.appendChild(frame);
    } else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_LIFETIME_MS);
  } catch (error) {
    tab?.close();
    throw error;
  }
}

// Baixa um PDF protegido com o nome de arquivo informado.
export async function downloadPdf(loadBlob, filename) {
  const objectUrl = URL.createObjectURL(asPdfBlob(await loadBlob()));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_LIFETIME_MS);
}
