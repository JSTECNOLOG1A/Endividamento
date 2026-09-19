import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { usePlatform } from "@/lib/PlatformContext";
import { toast } from "@/lib/notify";
import { pricingConfigApi } from "@/api/pricingConfig";
import { toBRDecimalString } from "@/lib/brNumber";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSignature, Save, Loader2 } from "lucide-react";

// Mesmo parser usado em outros formulários do sistema (ex.:
// GuaranteedAccountFormDialog.jsx) — CurrencyInput trabalha com string em
// formato BR (1.234,56), aqui convertida pra número pra calcular.
const parseBRNumber = (str) => {
  if (!str) return 0;
  const cleaned = String(str).replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
};

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(Number(value) || 0);
}

const TIERS = [
  { value: "standard", prefix: "standard", label: "Standard", desc: "Tudo manual" },
  { value: "pro", prefix: "pro", label: "Standard Pro", desc: "Financeiro via API" },
  { value: "proii", prefix: "proii", label: "Standard Pro II", desc: "Financeiro + Contábil via API" },
];

const PARAM_FIELDS = [
  "standard_implantacao", "standard_mensalidade", "standard_bloco",
  "pro_implantacao", "pro_mensalidade", "pro_bloco",
  "proii_implantacao", "proii_mensalidade", "proii_bloco",
  "cadastramento_valor",
];

// A cada bloco fechado de 20 contratos além dos 10 inclusos na
// mensalidade-base soma um incremento fixo — não é cobrança por contrato
// individual. Ver Artifact "Planos AllDebt" onde esse modelo foi validado.
function blocksFor(count) {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (n <= 10) return 0;
  return Math.ceil((n - 10) / 20);
}

export default function CommercialProposal() {
  const { isMaster } = usePlatform();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ["pricing-config"],
    queryFn: () => pricingConfigApi.get(),
    enabled: isMaster,
  });

  const [params, setParams] = useState(null);
  useEffect(() => {
    if (!config) return;
    setParams(Object.fromEntries(PARAM_FIELDS.map((f) => [f, toBRDecimalString(config[f])])));
  }, [config]);

  const updateParam = (field, value) => setParams((p) => ({ ...p, [field]: value }));

  const saveMutation = useMutation({
    mutationFn: () =>
      pricingConfigApi.update(
        Object.fromEntries(PARAM_FIELDS.map((f) => [f, parseBRNumber(params[f])]))
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(["pricing-config"], saved);
      toast.success("Parâmetros salvos — valem para todos os admins a partir de agora.");
    },
    onError: (error) => toast.error(error.data?.error || error.message || "Erro ao salvar parâmetros"),
  });

  const [clientName, setClientName] = useState("");
  const [clientCnpj, setClientCnpj] = useState("");
  const [contactName, setContactName] = useState("");
  const [validityDays, setValidityDays] = useState("15");
  const [tier, setTier] = useState("standard");
  const [contractCount, setContractCount] = useState("");
  const [wantCadastro, setWantCadastro] = useState(false);
  const [cadastroQty, setCadastroQty] = useState("");

  if (!isMaster) {
    return (
      <div className="w-full px-4 sm:px-6 py-8">
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-500">
            Acesso restrito ao usuário master.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !params) {
    return (
      <div className="w-full px-4 sm:px-6 py-8 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando parâmetros...
      </div>
    );
  }

  const tierMeta = TIERS.find((t) => t.value === tier);
  const base = parseBRNumber(params[`${tierMeta.prefix}_mensalidade`]);
  const bloco = parseBRNumber(params[`${tierMeta.prefix}_bloco`]);
  const implantacao = parseBRNumber(params[`${tierMeta.prefix}_implantacao`]);
  const cadastramentoValor = parseBRNumber(params.cadastramento_valor);

  const count = Math.max(0, Math.round(Number(contractCount) || 0));
  const blocks = blocksFor(count);
  const mensalidade = base + blocks * bloco;
  const cadastroQtyNum = Math.max(0, Math.round(Number(cadastroQty) || 0));
  const cadastramentoTotal = wantCadastro ? cadastroQtyNum * cadastramentoValor : 0;
  const firstMonth = implantacao + mensalidade + cadastramentoTotal;

  const generatePdf = () => {
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

    const addTitle = (text, size = 14, color = [23, 32, 51]) => {
      ensureSpace(size + 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.text(text, margin, y);
      y += size + 6;
    };

    const addParagraph = (text, size = 10, color = [51, 65, 85]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.splitTextToSize(text, contentW).forEach((line) => {
        ensureSpace(size + 4);
        doc.text(line, margin, y);
        y += size + 4;
      });
      y += 4;
    };

    const addDivider = () => {
      ensureSpace(16);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y);
      y += 14;
    };

    const addValueRow = (label, value, { bold = false, size = 11, color = [51, 65, 85] } = {}) => {
      ensureSpace(size + 8);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.text(label, margin, y);
      doc.text(value, pageW - margin, y, { align: "right" });
      y += size + 8;
    };

    doc.setFillColor(23, 32, 51);
    doc.rect(0, 0, pageW, 110, "F");
    doc.setFillColor(6, 182, 212);
    doc.rect(0, 106, pageW, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(255, 255, 255);
    doc.text("AllDebt", margin, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    doc.setTextColor(103, 232, 249);
    doc.text("Proposta Comercial", margin, 72);
    doc.setFontSize(9);
    doc.setTextColor(200, 216, 230);
    doc.text("Emitida em " + new Date().toLocaleDateString("pt-BR"), margin, 90);

    y = 140;

    addTitle("Dados do cliente");
    addParagraph(`Cliente: ${clientName || "—"}`);
    if (clientCnpj) addParagraph(`CNPJ: ${clientCnpj}`);
    if (contactName) addParagraph(`Contato: ${contactName}`);
    addParagraph(`Proposta válida por ${validityDays || "15"} dias a partir da emissão.`);
    addDivider();

    addTitle("Plano contratado");
    addParagraph(`${tierMeta.label} — ${tierMeta.desc}`);
    addParagraph(`Carteira estimada: ${count} contrato(s) ativo(s).`);
    addDivider();

    addTitle("Investimento");
    addValueRow("Implantação (única)", formatCurrency(implantacao), { bold: true });
    addValueRow("Mensalidade base (até 10 contratos)", formatCurrency(base));
    if (blocks > 0) {
      addValueRow(
        `+ ${blocks} bloco(s) de 20 contratos × ${formatCurrency(bloco)}`,
        formatCurrency(blocks * bloco)
      );
    }
    addValueRow("Mensalidade recorrente", formatCurrency(mensalidade), { bold: true });
    if (wantCadastro && cadastroQtyNum > 0) {
      addValueRow(
        `Cadastramento assistido (${cadastroQtyNum} × ${formatCurrency(cadastramentoValor)})`,
        formatCurrency(cadastramentoTotal)
      );
    }
    addDivider();
    addValueRow("Total no 1º mês", formatCurrency(firstMonth), { bold: true, size: 13, color: [8, 145, 178] });
    addValueRow("Recorrente a partir do 2º mês", formatCurrency(mensalidade), { bold: true });
    addDivider();

    addTitle("Condições gerais", 12);
    addParagraph("Valores em reais (R$). A faixa de contratos é reavaliada periodicamente conforme a carteira ativa do cliente.");
    addParagraph("Proposta sujeita a alteração após o prazo de validade indicado acima.");

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`AllDebt — Proposta Comercial   |   Página ${i} de ${totalPages}`, margin, pageH - 24);
    }

    const slug = (clientName || "cliente")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    doc.save(`Proposta-Comercial-${slug || "cliente"}.pdf`);
  };

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Proposta Comercial</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Simule a mensalidade por tier e carteira de contratos, e emita a proposta em PDF.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parâmetros dos planos</CardTitle>
            <CardDescription>
              Compartilhados entre todos os admins — só "Salvar parâmetros" grava no banco.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {TIERS.map((t) => (
              <div key={t.value} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-800">{t.label} <span className="font-normal text-slate-500">— {t.desc}</span></p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Implantação (R$)</Label>
                    <CurrencyInput className="h-9" value={params[`${t.prefix}_implantacao`]} onChange={(e) => updateParam(`${t.prefix}_implantacao`, e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Mensalidade base (R$)</Label>
                    <CurrencyInput className="h-9" value={params[`${t.prefix}_mensalidade`]} onChange={(e) => updateParam(`${t.prefix}_mensalidade`, e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Bloco +20 (R$)</Label>
                    <CurrencyInput className="h-9" value={params[`${t.prefix}_bloco`]} onChange={(e) => updateParam(`${t.prefix}_bloco`, e.target.value)} placeholder="0,00" />
                  </div>
                </div>
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Cadastramento assistido, por contrato (R$)</Label>
              <CurrencyInput className="h-9" value={params.cadastramento_valor} onChange={(e) => updateParam("cadastramento_valor", e.target.value)} placeholder="0,00" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? "Salvando..." : "Salvar parâmetros"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulador de proposta</CardTitle>
            <CardDescription>Preencha os dados do cliente e emita o PDF.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Cliente (razão social)</Label>
                <Input className="h-9" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nome do cliente" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">CNPJ (opcional)</Label>
                <Input className="h-9" value={clientCnpj} onChange={(e) => setClientCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Contato</Label>
                <Input className="h-9" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome do contato" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Validade (dias)</Label>
                <Input className="h-9" type="number" min="1" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Tier</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Contratos ativos</Label>
                <Input className="h-9" type="number" min="0" value={contractCount} onChange={(e) => setContractCount(e.target.value)} placeholder="0" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox id="want-cadastro" checked={wantCadastro} onCheckedChange={(v) => setWantCadastro(Boolean(v))} />
              <Label htmlFor="want-cadastro" className="text-sm font-normal text-slate-700">Incluir cadastramento assistido</Label>
              <Input
                className="h-8 w-24"
                type="number"
                min="0"
                disabled={!wantCadastro}
                value={cadastroQty}
                onChange={(e) => setCadastroQty(e.target.value)}
                placeholder="qtd."
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Mensalidade base (até 10)</span><span className="font-medium">{formatCurrency(base)}</span></div>
              <div className="flex justify-between pl-3 text-xs"><span className="text-slate-500">+ {blocks} bloco(s) de 20 × {formatCurrency(bloco)}</span><span className="font-medium">{formatCurrency(blocks * bloco)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Mensalidade recorrente</span><span className="font-semibold">{formatCurrency(mensalidade)}</span></div>
              <div className="h-px bg-slate-200 my-1.5" />
              <div className="flex justify-between"><span className="text-slate-500">Implantação (única)</span><span className="font-medium">{formatCurrency(implantacao)}</span></div>
              {wantCadastro && (
                <div className="flex justify-between"><span className="text-slate-500">Cadastramento ({cadastroQtyNum} × {formatCurrency(cadastramentoValor)})</span><span className="font-medium">{formatCurrency(cadastramentoTotal)}</span></div>
              )}
              <div className="h-px bg-slate-200 my-1.5" />
              <div className="flex justify-between text-base"><span className="font-semibold">Total no 1º mês</span><span className="font-bold text-cyan-700">{formatCurrency(firstMonth)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">Recorrente a partir do 2º mês</span><span className="font-medium">{formatCurrency(mensalidade)}</span></div>
            </div>

            <Button type="button" className="gap-1.5 w-full" onClick={generatePdf}>
              <FileSignature className="w-4 h-4" />
              Emitir Proposta Comercial (PDF)
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
