// Conteúdo único do Manual — usado tanto pela visualização em tela
// (ManualPanel, em UserManual.jsx) quanto pela geração do PDF (generatePDF).
// Mudou o texto? Muda só aqui — as duas visualizações leem a mesma fonte.
//
// Tipos de bloco:
//   p     — parágrafo corrido
//   h     — subtítulo dentro da seção
//   ul    — lista com marcadores
//   ol    — passo a passo numerado
//   tip   — dica (caixa de destaque neutra)
//   warn  — atenção (caixa de destaque de alerta)
export const MANUAL_SECTIONS = [
  {
    id: "primeiros-passos",
    title: "1. Primeiros Passos",
    intro:
      "Como se orientar na plataforma antes de criar o primeiro contrato: login, navegação e a diferença entre Grupo Econômico e Empresa.",
    blocks: [
      { type: "h", text: "Login e sessão" },
      {
        type: "ol",
        items: [
          "Acesse a URL do sistema e entre com seu e-mail e senha cadastrados.",
          "Se sua sessão expirar (fica muito tempo sem usar), o sistema devolve você pra tela de login sozinho — é só entrar de novo, nenhum dado se perde.",
          "Esqueceu a senha? Use o link \"Esqueci a senha\" na tela de login.",
        ],
      },
      { type: "h", text: "A barra lateral" },
      {
        type: "p",
        text:
          "Do lado esquerdo fica a navegação principal: Contratos, Contas Garantidas, Governança, Contabilidade, Consolidação, Financeiro, Indexadores e Feriados, Manual e FAQ, e Configurações. Alguns itens (Governança, Financeiro, Configurações) abrem um submenu ao clicar.",
      },
      {
        type: "tip",
        text:
          "Não existe mais um item \"Calculadora\" separado na barra lateral — pra criar um contrato novo, use o botão \"+ Novo Contrato\" dentro da tela de Contratos.",
      },
      { type: "h", text: "Grupo Econômico x Entidade" },
      {
        type: "p",
        text:
          "Grupo Econômico é a holding/estrutura que agrupa uma ou mais Entidades (empresas ou pessoas físicas). No canto inferior da barra lateral, os seletores \"Trocar empresa\" e \"Grupo econômico\" controlam qual grupo você está olhando — todo relatório, contrato e cadastro é filtrado por esse grupo selecionado ali.",
      },
      {
        type: "warn",
        text:
          "Antes de cadastrar qualquer coisa nova, confira qual Grupo Econômico está selecionado — cadastrar no grupo errado é a causa mais comum de \"sumiu da tela\" (na verdade está lá, só que dentro de outro grupo).",
      },
    ],
  },

  {
    id: "criar-contrato",
    title: "2. Criando um Contrato do Zero",
    intro:
      "O passo a passo completo, desde clicar em \"Novo Contrato\" até enviar para aprovação.",
    blocks: [
      { type: "h", text: "Passo a passo" },
      {
        type: "ol",
        items: [
          "Na tela de Contratos, clique em \"+ Novo Contrato\" (canto superior direito, acima dos cartões de resumo).",
          "Você entra na Calculadora com o formulário à esquerda e, à direita, uma área vazia — arraste o PDF do contrato pra ali se já tiver o documento em mãos (ele fica visível na tela, lado a lado com o formulário, pra você copiar os dados direto de lá).",
          "Seção 1 — Identificação: escolha o Grupo Econômico, a Entidade Componente, o Banco Credor e o Nº do Contrato. Se o desembolso cai numa conta específica, selecione em \"Conta Bancária de Liberação\" (aparece depois de escolher o banco).",
          "Escolha a Categoria da Operação (Empréstimos, Financiamentos, Mútuos com Partes Relacionadas ou com Terceiros), o Tipo Específico e as garantias (real e pessoal), se houver.",
          "Seção 2 — Composição e Remuneração: informe o Valor da Operação, sinal do negócio, IOF, ECG e taxas diversas (e se cada um é financiado, ou seja, somado ao principal).",
          "Preencha a Data de Liberação (quando o recurso caiu na conta — é ela que conta pro cálculo) e, se for diferente, a Data da Operação (emissão/assinatura, só informativa).",
          "Informe a Taxa Fixa (% a.a.) e o Indexador (N/A, CDI ou SELIC). Se usar indexador, aparecem o Spread e a opção de capitalização — veja a seção \"Indexador, spread e capitalização\" abaixo.",
          "Confira a Convenção de Cálculo dos Juros Remuneratórios — vem pré-marcada em \"Dias corridos / 360\", mas verifique a metodologia real do banco antes de aprovar.",
          "Escolha o Sistema de Amortização (PRICE, SAC, SACRE, Americano, Bullet ou % Residual) — a descrição de cada um aparece embaixo do campo.",
          "Seção 3 — Prazos: defina o prazo total, a data de vencimento final (ou deixe calcular sozinho), o primeiro vencimento, carências e a periodicidade de amortização/juros.",
          "Clique em \"Calcular\" — a área da direita troca de PDF/mensagem vazia pra tabela de amortização completa, com os cartões de resumo (Valor Total Financiado, Total de Juros, Total de Prestações, CET Anual, Nº de Parcelas) no topo.",
          "Revise a Memória de Cálculo. Se algo estiver errado, ajuste o formulário e clique em \"Recalcular contrato\".",
          "Clique em \"Salvar como Rascunho\" pra guardar sem enviar pra aprovação ainda, ou \"Enviar para Revisão\" pra já mandar pro fluxo de aprovação.",
        ],
      },
      { type: "h", text: "Indexador, spread e capitalização" },
      {
        type: "p",
        text:
          "Quando o Indexador é CDI ou SELIC, dois campos novos aparecem: o Spread (taxa fixa somada ao indexador) e \"O que acontece com a correção do indexador a cada vencimento?\" — com duas opções.",
      },
      {
        type: "ul",
        items: [
          "\"Entra na parcela paga\" (padrão): o boleto de cada vencimento já cobra indexador e spread juntos, no mesmo valor.",
          "\"Fica dentro da dívida (capitaliza)\": só o spread é cobrado no boleto; a correção do indexador se soma ao saldo devedor e é quitada junto com o principal, no vencimento final.",
        ],
      },
      {
        type: "tip",
        text:
          "Se o extrato do banco mostrar uma parcela bem menor do que o esperado num contrato indexado, é bem provável que o banco use o modelo de capitalização — vale conferir essa opção antes de aprovar.",
      },
      { type: "h", text: "Datas de vencimento fora do padrão" },
      {
        type: "p",
        text:
          "Depois de calcular, use \"Editar Datas\" na Memória de Cálculo pra ajustar manualmente qualquer vencimento — útil quando o cronograma real do banco não é perfeitamente mensal/trimestral (ex.: um último período mais longo que os outros).",
      },
    ],
  },

  {
    id: "aprovacao",
    title: "3. Fluxo de Status e Aprovação em 2 Níveis",
    intro: "Como um contrato caminha de Rascunho até Aprovado, e quem pode aprovar o quê.",
    blocks: [
      { type: "h", text: "Os status possíveis" },
      {
        type: "ul",
        items: [
          "Rascunho — em edição, salvo automaticamente no navegador. É um estado temporário: depois do primeiro envio pra aprovação, o contrato nunca mais volta a ser Rascunho.",
          "Pendente — enviado, aguardando decisão de aprovação.",
          "Aprovado — aceito, pronto pra gerar títulos e entrar na contabilidade.",
          "Devolvido para Correção — recusado por um aprovador com um comentário obrigatório; volta pra edição e, ao reenviar, fica Pendente de novo (nunca Rascunho).",
        ],
      },
      { type: "h", text: "Como funciona a alçada de 2 níveis" },
      {
        type: "ol",
        items: [
          "Todo contrato Pendente precisa passar por uma aprovação de Nível 1 e depois uma de Nível 2, nessa ordem, antes de virar Aprovado.",
          "Quem tem Nível 1 vê e clica em \"Aprovar Nível 1\" — o status continua Pendente, só fica marcado quem e quando aprovou o primeiro nível.",
          "Depois do Nível 1 feito, aparece \"Aprovar (Nível 2 — final)\" pra quem tem Nível 2 — aí sim o contrato vira Aprovado.",
          "Quem tem Nível 2 também pode registrar sozinho o Nível 1 (nível 2 inclui o nível 1) — ou seja, uma pessoa com nível 2 pode aprovar um contrato inteiro, nos dois cliques, se não tiver ninguém de nível 1 disponível.",
          "Quem cadastrou o contrato pode aprová-lo (em qualquer nível), desde que tenha o nível necessário — o controle é o nível do usuário, não quem criou o contrato.",
        ],
      },
      {
        type: "tip",
        text:
          "O nível de cada usuário é configurado em Configurações → Usuários, no campo \"Nível de aprovação\" (Nenhum / Nível 1 / Nível 2) — é independente do Perfil de acesso (administrador/usuário/visualizador). O proprietário da conta sempre tem nível 2, automaticamente.",
      },
      { type: "h", text: "Devolver um contrato" },
      {
        type: "p",
        text:
          "Qualquer pessoa com nível 1 ou 2 pode devolver um contrato Pendente, em qualquer um dos dois estágios de aprovação, desde que escreva um comentário explicando o motivo — o comentário é obrigatório e fica registrado.",
      },
      { type: "h", text: "Reabrir um contrato já aprovado" },
      {
        type: "p",
        text:
          "Use \"Reabrir para Edição\" na tela do contrato aprovado. O proprietário da conta reabre na hora; um administrador comum precisa que outro administrador confirme o pedido antes de reabrir de fato. Reabrir estorna os títulos de contas a pagar/receber já gerados (e no ERP, se integrado) — eles são regerados quando o contrato for reaprovado.",
      },
    ],
  },

  {
    id: "governanca",
    title: "4. Governança — Grupos, Entidades, Bancos e Contas",
    intro: "Onde fica a estrutura organizacional que todo contrato depende.",
    blocks: [
      { type: "h", text: "Ordem recomendada de cadastro" },
      {
        type: "ol",
        items: [
          "Grupos Econômicos — a holding/estrutura de topo.",
          "Entidades Componentes — as empresas (CNPJ) ou pessoas físicas (CPF) dentro do grupo. Se a entidade for integrada ao ERP, preencha o código Protheus dela.",
          "Bancos — cadastre a instituição financeira com o código COMPE correto (é ele que casa com o banco na importação de contas do ERP).",
          "Contas Bancárias — vinculadas a um Banco + uma Entidade. Podem ser cadastradas manualmente ou importadas do ERP.",
          "Plano de Contas e Naturezas — usados pela Lógica Contábil (Configurações → Lógica Contábil) pra saber em que conta contábil lançar cada evento.",
        ],
      },
      { type: "h", text: "Importar contas bancárias do ERP" },
      {
        type: "ol",
        items: [
          "Em Governança → Bancos, clique no ícone de carteira ao lado do banco desejado (ou use \"Ver contas\") pra abrir a lista de Contas Bancárias daquele banco.",
          "Clique em \"Importar\" — o sistema busca no ERP (Protheus) as contas daquele banco, filtrando pela empresa configurada em cada Entidade.",
          "A lista mostra o que já está cadastrado, o que é novo e o que ficou sem vínculo (empresa ou banco não encontrado no FinCalc) — marque as contas que quer trazer e confirme.",
          "Depois de importada, abra a conta e confira o campo \"Conta Contábil\" — muitas vezes ele já vem preenchido automaticamente (o sistema tenta casar o código vindo do ERP com o Plano de Contas); se não vier, selecione manualmente.",
        ],
      },
      {
        type: "warn",
        text:
          "Só entram na importação contas cuja empresa (da Entidade) e cujo código COMPE (do Banco) já estejam cadastrados corretamente no FinCalc — confira esses dois cadastros primeiro se uma conta não aparecer.",
      },
    ],
  },

  {
    id: "contabilidade",
    title: "5. Contabilidade e Fechamento (CPC 26)",
    intro: "Como o sistema gera os lançamentos contábeis dos contratos aprovados.",
    blocks: [
      { type: "h", text: "Lógica Contábil (a matriz de eventos)" },
      {
        type: "p",
        text:
          "Em Configurações → Lógica Contábil fica a matriz que define, por empresa e por tipo de evento (liberação, juros apropriados, pagamento de principal, pagamento de juros, IOF, tarifas, reclassificações etc.), qual conta contábil de débito e qual de crédito usar. Só contas analíticas (não sintéticas) podem ser escolhidas ali.",
      },
      {
        type: "tip",
        text:
          "Pra liberação e pagamentos (principal e juros), se a conta bancária do contrato tiver uma \"Conta Contábil\" vinculada (ver seção de Governança), essa conta específica é usada no lugar da conta padrão da matriz — sem precisar mexer na matriz pra cada banco.",
      },
      { type: "h", text: "Rodando o fechamento" },
      {
        type: "ol",
        items: [
          "Acesse Contabilidade → Fechamento e escolha a competência (mês/ano) e o grupo/entidade.",
          "O sistema reconcilia cada contrato aprovado daquele período: juros apropriados, pagamentos registrados nas baixas, variação cambial (se houver) e reclassificações de longo pra curto prazo.",
          "Revise o lançamento gerado — dá pra ver a composição de cada linha antes de aprovar o fechamento do período.",
          "Aprove o fechamento. Um período fechado e aprovado exige justificativa de administrador pra ser reaberto.",
        ],
      },
      { type: "h", text: "Registrando uma baixa (pagamento de parcela)" },
      {
        type: "p",
        text:
          "Na tela de Fechamento Contábil, ao dar baixa numa parcela, selecione a Conta Bancária usada no pagamento — é esse campo que alimenta o roteamento de conta contábil descrito acima, então vale sempre preencher.",
      },
    ],
  },

  {
    id: "consolidacao",
    title: "6. Consolidação de Dívidas",
    intro: "Visão agregada de todas as operações de um grupo econômico.",
    blocks: [
      {
        type: "p",
        text:
          "A tela de Consolidação soma automaticamente todos os contratos aprovados do grupo econômico selecionado, agrupando por entidade e por banco credor, e separa o total de principal entre curto prazo (até 12 meses) e longo prazo (acima de 12 meses).",
      },
      {
        type: "tip",
        text:
          "Não existe cadastro nessa tela — é só leitura, sempre recalculada a partir dos contratos aprovados. Se um número parecer errado, o problema está no contrato de origem, não na consolidação em si.",
      },
    ],
  },

  {
    id: "indexadores",
    title: "7. Indexadores e Feriados",
    intro: "Como manter CDI, SELIC, PTAX e o calendário de feriados atualizados.",
    blocks: [
      { type: "h", text: "Importação manual" },
      {
        type: "ol",
        items: [
          "Acesse Indexadores e Feriados e escolha a aba: CDI/SELIC, PTAX USD ou Feriados.",
          "Use o botão de importação e selecione o arquivo CSV com o histórico desejado.",
          "O sistema mostra quantos registros foram criados e quantos já existiam (atualizados), sem duplicar.",
        ],
      },
      { type: "h", text: "Importação automática" },
      {
        type: "p",
        text:
          "Em Configurações → Agendamento dá pra cadastrar uma tarefa recorrente que busca as taxas mais recentes direto do Banco Central, sem precisar importar CSV manualmente toda semana. A mesma tela permite rodar a tarefa manualmente a qualquer momento, fora do horário agendado.",
      },
      {
        type: "warn",
        text:
          "O CDI é calculado como produto dos fatores diários (dia útil por dia útil), não como uma taxa média do período — por isso é importante que o histórico não tenha lacunas nos dias em que o contrato precisa calcular.",
      },
    ],
  },

  {
    id: "amortizacao",
    title: "8. Sistemas de Amortização, na Prática",
    intro: "O que muda de verdade entre PRICE, SAC, SACRE, Americano, Bullet e % Residual.",
    blocks: [
      {
        type: "ul",
        items: [
          "SAC — Amortização Constante: a fatia de principal é igual em toda parcela; como o saldo cai mais rápido, os juros e a prestação diminuem mês a mês.",
          "PRICE — Prestação Constante: a prestação é igual do início ao fim; no começo é quase tudo juro, e a fatia de principal cresce aos poucos até o final.",
          "SACRE — Amortização Crescente: uma variação do SAC usada por alguns bancos, com reajustes periódicos da prestação.",
          "Americano: só juros são pagos periodicamente; o principal inteiro é pago de uma vez, no vencimento final.",
          "Bullet: nem juros nem principal são pagos no meio do caminho — tudo é liquidado de uma vez, no vencimento final.",
          "% Residual: a amortização segue percentuais definidos livremente pelo usuário (ex.: 24,18%, 28,09%, 32,72%...), aplicados sobre o saldo devedor ou sobre o principal original.",
        ],
      },
      {
        type: "tip",
        text:
          "Se a prestação calculada estiver \"balançando\" um pouco em cada mês num contrato PRICE prefixado, isso é normal e proposital: o motor usa uma contagem fixa de 30 dias por parcela justamente pra manter a prestação constante, seguindo a metodologia bancária padrão.",
      },
    ],
  },

  {
    id: "moeda-estrangeira",
    title: "9. Operações em Moeda Estrangeira (USD)",
    intro: "As duas visões de um contrato em dólar: fluxo de caixa e visão contábil (CPC 26).",
    blocks: [
      { type: "h", text: "Visão Financeira (fluxo de caixa)" },
      {
        type: "p",
        text:
          "Converte cada parcela de USD para BRL usando a PTAX do momento do pagamento — é a visão de \"quanto eu realmente vou pagar em reais naquele dia\".",
      },
      { type: "h", text: "Visão Contábil (competência)" },
      {
        type: "p",
        text:
          "Reconhece a variação cambial mês a mês, mesmo sem pagamento naquele mês, usando a PTAX de fechamento do período. O Ajuste Cambial é o saldo inicial em USD multiplicado pela diferença entre a PTAX atual e a anterior.",
      },
      {
        type: "tip",
        text:
          "A Defasagem PTAX (D, D-1 ou D-2) configura se o sistema usa a cotação do próprio dia do pagamento ou de um ou dois dias úteis antes — confira qual seu banco realmente usa antes de aprovar um contrato em USD.",
      },
    ],
  },

  {
    id: "exportacao",
    title: "10. Exportação de Relatórios",
    intro: "Os formatos de CSV disponíveis para contratos em moeda estrangeira.",
    blocks: [
      {
        type: "ul",
        items: [
          "CSV Financeiro — tabela completa em visão de fluxo de caixa, em USD e BRL.",
          "CSV Contábil — visão CPC 26, com PTAX anterior/atual, ajuste cambial e reconciliação.",
          "CSV Auditoria — relatório com hash de integridade, versão do motor de cálculo e status da validação matemática.",
        ],
      },
      {
        type: "warn",
        text:
          "A exportação é bloqueada se o snapshot de validação do contrato não passar nos testes de integridade matemática — nesse caso, reabra e recalcule o contrato antes de exportar.",
      },
    ],
  },

  {
    id: "configuracoes",
    title: "11. Configurações",
    intro: "Usuários, integrações, parâmetros e agendamento — tudo que é \"por empresa\", não por contrato.",
    blocks: [
      { type: "h", text: "Usuários" },
      {
        type: "p",
        text:
          "Convide pessoas por e-mail — elas recebem um link pra criar a própria senha. Além do Perfil de acesso (administrador/usuário/visualizador), defina o Nível de aprovação de cada uma (ver seção 3).",
      },
      { type: "h", text: "Integrações" },
      {
        type: "p",
        text:
          "Configuração da conexão REST com o ERP (Protheus): URL, autenticação e quais endpoints alimentam cada cadastro (contas bancárias, naturezas, plano de contas etc.).",
      },
      { type: "h", text: "Parâmetros" },
      {
        type: "p",
        text: "Comportamento geral da empresa: layout, aparência e parâmetros financeiros padrão.",
      },
      { type: "h", text: "Agendamento" },
      {
        type: "p",
        text:
          "Cadastre tarefas recorrentes (buscar CDI/SELIC/PTAX, converter títulos etc.) escolhendo o dia ou intervalo de execução — e rode manualmente quando quiser, sem esperar o horário agendado.",
      },
      { type: "h", text: "Log de Atividades" },
      {
        type: "p",
        text:
          "Todo cadastro, alteração e exclusão fica registrado aqui, com usuário, data/hora e o que mudou (de/para) — útil pra investigar qualquer dúvida sobre \"quem mexeu nisso\".",
      },
    ],
  },

  {
    id: "glossario",
    title: "12. Glossário",
    intro: "Termos usados na plataforma, em ordem alfabética.",
    blocks: [
      {
        type: "ul",
        items: [
          "AMERICANO — sistema com juros periódicos e principal pago de uma vez no vencimento.",
          "BACEN — Banco Central do Brasil.",
          "CDI — Certificado de Depósito Interbancário, indexador de referência do mercado, calculado em dias úteis (base 252).",
          "CET — Custo Efetivo Total: taxa anual que resume todo o custo da operação (juros, IOF, tarifas etc.).",
          "COMPE — código numérico que identifica um banco no sistema financeiro (ex.: 001 Banco do Brasil).",
          "CPC 26 — pronunciamento contábil brasileiro equivalente às normas internacionais (IFRS) sobre demonstrações financeiras.",
          "DFI — Seguro de Danos Físicos ao Imóvel.",
          "IOF — Imposto sobre Operações Financeiras.",
          "MIP — Seguro de Morte e Invalidez Permanente.",
          "PMT — sigla de \"payment\", o valor da prestação.",
          "PRICE — sistema de amortização com prestação fixa (também chamado de Sistema Francês).",
          "PTAX — taxa de câmbio de referência divulgada pelo Banco Central.",
          "SAC — Sistema de Amortização Constante (fatia de principal igual em toda parcela).",
          "SD — Saldo Devedor.",
          "SELIC — taxa básica de juros da economia brasileira.",
          "Spread — taxa adicional somada a um indexador (ex.: CDI + spread).",
        ],
      },
    ],
  },
];
