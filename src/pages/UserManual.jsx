import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileText, Loader2 } from "lucide-react";
import { jsPDF } from "jspdf";

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

    const addSpacer = (h = 10) => { y += h; };

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
    doc.text("Endividamento", margin, 55);
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.text("Motor de Cálculo para Empréstimos e Financiamentos", margin, 78);
    doc.setFontSize(10);
    doc.text("Conforme regulamentação do Banco Central do Brasil (BACEN)", margin, 95);

    y = 160;
    addTitle("Manual de Uso", 22, [15, 23, 42]);
    addParagraph("Guia completo para utilização da plataforma Endividamento — simulação, gestão de contratos, governança, contabilidade e consolidação de operações de crédito.");

    addDivider();
    addParagraph("Versão: 1.0    |    Data: " + new Date().toLocaleDateString("pt-BR"));
    addParagraph("Documento gerado automaticamente pelo sistema.");

    // ========== ÍNDICE ==========
    doc.addPage();
    y = margin;
    addTitle("Sumário", 18);
    addDivider();

    const sections = [
      "1. Visão Geral da Plataforma",
      "2. Calculadora de Operações",
      "3. Gestão de Contratos",
      "4. Governança (Grupos, Entidades e Bancos)",
      "5. Contabilidade (CPC 26)",
      "6. Consolidação de Dívidas",
      "7. Indexadores e Feriados",
      "8. Sistemas de Amortização",
      "9. Operações em Moeda Estrangeira (USD)",
      "10. Exportação de Relatórios",
      "11. Glossário",
    ];
    sections.forEach((s) => addBullet(s));

    // ========== 1. VISÃO GERAL ==========
    doc.addPage();
    y = margin;
    addTitle("1. Visão Geral da Plataforma", 18);
    addDivider();
    addParagraph(
      "O Endividamento é uma plataforma de cálculo financeiro para operações de empréstimos e financiamentos, aderente às normas do Banco Central do Brasil (BACEN) e às práticas contábeis brasileiras (CPC 26)."
    );
    addParagraph("A plataforma oferece seis módulos principais, acessíveis pela barra de navegação superior:");
    addBullet("Calculadora — Cálculo de tabelas de amortização com gráficos e validações");
    addBullet("Contratos — Cadastro, aprovação e gestão de contratos");
    addBullet("Governança — Grupos econômicos, entidades e bancos credores");
    addBullet("Contabilidade — Análise contábil de dívidas com visão CPC 26");
    addBullet("Consolidação — Análise consolidada por grupo econômico");
    addBullet("Indexadores e Feriados — Importação de CDI, SELIC, PTAX USD e feriados");

    addSpacer();
    addSubtitle("Requisitos");
    addBullet("Navegador web moderno (Chrome, Edge, Firefox ou Safari)");
    addBullet("Acesso à internet");
    addBullet("Conta de usuário cadastrada e autenticada");

    // ========== 2. CALCULADORA ==========
    doc.addPage();
    y = margin;
    addTitle("2. Calculadora de Operações", 18);
    addDivider();
    addParagraph(
      "A Calculadora é o módulo principal do Endividamento. Permite configurar todos os parâmetros de uma operação de crédito e visualizar a tabela de amortização completa, gráficos e indicadores financeiros."
    );

    addSubtitle("Como calcular uma operação");
    addBullet("Preencha o formulário com os dados da operação: grupo econômico, entidade, banco, número do contrato");
    addBullet("Selecione a categoria (Empréstimos, Financiamentos, Mútuos com Partes Relacionadas ou Mútuos com Terceiros) e o tipo de operação");
    addBullet("Informe o valor da operação, taxa de juros e data de operação");
    addBullet("Configure o sistema de cálculo (SAC, PRICE, AMERICANO, BULLET ou PERCENTAGE_RESIDUAL)");
    addBullet("Defina prazos, carências e frequências de pagamento");
    addBullet("Clique em \"Calcular\" para gerar a tabela de amortização");

    addSubtitle("Parâmetros disponíveis");
    addBullet("Valor da operação e valor em moeda estrangeira (quando aplicável)");
    addBullet("Taxa de juros fixa (% a.a.) e spread sobre indexador");
    addBullet("Indexador: CDI, SELIC, IPCA ou NA (sem indexador)");
    addBullet("Carência de principal e de juros com comportamento (capitalizar, pagar ou balloon)");
    addBullet("Quantidade de parcelas e frequências de principal e juros");
    addBullet("Seguros: MIP, DFI e outros (embutidos na parcela ou separados)");
    addBullet("IOF, taxas diversas e sinal do negócio");

    addSubtitle("Resultados");
    addBullet("Tabela de amortização completa com todas as parcelas");
    addBullet("Gráfico de evolução do saldo devedor e pagamentos");
    addBullet("Cartões resumo: total de juros, total de prestações, CET anual");
    addBullet("Validação de snapshot para integridade matemática");

    // ========== 3. CONTRATOS ==========
    doc.addPage();
    y = margin;
    addTitle("3. Gestão de Contratos", 18);
    addDivider();
    addParagraph(
      "O módulo de Contratos permite gerenciar o ciclo de vida completo dos contratos: cadastro, aprovação e acompanhamento."
    );

    addSubtitle("Fluxo de status");
    addBullet("Rascunho — Contrato em edição, salvo automaticamente no navegador (autosave)");
    addBullet("Pendente — Contrato salvo e aguardando aprovação (o botão Salvar já envia para aprovação)");
    addBullet("Aprovado — Contrato aprovado e pronto para contabilização");
    addBullet("Devolvido para Correção — Recusado pelo aprovador com um comentário; volta para edição e, ao ser salvo novamente, retorna para Pendente");

    addSubtitle("Funcionalidades");
    addBullet("Listagem de contratos com filtros por status e banco");
    addBullet("Visualização detalhada com tabela de amortização e gráficos");
    addBullet("Edição de datas de vencimento das parcelas");
    addBullet("Workflow de aprovação com registro de auditoria");
    addBullet("Anexar PDF do contrato assinado");

    // ========== 4. GOVERNANÇA ==========
    doc.addPage();
    y = margin;
    addTitle("4. Governança (Grupos, Entidades e Bancos)", 18);
    addDivider();
    addParagraph(
      "O módulo de Governança mantém a estrutura organizacional para o controle das operações."
    );

    addSubtitle("Grupos Econômicos");
    addBullet("Cadastro de holdings e grupos econômicos");
    addBullet("CNPJ opcional e descrição");
    addBullet("Status ativo/inativo");

    addSubtitle("Entidades (Empresas)");
    addBullet("Empresas vinculadas a grupos econômicos");
    addBullet("Tipo: empresa (CNPJ) ou pessoa física (PF / CPF)");
    addBullet("Status ativo/inativo");

    addSubtitle("Bancos Credores");
    addBullet("Código COMPE/SPB e nome do banco");
    addBullet("Tipo: privado, público ou estrangeiro");
    addBullet("Status ativo/inativo");

    // ========== 5. CONTABILIDADE ==========
    doc.addPage();
    y = margin;
    addTitle("5. Contabilidade (CPC 26)", 18);
    addDivider();
    addParagraph(
      "O módulo de Contabilidade fornece análise das dívidas sob a perspectiva contábil, aderente ao CPC 26 (IFRS)."
    );

    addSubtitle("Funcionalidades");
    addBullet("Análise de dívidas por período (data inicial e final)");
    addBullet("Mapa de dívidas hierárquico por grupo, entidade e banco");
    addBullet("Distribuição de principal em curto prazo (até 12 meses) e longo prazo (acima de 12 meses)");
    addBullet("Juros apropriados por mês e acumulados");
    addBullet("Dashboard de analytics de endividamento");

    addSubtitle("Visão Contábil CPC 26");
    addParagraph(
      "Para operações em moeda estrangeira (USD), a visão contábil reconhece a variação cambial ao final de cada período de reporte, com base na taxa PTAX de fechamento. A linha 0 (abertura referencial) é apenas demonstrativa e não gera lançamento contábil. O primeiro período inclui a variação cambial desde a data da operação até o fechamento do primeiro período contábil."
    );

    // ========== 6. CONSOLIDAÇÃO ==========
    doc.addPage();
    y = margin;
    addTitle("6. Consolidação de Dívidas", 18);
    addDivider();
    addParagraph(
      "O módulo de Consolidação agrega todas as operações de crédito em uma visão consolidada por grupo econômico."
    );

    addSubtitle("Funcionalidades");
    addBullet("Dashboard consolidado por grupo econômico");
    addBullet("Agregação por entidade componente e banco credor");
    addBullet("Total de principal, juros e prestações por grupo");
    addBullet("Distribuição entre curto e longo prazo");

    // ========== 7. INDEXADORES ==========
    doc.addPage();
    y = margin;
    addTitle("7. Indexadores e Feriados", 18);
    addDivider();
    addParagraph(
      "Este módulo gerencia a importação e manutenção de séries históricas de taxas e calendário de feriados."
    );

    addSubtitle("CDI / SELIC");
    addBullet("Importação de arquivos CSV com taxas CDI e SELIC");
    addBullet("Tabela com data, taxa anual e fator diário");
    addBullet("Filtros por intervalo de datas e paginação");

    addSubtitle("PTAX USD");
    addBullet("Importação de cotações PTAX USD do Banco Central");
    addBullet("Histórico de taxas por data");
    addBullet("Filtros por data, mês e ano com paginação");

    addSubtitle("Feriados");
    addBullet("Importação de feriados nacionais via CSV");
    addBullet("Tabela com data, nome e dia da semana");
    addBullet("Utilizado no cálculo de dias úteis");

    // ========== 8. SISTEMAS DE AMORTIZAÇÃO ==========
    doc.addPage();
    y = margin;
    addTitle("8. Sistemas de Amortização", 18);
    addDivider();
    addParagraph("O Endividamento suporta cinco sistemas de amortização:");

    addSubtitle("SAC — Sistema de Amortização Constante");
    addParagraph("Amortização do principal em valores iguais a cada período. Juros decrescentes calculados sobre o saldo devedor. Prestações decrescentes ao longo do prazo.");

    addSubtitle("PRICE — Sistema Francês (Price)");
    addParagraph("Prestações fixas (iguais) em todos os períodos. Juros decrescentes e amortização crescente. O valor da prestação é calculado pela fórmula PMT.");

    addSubtitle("AMERICANO");
    addParagraph("Pagamento periódico de juros com amortização do principal em parcela única (bullet) no vencimento final.");

    addSubtitle("BULLET");
    addParagraph("Amortização total do principal e juros em parcela única no vencimento final.");

    addSubtitle("PERCENTAGE_RESIDUAL — Percentual Residual");
    addParagraph("Amortização por percentuais definidos sobre o saldo devedor ou sobre o principal original. Percentuais podem ser configurados livremente (ex: 24,18%; 28,09%; 32,72%).");

    // ========== 9. MOEDA ESTRANGEIRA ==========
    doc.addPage();
    y = margin;
    addTitle("9. Operações em Moeda Estrangeira (USD)", 18);
    addDivider();
    addParagraph(
      "Para operações em moeda estrangeira (Resolução CMN 4.131 / Lei 4.131), o Endividamento oferece duas visões complementares:"
    );

    addSubtitle("Visão Financeira (Fluxo de Caixa)");
    addBullet("Conversão USD → BRL usando PTAX do período (snapshot instantâneo)");
    addBullet("Tradução do fluxo de pagamentos para BRL");
    addBullet("Indicador: PMT BRL = USD × PTAX Atual");

    addSubtitle("Visão Contábil (CPC 26 — Competência)");
    addBullet("Reconhecimento por competência com PTAX de fechamento do período");
    addBullet("Abertura BRL = SD USD × PTAX Anterior");
    addBullet("Ajuste Cambial = SD Inicial USD × (PTAX Atual − PTAX Anterior)");
    addBullet("Fechamento BRL = Abertura + Ajuste Cambial + Juros − Amortização");
    addBullet("Linha 0: abertura referencial (não gera lançamento contábil)");

    addSubtitle("Defasagem PTAX (Exchange Lag)");
    addBullet("D = PTAX do dia do pagamento");
    addBullet("D-1 = PTAX do dia anterior ao pagamento");
    addBullet("D-2 = PTAX de dois dias anteriores ao pagamento");

    // ========== 10. EXPORTAÇÃO ==========
    doc.addPage();
    y = margin;
    addTitle("10. Exportação de Relatórios", 18);
    addDivider();
    addParagraph("Para operações em USD, três formatos de exportação CSV estão disponíveis:");

    addSubtitle("CSV Financeiro");
    addBullet("Tabela completa em visão financeira (fluxo de caixa)");
    addBullet("Colunas em USD e BRL (conversão pela PTAX do período)");
    addBullet("Inclui saldo inicial, juros, amortização, prestação e saldo final");

    addSubtitle("CSV Contábil");
    addBullet("Tabela em visão contábil (CPC 26)");
    addBullet("Colunas: PTAX anterior, PTAX atual, delta PTAX");
    addBullet("Abertura BRL, ajuste cambial, juros apropriados, amortização paga, fechamento BRL");
    addBullet("Reconciliação com delta e status de validação");
    addBullet("Linha 0 marcada como ABERTURA_REFERENCIAL (integrar = false)");
    addBullet("Parcelas marcadas como FX_PRINCIPAL (integrar = true)");

    addSubtitle("CSV Auditoria");
    addBullet("Relatório completo de auditoria com metadados");
    addBullet("Hash SHA-256 do schedule USD para verificação de integridade");
    addBullet("Status do snapshot de validação matemática");
    addBullet("Versão do engine e build ID");

    addParagraph("Importante: A exportação é bloqueada se o snapshot de validação não passar nos testes de integridade matemática.");

    // ========== 11. GLOSSÁRIO ==========
    doc.addPage();
    y = margin;
    addTitle("11. Glossário", 18);
    addDivider();

    addBullet("BACEN — Banco Central do Brasil");
    addBullet("CPC 26 — Pronunciamento Contábil sobre instrumentos financeiros (IFRS)");
    addBullet("CDI — Certificado de Depósito Interbancário (indexador referência)");
    addBullet("SELIC — Sistema Especial de Liquidação e de Custódia (taxa básica de juros)");
    addBullet("PTAX — Taxa de câmbio divulgada pelo BACEN");
    addBullet("SAC — Sistema de Amortização Constante");
    addBullet("PRICE — Sistema de Amortização Francês (prestações iguais)");
    addBullet("BULLET — Amortização única no vencimento");
    addBullet("AMERICANO — Juros periódicos com principal no vencimento");
    addBullet("CET — Custo Efetivo Total (taxa anual que reflete o custo total da operação)");
    addBullet("MIP — Seguro de Morte e Invalidez Permanente");
    addBullet("DFI — Seguro de Danos Físicos ao Imóvel");
    addBullet("IOF — Imposto sobre Operações Financeiras");
    addBullet("SD — Saldo Devedor");
    addBullet("PMT — Prestação (Payment)");
    addBullet("Resolução 4.131 — Lei de capitais estrangeiros no Brasil");

    // ========== RODAPÉ ==========
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Endividamento — Manual de Uso    |    Página ${i} de ${totalPages}`,
        margin,
        pageH - 24
      );
    }

    doc.save("Endividamento-Manual-de-Uso.pdf");
    setGenerating(false);
  };

  return (
    <div className="w-full px-4 sm:px-6 py-12">
      <Card className="border-slate-200 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-md">
              <FileText className="w-7 h-7 text-white" />
            </div>
          </div>
          <CardTitle className="text-xl font-bold text-slate-900">
            Manual de Uso — Endividamento
          </CardTitle>
          <p className="text-sm text-slate-500 mt-1">
            Gere e baixe o manual completo em PDF para enviar aos usuários
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Conteúdo do manual:</h3>
            <ul className="text-xs text-slate-600 space-y-1.5">
              <li>• Visão geral da plataforma e módulos</li>
              <li>• Calculadora de operações (passo a passo)</li>
              <li>• Gestão de contratos e workflow de aprovação</li>
              <li>• Governança (grupos, entidades e bancos)</li>
              <li>• Contabilidade — visão CPC 26</li>
              <li>• Consolidação de dívidas por grupo econômico</li>
              <li>• Indexadores (CDI, SELIC, PTAX) e feriados</li>
              <li>• Sistemas de amortização (SAC, PRICE, BULLET...)</li>
              <li>• Operações em moeda estrangeira (USD)</li>
              <li>• Exportação de relatórios CSV</li>
              <li>• Glossário de termos</li>
            </ul>
          </div>

          <div className="flex justify-center">
            <Button
              onClick={generatePDF}
              disabled={generating}
              size="lg"
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Gerando PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Baixar Manual (PDF)
                </>
              )}
            </Button>
          </div>

          <p className="text-center text-xs text-slate-400">
            O PDF será gerado localmente no seu navegador e baixado automaticamente.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}