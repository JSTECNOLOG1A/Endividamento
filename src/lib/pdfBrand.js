// Identidade visual institucional para todos os PDFs gerados pelo AllDebt
// (Proposta Comercial, Termo de Contratação, Cronograma de Implantação...).
// Extraído de CommercialProposal.jsx pra ser reaproveitado sem duplicar —
// qualquer ajuste de marca (cores, cabeçalho, rodapé) feito aqui vale pra
// todos os documentos de uma vez só.
import { CLARITY_LOGO_PNG_BASE64 } from "@/assets/clarityLogo";
import { CLARITY_HEADER_BAR_BASE64, CLARITY_HEADER_BAR_ASPECT } from "@/assets/clarityHeaderBar";
import { LETTERHEAD_ARROWS, LETTERHEAD_WATERMARK, LETTERHEAD_FOOTER_LOGO } from "@/assets/clarityLetterhead";

// Cores oficiais ClarityIB, extraídas do papel timbrado
// (Documentos/Clarity/timbrado.docx) — usadas no cabeçalho/rodapé do PDF.
export const BRAND_NAVY = [11, 53, 88];
export const BRAND_CYAN = [14, 138, 157];

// Padrão tipográfico ÚNICO dos documentos do AllDebt (Proposta Comercial,
// Termo, Cronograma de Implantação...). Todo texto do conteúdo usa a mesma
// cor (azul-escuro institucional) e o destaque vem só de peso/tamanho/espaço;
// o turquesa fica restrito aos elementos gráficos do timbrado.
// Mexeu aqui, mexeu em todos os documentos.
export const PDF_STYLE = {
  font: "helvetica",
  color: BRAND_NAVY,
  size: { title: 20, subtitle: 12, section: 12, body: 10 },
  lineHeight: 14, // entre linhas de texto corrido
  rowHeight: 16, // linhas rótulo/valor
  paragraphGap: 4, // depois de cada parágrafo
  sectionTitleGap: 18, // da linha-base do título de seção à 1ª linha de conteúdo
  divider: { color: [203, 213, 225], width: 0.5, before: 6, after: 16 },
};

// Helpers de desenho de PDF compartilhados entre todos os documentos do
// AllDebt — mesma tipografia, cores e paginação, só muda o conteúdo do
// corpo de cada um.
// marginRight/topY/onNewPage são opcionais: sem eles o comportamento é o
// de sempre (margens simétricas, página nova começa em `margin`).
export function createPdfHelpers(doc, { margin, marginRight = margin, topY = margin, onNewPage, contentW, pageW, pageH, footerH }) {
  const { font, color, size, lineHeight, rowHeight, paragraphGap, sectionTitleGap, divider } = PDF_STYLE;
  let y = topY;
  const rightX = pageW - marginRight;

  const ensureSpace = (needed) => {
    if (y + needed > pageH - footerH) {
      doc.addPage();
      if (onNewPage) onNewPage();
      y = topY;
    }
  };

  const setText = (weight, fontSize) => {
    doc.setFont(font, weight);
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
  };

  const blankLine = (n = 24) => "_".repeat(n);
  const orBlank = (v, n = 24) => (v !== undefined && v !== null && String(v).trim() ? String(v).trim() : blankLine(n));

  // Título de seção — mesmo tamanho/peso/cor em todo o documento.
  const addTitle = (text) => {
    ensureSpace(size.section + 12);
    setText("bold", size.section);
    doc.text(text, margin, y);
    y += sectionTitleGap;
  };

  const addBoldLine = (text) => {
    ensureSpace(lineHeight);
    setText("bold", size.body);
    doc.text(text, margin, y);
    y += lineHeight;
  };

  // Texto corrido justificado (como um contrato impresso) — todas as linhas
  // esticam até a margem direita, exceto a última linha do parágrafo, que
  // fica alinhada à esquerda normalmente (regra tipográfica padrão).
  const addParagraph = (text) => {
    setText("normal", size.body);
    const lines = doc.splitTextToSize(text, contentW);
    lines.forEach((line, idx) => {
      ensureSpace(lineHeight);
      if (idx < lines.length - 1) {
        doc.text(line, margin, y, { align: "justify", maxWidth: contentW });
      } else {
        doc.text(line, margin, y);
      }
      y += lineHeight;
    });
    y += paragraphGap;
  };

  // Rótulo em negrito seguido do valor — usado nos campos que vêm de
  // textareas. Campos sem preenchimento não geram nenhuma linha no PDF.
  const addFieldBlock = (label, value) => {
    if (!value || !String(value).trim()) return;
    ensureSpace(lineHeight * 2);
    setText("bold", size.body);
    doc.text(`${label}:`, margin, y);
    y += lineHeight;
    addParagraph(value);
  };

  const addDivider = () => {
    ensureSpace(divider.before + divider.after);
    y += divider.before;
    doc.setDrawColor(...divider.color);
    doc.setLineWidth(divider.width);
    doc.line(margin, y, rightX, y);
    y += divider.after;
  };

  // Rótulo à esquerda, valor alinhado à direita. Destaque (ex.: totais) só
  // por negrito — mesmo tamanho e mesma cor das demais linhas.
  const addValueRow = (label, value, { bold = false } = {}) => {
    ensureSpace(rowHeight);
    setText(bold ? "bold" : "normal", size.body);
    doc.text(label, margin, y);
    doc.text(String(value), rightX, y, { align: "right" });
    y += rowHeight;
  };

  const addGap = (n) => { y += n; };

  const addCenteredTitle = (text) => {
    setText("bold", size.section);
    doc.splitTextToSize(text, contentW).forEach((line) => {
      ensureSpace(lineHeight + 4);
      doc.text(line, margin + contentW / 2, y, { align: "center" });
      y += lineHeight + 4;
    });
  };

  // Barra gradiente idêntica à do papel timbrado oficial (arredondada,
  // navy -> cyan), com o título "AllDebt" + subtítulo em branco por cima.
  const drawHeaderBar = (subtitle) => {
    const barY = 32;
    const barH = contentW / CLARITY_HEADER_BAR_ASPECT;
    // Faixa de ponta a ponta da página: a imagem é desenhada um pouco maior
    // que a página nos dois lados para os cantos arredondados do PNG ficarem
    // fora da área visível.
    const bleed = 14;
    doc.addImage(CLARITY_HEADER_BAR_BASE64, "PNG", -bleed, barY, pageW + bleed * 2, barH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text("AllDebt", margin, barY + 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(230, 250, 253);
    doc.text(subtitle, margin, barY + 45);
    doc.setFontSize(8);
    doc.setTextColor(215, 245, 248);
    doc.text("Emitida em " + new Date().toLocaleDateString("pt-BR"), margin, barY + 59);

    y = barY + barH + 32;
  };

  // Papel timbrado: o cabeçalho é só gráfico, então a identificação do
  // documento (AllDebt + subtítulo + data) abre o corpo, sobre o fundo branco.
  const drawLetterheadIntro = (subtitle) => {
    setText("bold", size.title);
    doc.text("AllDebt", margin, y + 14);
    setText("normal", size.subtitle);
    doc.text(subtitle, margin, y + 32);
    setText("normal", size.body);
    doc.text("Emitida em " + new Date().toLocaleDateString("pt-BR"), margin, y + 47);
    y += 47 + 22;
  };

  return {
    ensureSpace, blankLine, orBlank, addTitle, addBoldLine, addParagraph,
    addFieldBlock, addDivider, addValueRow, addGap, addCenteredTitle, drawHeaderBar, drawLetterheadIntro,
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

// ---------------------------------------------------------------------------
// Papel timbrado oficial da Clarity IB (Documentos/Clarity/timbrado.docx),
// medidas e posições em pt copiadas do próprio .docx (página A4, 595x842).
// Camada 1 (fundo): marca-d'água + faixa em degradê + setas — desenhada no
// início de cada página, ANTES do conteúdo. Camada 2 (rodapé): logo + dados
// institucionais — desenhada no fim, sobre a área reservada do rodapé.
// ---------------------------------------------------------------------------
export const LETTERHEAD = {
  marginLeft: 85.05,
  marginRight: 42.55,
  topY: 72,
  footerH: 97,
};

export function drawLetterheadBackground(doc) {
  const wm = LETTERHEAD_WATERMARK;
  doc.addImage(wm.data, "PNG", wm.x, wm.y, wm.w, wm.h);
  doc.addImage(CLARITY_HEADER_BAR_BASE64, "PNG", -1.4, -18.77, 429, 429 / CLARITY_HEADER_BAR_ASPECT);
  const ar = LETTERHEAD_ARROWS;
  doc.addImage(ar.data, "PNG", ar.x, ar.y, ar.w, ar.h);
}

export function drawLetterheadFooterPages(doc, { pageW }) {
  const logo = LETTERHEAD_FOOTER_LOGO;
  const textX = 190.5;
  const firstBaseline = 775.5;
  const lineGap = 11.2;
  const hyperlink = [70, 120, 134]; // cor "Hyperlink" do timbrado (#467886)
  const lines = ["Avenida dos Guarantãs, nº 190, Sala 06, Jardim Maringá", "Sinop/MT | CEP 78556-206"];
  const totalPages = doc.internal.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.addImage(logo.data, "PNG", logo.x, logo.y, logo.w, logo.h);

    doc.setDrawColor(47, 105, 161);
    doc.setLineWidth(0.75);
    doc.line(176.13, 758.05, 176.13, 814.2);

    // Helvetica no lugar da Aptos Narrow: ajusta o corpo para a 1ª linha
    // ocupar a mesma largura (196pt) que tem no timbrado.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const size = (7 * 196) / doc.getTextWidth(lines[0]);
    doc.setFontSize(size);
    doc.setTextColor(30, 30, 30);
    lines.forEach((t, n) => doc.text(t, textX, firstBaseline + n * lineGap));

    const link = (text, url, baseline) => {
      doc.setTextColor(...hyperlink);
      doc.textWithLink(text, textX, baseline, { url });
      doc.setDrawColor(...hyperlink);
      doc.setLineWidth(0.4);
      doc.line(textX, baseline + 1.2, textX + doc.getTextWidth(text), baseline + 1.2);
    };
    link("www.clarityib.com.br", "http://www.clarityib.com.br", firstBaseline + 2 * lineGap);
    link("Linkedin: https://www.linkedin.com/company/clarityib", "https://www.linkedin.com/company/clarityib", firstBaseline + 3 * lineGap);

    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Página ${i} de ${totalPages}`, pageW - LETTERHEAD.marginRight, firstBaseline + 3 * lineGap, { align: "right" });
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
