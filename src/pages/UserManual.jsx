import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Loader2, Search, HelpCircle, ChevronDown, Lightbulb, AlertTriangle } from "lucide-react";
import { jsPDF } from "jspdf";
import { FAQ_ITEMS, FAQ_CATEGORIES } from "@/data/faqContent";
import { MANUAL_SECTIONS } from "@/data/manualContent";

function FaqPanel() {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);

  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalized) return null;
    return FAQ_ITEMS.filter((item) =>
      [item.question, item.answer, item.category].some((field) =>
        field.toLowerCase().includes(normalized)
      )
    );
  }, [normalized]);

  const popular = useMemo(() => FAQ_ITEMS.filter((item) => item.popular), []);
  const listToShow = filtered ?? popular;
  const showingSearch = filtered !== null;

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por assunto — ex: aprovação, CDI, PRICE, IOF..."
          className="pl-9 h-10"
        />
      </div>

      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
        {showingSearch
          ? `${listToShow.length} resultado${listToShow.length === 1 ? "" : "s"} para "${query}"`
          : "Perguntas mais frequentes"}
      </p>

      {listToShow.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          Nenhuma pergunta encontrada. Tente outro termo.
        </p>
      ) : (
        <div className="space-y-2">
          {listToShow.map((item) => {
            const isOpen = openId === item.id;
            return (
              <div key={item.id} className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">{item.category}</Badge>
                    <span className="text-sm font-medium text-slate-800 truncate">{item.question}</span>
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1">
                    <p className="text-sm text-slate-600 leading-relaxed">{item.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!showingSearch && (
        <p className="text-xs text-slate-400 text-center pt-2">
          {FAQ_ITEMS.length} perguntas cadastradas em {FAQ_CATEGORIES.length} assuntos — use a busca acima pra ver todas.
        </p>
      )}
    </div>
  );
}

function ManualBlock({ block }) {
  switch (block.type) {
    case "h":
      return <h3 className="text-sm font-semibold text-slate-800 mt-5 mb-2">{block.text}</h3>;
    case "p":
      return <p className="text-sm text-slate-600 leading-relaxed mb-3">{block.text}</p>;
    case "ul":
      return (
        <ul className="text-sm text-slate-600 leading-relaxed space-y-1.5 mb-3 list-disc pl-5">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="text-sm text-slate-600 leading-relaxed space-y-2 mb-3 list-decimal pl-5">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    case "tip":
      return (
        <div className="flex gap-2.5 items-start bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-3 mb-3">
          <Lightbulb className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 leading-relaxed">{block.text}</p>
        </div>
      );
    case "warn":
      return (
        <div className="flex gap-2.5 items-start bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3 mb-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">{block.text}</p>
        </div>
      );
    default:
      return null;
  }
}

function ManualPanel({ onDownload, generating }) {
  const [activeId, setActiveId] = useState(MANUAL_SECTIONS[0].id);
  const active = MANUAL_SECTIONS.find((s) => s.id === activeId) || MANUAL_SECTIONS[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <div className="lg:sticky lg:top-4 lg:self-start space-y-4">
        <nav className="space-y-0.5">
          {MANUAL_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveId(s.id)}
              className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${
                s.id === activeId
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <Button
          onClick={onDownload}
          disabled={generating}
          size="sm"
          variant="outline"
          className="w-full gap-1.5"
        >
          {generating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {generating ? "Gerando PDF..." : "Baixar Manual (PDF)"}
        </Button>
      </div>

      <div className="min-w-0 border-l border-slate-100 pl-6">
        <h2 className="text-lg font-bold text-slate-900 mb-1">{active.title}</h2>
        <p className="text-sm text-slate-500 mb-5">{active.intro}</p>
        {active.blocks.map((block, i) => (
          <ManualBlock key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

export default function UserManual() {
  const [generating, setGenerating] = useState(false);

  const generatePDF = () => {
    setGenerating(true);

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const contentW = pageW - margin * 2;
    let y = margin;

    const ensureSpace = (needed) => {
      if (y + needed > pageH - margin) {
        doc.addPage();
        y = margin;
      }
    };

    const addTitle = (text, size = 20, color = [15, 23, 42]) => {
      ensureSpace(size + 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.text(text, margin, y);
      y += size + 6;
    };

    const addSubtitle = (text) => {
      ensureSpace(28);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235);
      doc.text(text, margin, y);
      y += 20;
    };

    const addParagraph = (text, size = 10) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(51, 65, 85);
      const lines = doc.splitTextToSize(text, contentW);
      lines.forEach((line) => {
        ensureSpace(size + 4);
        doc.text(line, margin, y);
        y += size + 4;
      });
      y += 6;
    };

    const addBullet = (text, size = 10) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(51, 65, 85);
      const lines = doc.splitTextToSize(text, contentW - 20);
      lines.forEach((line, i) => {
        ensureSpace(size + 4);
        if (i === 0) doc.text("• " + line, margin + 10, y);
        else doc.text(line, margin + 18, y);
        y += size + 4;
      });
      y += 3;
    };

    const addStep = (n, text, size = 10) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(51, 65, 85);
      const prefix = `${n}. `;
      const lines = doc.splitTextToSize(text, contentW - 22);
      lines.forEach((line, i) => {
        ensureSpace(size + 4);
        if (i === 0) doc.text(prefix + line, margin + 10, y);
        else doc.text(line, margin + 22, y);
        y += size + 4;
      });
      y += 3;
    };

    const addCallout = (text, kind = "tip") => {
      const label = kind === "warn" ? "Atenção: " : "Dica: ";
      const bg = kind === "warn" ? [254, 243, 199] : [219, 234, 254];
      const fg = kind === "warn" ? [146, 64, 14] : [30, 64, 175];
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(label + text, contentW - 20);
      const boxH = lines.length * 13 + 12;
      ensureSpace(boxH + 8);
      doc.setFillColor(...bg);
      doc.roundedRect(margin, y, contentW, boxH, 4, 4, "F");
      doc.setTextColor(...fg);
      let ly = y + 15;
      lines.forEach((line) => {
        doc.text(line, margin + 10, ly);
        ly += 13;
      });
      y += boxH + 10;
    };

    const addDivider = () => {
      ensureSpace(16);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y);
      y += 14;
    };

    // ========== CAPA ==========
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageW, 120, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.setTextColor(255, 255, 255);
    doc.text("AllDebt", margin, 55);
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.text("Motor de Cálculo para Empréstimos e Financiamentos", margin, 78);
    doc.setFontSize(10);
    doc.text("Conforme regulamentação do Banco Central do Brasil (BACEN)", margin, 95);

    y = 160;
    addTitle("Manual de Uso", 22, [15, 23, 42]);
    addParagraph(
      "Guia completo, passo a passo, para utilização da plataforma AllDebt — simulação, gestão de contratos, governança, contabilidade e consolidação de operações de crédito."
    );

    addDivider();
    addParagraph("Versão: 2.0    |    Data: " + new Date().toLocaleDateString("pt-BR"));
    addParagraph("Documento gerado automaticamente pelo sistema — o mesmo conteúdo pode ser consultado em tela, na aba Manual.");

    // ========== ÍNDICE ==========
    doc.addPage();
    y = margin;
    addTitle("Sumário", 18);
    addDivider();
    MANUAL_SECTIONS.forEach((section) => addBullet(section.title));

    // ========== SEÇÕES (geradas a partir de MANUAL_SECTIONS) ==========
    MANUAL_SECTIONS.forEach((section) => {
      doc.addPage();
      y = margin;
      addTitle(section.title, 18);
      addDivider();
      if (section.intro) addParagraph(section.intro);

      section.blocks.forEach((block) => {
        if (block.type === "h") addSubtitle(block.text);
        else if (block.type === "p") addParagraph(block.text);
        else if (block.type === "ul") block.items.forEach((item) => addBullet(item));
        else if (block.type === "ol") block.items.forEach((item, i) => addStep(i + 1, item));
        else if (block.type === "tip") addCallout(block.text, "tip");
        else if (block.type === "warn") addCallout(block.text, "warn");
      });
    });

    // ========== RODAPÉ ==========
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `AllDebt — Manual de Uso    |    Página ${i} de ${totalPages}`,
        margin,
        pageH - 24
      );
    }

    doc.save("AllDebt-Manual-de-Uso.pdf");
    setGenerating(false);
  };

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manual e FAQ</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Consulte o passo a passo direto na tela ou busque uma dúvida rápida no FAQ
        </p>
      </div>

      <Tabs defaultValue="manual">
        <TabsList className="mb-6">
          <TabsTrigger value="manual" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Manual
          </TabsTrigger>
          <TabsTrigger value="faq" className="gap-1.5">
            <HelpCircle className="w-3.5 h-3.5" /> FAQ
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="pt-6">
              <ManualPanel onDownload={generatePDF} generating={generating} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faq">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">
                Perguntas frequentes
              </CardTitle>
              <p className="text-xs text-slate-500">
                Uso do sistema e matemática financeira — busque por assunto ou navegue pelas mais comuns.
              </p>
            </CardHeader>
            <CardContent>
              <FaqPanel />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
