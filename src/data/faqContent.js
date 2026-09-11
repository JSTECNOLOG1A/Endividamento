// Conteúdo do FAQ (Manual e FAQ). Curado manualmente — "mais buscados" reflete
// os temas que mais geram dúvida no dia a dia (uso do sistema) e na
// matemática por trás do motor de cálculo, não uma métrica de uso real ainda
// coletada pelo sistema.
export const FAQ_ITEMS = [
  // ===== Uso do sistema =====
  {
    id: "criar-contrato",
    category: "Uso do sistema",
    question: "Como crio um novo contrato?",
    answer:
      "Na tela de Contratos, clique em \"+ Novo Contrato\" (canto superior direito). Você entra direto na Calculadora — preencha os parâmetros do lado esquerdo e o resultado aparece do lado direito assim que clicar em \"Calcular\". Dá pra salvar como rascunho a qualquer momento ou enviar direto para aprovação.",
    popular: true,
  },
  {
    id: "importar-pdf",
    category: "Uso do sistema",
    question: "Como anexo o PDF do contrato?",
    answer:
      "Enquanto não há cálculo feito, arraste o PDF pra qualquer lugar do painel à direita da Calculadora (onde aparece \"Nenhum cálculo realizado\") ou clique nele pra escolher o arquivo. O PDF fica anexado ao rascunho e continua disponível mesmo depois de calcular — só a visualização muda, o anexo permanece.",
    popular: true,
  },
  {
    id: "status-contrato",
    category: "Uso do sistema",
    question: "O que significa cada status de um contrato?",
    answer:
      "Rascunho: em edição, ainda não foi para aprovação. Pendente: enviado para aprovação, aguardando decisão. Aprovado: aceito, gera lançamentos contábeis e títulos. Devolvido para Correção: recusado por um aprovador com um comentário — volta pra edição e, ao reenviar, fica Pendente de novo (nunca volta a ser Rascunho). Cancelado é um status à parte, usado só na renovação de Conta Garantida.",
    popular: true,
  },
  {
    id: "alcada-niveis",
    category: "Uso do sistema",
    question: "Como funciona a aprovação em 2 níveis?",
    answer:
      "Todo contrato enviado para aprovação passa por Nível 1 e depois Nível 2, nessa ordem, antes de virar Aprovado. Quem tem nível 1 só pode registrar a primeira aprovação; quem tem nível 2 registra a aprovação final (e também pode registrar o nível 1, já que nível 2 inclui o nível 1). O nível de cada usuário é configurado em Configurações → Usuários, independente do perfil (administrador/usuário/visualizador). Quem cadastrou o contrato pode aprová-lo, desde que tenha o nível necessário.",
    popular: true,
  },
  {
    id: "configurar-nivel-usuario",
    category: "Uso do sistema",
    question: "Como defino o nível de aprovação de um usuário?",
    answer:
      "Em Configurações → Usuários, edite o usuário e escolha o \"Nível de aprovação\": Nenhum, Nível 1 ou Nível 2. O proprietário da conta sempre tem nível 2, automaticamente.",
  },
  {
    id: "reabrir-contrato",
    category: "Uso do sistema",
    question: "Dá pra editar um contrato já aprovado?",
    answer:
      "Sim, usando \"Reabrir para Edição\" na tela do contrato. O proprietário reabre na hora; um administrador comum precisa que outro administrador confirme o pedido. Reabrir estorna os títulos de contas a pagar/receber gerados (e no ERP, se integrados) — eles são regerados quando o contrato for reaprovado.",
  },
  {
    id: "importar-erp",
    category: "Uso do sistema",
    question: "Como importo contas bancárias, bancos ou o plano de contas do ERP?",
    answer:
      "Em Governança → Bancos, use o botão \"Importar\" na seção de Contas Bancárias — o sistema busca as contas do ERP (Protheus) filtrando pela empresa da entidade e pelo código COMPE do banco, e mostra o que já existe, o que é novo e o que ficou sem vínculo antes de confirmar.",
  },
  {
    id: "convencao-dias",
    category: "Uso do sistema",
    question: "O que é a \"Convenção de Cálculo dos Juros Remuneratórios\"?",
    answer:
      "É a base de contagem de dias usada pra calcular o juro fixo (ou o spread, em contratos indexados): dias corridos/360, dias corridos/365, dias úteis/252 ou 30/360. Novo contrato já vem em dias corridos/360 como premissa — confira a convenção real do banco antes de aprovar. Trocar esse campo nunca muda contratos já existentes, só o contrato que você editar.",
    popular: true,
  },
  {
    id: "capitalizacao-indexador",
    category: "Uso do sistema",
    question: "O que significa \"a correção do indexador capitaliza no saldo\"?",
    answer:
      "Aparece só em contratos com indexador (CDI/SELIC). \"Entra na parcela paga\" (padrão) cobra indexador e spread juntos no boleto. \"Fica dentro da dívida (capitaliza)\" cobra só o spread no boleto e soma a correção do indexador ao saldo devedor, quitada junto com o principal — é o comportamento usado por alguns bancos.",
    popular: true,
  },
  {
    id: "liberacao-vs-operacao",
    category: "Uso do sistema",
    question: "Qual a diferença entre \"Data de Liberação\" e \"Data da Operação\"?",
    answer:
      "Data de Liberação é quando o recurso efetivamente caiu na conta — é essa data que o motor usa pra contar dias e calcular juros. Data da Operação é a data de emissão/assinatura do contrato, só informativa, útil quando ela é diferente da liberação (comum em operações onde o desembolso leva alguns dias após a assinatura).",
  },
  {
    id: "fechamento-contabil",
    category: "Uso do sistema",
    question: "Como funciona o fechamento contábil?",
    answer:
      "Em Contabilidade → Fechamento, escolha a competência e o sistema reconcilia cada contrato aprovado (juros apropriados, pagamentos, variação cambial se houver) contra a matriz de eventos contábeis (Lógica Contábil) e a conta bancária vinculada, gerando o lançamento pra revisão antes de aprovar o período.",
  },
  {
    id: "importar-indexadores",
    category: "Uso do sistema",
    question: "Como importo CDI, SELIC, PTAX ou feriados?",
    answer:
      "Em Indexadores e Feriados, cada aba (CDI/SELIC, PTAX USD, Feriados) tem um botão de importação por CSV, ou pode ser feito automaticamente via tarefa agendada em Configurações → Agendamento.",
  },

  // ===== Matemática financeira =====
  {
    id: "o-que-e-cet",
    category: "Matemática financeira",
    question: "O que é CET (Custo Efetivo Total)?",
    answer:
      "É a taxa anual que resume o custo real da operação pro tomador, incluindo juros, IOF, tarifas e outros encargos — calculada via TIR (Taxa Interna de Retorno) do fluxo de pagamentos e depois anualizada por capitalização composta.",
    popular: true,
  },
  {
    id: "sac-vs-price",
    category: "Matemática financeira",
    question: "Qual a diferença entre SAC e PRICE?",
    answer:
      "SAC amortiza o principal em fatias iguais a cada parcela — como o saldo devedor cai mais rápido, os juros diminuem e a prestação também, ao longo do tempo. PRICE mantém a prestação fixa do início ao fim: no começo a maior parte é juro, e a fatia de amortização cresce aos poucos.",
    popular: true,
  },
  {
    id: "capitalizacao-composta",
    category: "Matemática financeira",
    question: "O que é capitalização composta e por que o sistema sempre usa isso?",
    answer:
      "É juro sobre juro: cada período aplica a taxa sobre o saldo já corrigido pelo período anterior, não sobre o valor original. É o padrão do mercado financeiro brasileiro (e da regra imutável do motor pra combinar indexador e spread) — a diferença pra uma soma simples de taxas cresce bastante em prazos longos ou taxas altas.",
  },
  {
    id: "price-prestacao-fixa",
    category: "Matemática financeira",
    question: "Por que a prestação do PRICE às vezes variava e agora fica fixa?",
    answer:
      "O PRICE prefixado (sem indexador) usa uma contagem de 30 dias fixos por parcela em vez dos dias corridos reais entre vencimentos — que variam de 28 a 33 dias por causa de fins de semana e feriados empurrando a data. Usar dias corridos reais fazia a taxa do período oscilar levemente e a prestação \"balançar\"; com 30 dias fixos, a prestação fica constante, batendo com a metodologia bancária padrão.",
  },
  {
    id: "base-360-365-252",
    category: "Matemática financeira",
    question: "Qual a diferença entre base 360, 365 e 252?",
    answer:
      "360 e 365 contam dias corridos (incluindo fins de semana) divididos por essa base anual — bancos usam uma ou outra dependendo da convenção contratual. 252 conta só dias úteis, e é a convenção de mercado do CDI e da SELIC especificamente — isso nunca muda, mesmo quando você escolhe outra base pro spread do contrato.",
    popular: true,
  },
  {
    id: "como-cdi-e-calculado",
    category: "Matemática financeira",
    question: "Como o sistema calcula o fator do CDI?",
    answer:
      "Multiplica o fator diário de cada dia útil do período (fator = (1 + taxa do dia)^(1/252)) — não uma taxa média do período elevada a dias/252. Isso reproduz corretamente até variações de taxa dia a dia dentro do mesmo período.",
  },
  {
    id: "americano-vs-bullet",
    category: "Matemática financeira",
    question: "Qual a diferença entre AMERICANO e BULLET?",
    answer:
      "BULLET paga tudo — principal e juros — de uma vez só, no vencimento final, sem nada no meio do caminho. AMERICANO paga os juros periodicamente (mensal, trimestral etc.) ao longo do contrato, e só o principal fica pra pagar inteiro no final.",
  },
  {
    id: "o-que-e-iof",
    category: "Matemática financeira",
    question: "O que é o IOF na operação e como ele entra no cálculo?",
    answer:
      "É o Imposto sobre Operações Financeiras, cobrado por lei sobre o crédito. No cadastro, você informa o valor do IOF e escolhe se ele é financiado (somado ao principal, aumentando o valor total financiado) ou cobrado à parte, fora do saldo que gera juros.",
  },
  {
    id: "variacao-cambial",
    category: "Matemática financeira",
    question: "Como funciona a variação cambial em contratos USD?",
    answer:
      "Na visão contábil (CPC 26), o saldo em USD é convertido pela PTAX de fechamento de cada período de competência. O Ajuste Cambial é o saldo inicial em USD multiplicado pela diferença entre a PTAX atual e a anterior — reconhecido mês a mês, independente de quando a parcela é efetivamente paga.",
  },
  {
    id: "mora-multa-manual",
    category: "Matemática financeira",
    question: "Por que mora e multa não são calculadas automaticamente?",
    answer:
      "Cada banco tem sua própria fórmula e critério de truncamento/arredondamento pra mora e multa, e isso ainda não foi parametrizado no motor. Hoje esses valores são digitados manualmente na baixa do pagamento — é um cálculo auxiliar planejado, ainda não implementado.",
  },
  {
    id: "flat-e-tarifas",
    category: "Matemática financeira",
    question: "O que é a Taxa Flat e como ela afeta o valor financiado?",
    answer:
      "É uma tarifa cobrada na liberação do recurso, calculada como percentual sobre o valor do crédito — remunera o banco por assessoria/estruturação da operação. Se marcada como \"financiada\", o valor da Flat é somado ao principal (aumentando o Valor Total Financiado); senão, é descontada à parte na liberação.",
  },
];

export const FAQ_CATEGORIES = [...new Set(FAQ_ITEMS.map((item) => item.category))];
