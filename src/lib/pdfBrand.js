// Identidade visual institucional para todos os PDFs gerados pelo AllDebt
// (Proposta Comercial, Termo de Contratação, Cronograma de Implantação...).
// Extraído de CommercialProposal.jsx pra ser reaproveitado sem duplicar —
// qualquer ajuste de marca (cores, cabeçalho, rodapé) feito aqui vale pra
// todos os documentos de uma vez só.
import { CLARITY_LOGO_PNG_BASE64 } from "@/assets/clarityLogo";
import { CLARITY_HEADER_BAR_BASE64, CLARITY_HEADER_BAR_ASPECT } from "@/assets/clarityHeaderBar";

// Cores oficiais ClarityIB, extraídas do papel timbrado
// (Documentos/Clarity/timbrado.docx) — usadas no cabeçalho/rodapé do PDF.
export const BRAND_NAVY = [11, 53, 88];
export const BRAND_CYAN = [14, 138, 157];

// Helpers de desenho de PDF compartilhados entre todos os documentos do
// AllDebt — mesma tipografia, cores e paginação, só muda o conteúdo do
// corpo de cada um.
export function createPdfHelpers(doc, { margin, contentW, pageW, pageH, footerH }) {
  let y = margin;

  const ensureSpace = (needed) => {
    if (y + needed > pageH - footerH) {
      doc.addPage();
      y = margin;
    }
  };

  const blankLine = (n = 24) => "_".repeat(n);
  const orBlank = (v, n = 24) => (v !== undefined && v !== null && String(v).trim() ? String(v).trim() : blankLine(n));

  const addTitle = (text, size = 14, color = BRAND_NAVY) => {
    ensureSpace(size + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(text, margin, y);
    y += size + 6;
  };

  const addBoldLine = (text, size = 10.5, color = [30, 41, 59]) => {
    ensureSpace(size + 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(text, margin, y);
    y += size + 4;
  };

  // Texto corrido justificado (como um contrato impresso) — todas as linhas
  // esticam até a margem direita, exceto a última linha do parágrafo, que
  // fica alinhada à esquerda normalmente (regra tipográfica padrão).
  const addParagraph = (text, size = 10, color = [51, 65, 85]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, contentW);
    lines.forEach((line, idx) => {
      ensureSpace(size + 4);
      if (idx < lines.length - 1) {
        doc.text(line, margin, y, { align: "justify", maxWidth: contentW });
      } else {
        doc.text(line, margin, y);
      }
      y += size + 4;
    });
    y += 4;
  };

  // Rótulo em negrito seguido do valor — usado nos campos que vêm de
  // textareas. Campos sem preenchimento não geram nenhuma linha no PDF.
  const addFieldBlock = (label, value, size = 10) => {
    if (!value || !String(value).trim()) return;
    ensureSpace(size + 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...BRAND_NAVY);
    doc.text(`${label}:`, margin, y);
    y += size + 4;
    addParagraph(value, size, [51, 65, 85]);
  };

  const addDivider = () => {
    ensureSpace(16);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 14;
  };

  const addValueRow = (label, value, { bold = false, size = 10.5, color = [51, 65, 85] } = {}) => {
    ensureSpace(size + 8);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(label, margin, y);
    doc.text(String(value), pageW - margin, y, { align: "right" });
    y += size + 8;
  };

  const addGap = (n) => { y += n; };

  const addCenteredTitle = (text, size = 13, color = BRAND_NAVY) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.splitTextToSize(text, contentW).forEach((line) => {
      ensureSpace(size + 5);
      doc.text(line, pageW / 2, y, { align: "center" });
      y += size + 5;
    });
  };

  // Barra gradiente idêntica à do papel timbrado oficial (arredondada,
  // navy -> cyan), com o título "AllDebt" + subtítulo em branco por cima.
  const drawHeaderBar = (subtitle) => {
    const barY = 32;
    const barW = contentW;
    const barH = barW / CLARITY_HEADER_BAR_ASPECT;
    doc.addImage(CLARITY_HEADER_BAR_BASE64, "PNG", margin, barY, barW, barH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text("AllDebt", margin + 20, barY + 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(230, 250, 253);
    doc.text(subtitle, margin + 20, barY + 45);
    doc.setFontSize(8);
    doc.setTextColor(215, 245, 248);
    doc.text("Emitida em " + new Date().toLocaleDateString("pt-BR"), margin + 20, barY + 59);

    y = barY + barH + 32;
  };

  return {
    ensureSpace, blankLine, orBlank, addTitle, addBoldLine, addParagraph,
    addFieldBlock, addDivider, addValueRow, addGap, addCenteredTitle, drawHeaderBar,
    getY: () => y, setY: (v) => { y = v; },
  };
}

// Logo + endereço/site/LinkedIn + numeração — desenhado em todas as páginas,
// no fim de cada documento (depois de todo o conteúdo já ter paginado).
export function drawFooterPages(doc, { margin, pageW, pageH, footerH }) {
  const logoSize = 36;
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const fy = pageH - footerH + 14;

    doc.addImage(CLARITY_LOGO_PNG_BASE64, "PNG", margin, fy - 13, logoSize, logoSize);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.75);
    doc.line(margin + logoSize + 8, fy - 13, margin + logoSize + 8, fy + 28);

    const textX = margin + logoSize + 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("Av. dos Guarantãs, nº 190, Sala 06, Jardim Maringá — Sinop/MT — CEP 78556-206", textX, fy);
    doc.setTextColor(...BRAND_CYAN);
    doc.text("www.clarityib.com.br   |   linkedin.com/company/clarityib", textX, fy + 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Página ${i} de ${totalPages}`, pageW - margin, fy + 12, { align: "right" });
  }
}

export function slugify(text, fallback = "cliente") {
  return String(text || fallback)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || fallback;
}
