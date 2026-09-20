# Decisões da implantação de saldos (registro)

Data: 19/09/2026. Complementa `PLANO-VIRADA-DE-SALDOS.md` (v9).

| Decisão | Resultado |
|---|---|
| D6 — quem contabiliza a baixa bancária | **Protheus** contabiliza a baixa bancária; o AllDebt contabiliza tudo o que é competência (abertura, juros, capitalização, reclassificação, variação cambial, custos) e **não exporta lançamento de pagamento**. Para o passivo baixar, os títulos gerados pelo AllDebt levam a conta contábil do passivo do AllDebt (parâmetros de conta dos títulos, em Configurações → Lógica Contábil) |
| D7 — início da baixa efetiva | **Uma data por cliente**, parâmetro `accounting.settlement_required_from` (AAAA-MM-DD; vazio = regra antiga). Parcelas anteriores não mudam; fechamentos aprovados nunca mudam. Valor sugerido para o Grupo Cangaia: 01/09/2026 (a definir na tela) |
| D8 — custo de transação | **Reconhecido no ato da operação**, cada verba na sua conta (IOF na conta do IOF; demais taxas na conta de custo de transação). Sem apropriação mensal. **Política única da ferramenta**, não por empresa |
| Piloto | Contrato 2915274241, Grupo Cangaia; o responsável do projeto assina a conciliação |

## O que foi implementado (T0 a T3)

- **T0** — carga de feriados nacionais 2020–2033 (178 datas, validada contra a BrasilAPI e contra cálculo independente) e simulação de impacto nos contratos de produção, **sem gravar nada** (`T0-calendario/`).
- **T1** — fechamento com juros por competência, liberação/IOF/custo na data da operação, evento de capitalização de juros, chaves de idempotência de evento (`accountingClosing.js` e `closingEngine.js`; teste: `npm run test:closing`).
- **T2** — regra de baixa efetiva por cliente; baixa manual em Contas a Pagar (parcial ou total); baixa manual entra nas baixas derivadas do fechamento automático.
- **T3** — marca de implantação por contrato, geração de títulos filtrada, retenção da integração automática, bloqueio de fechamento até a data de corte.

Nada disso muda o comportamento de contratos e clientes existentes até ser ativado: a regra de baixa depende do parâmetro (vazio por padrão) e a implantação depende da marca no contrato.

## Limitações conhecidas

- Contratos em moeda estrangeira: o saldo de principal do fechamento não incorpora a variação cambial acumulada (já era assim); o teste de saldo zerado no fim do contrato não cobre USD.
- Juros por competência usam rateio linear por dias corridos dentro de cada período do cronograma.

## T7 — Tela de Implantação de Saldos (Configurações → Implantação de Saldos)

- Por entidade: data-base (validada como último dia do mês), início da competência no AllDebt (virada), cinco contas (passivo de principal circulante e não circulante, juros a pagar circulante e não circulante, transitória) e prévia da posição de cada contrato, com marcação das parcelas vencidas em aberto.
- Fluxo: **rascunho → aprovada → aplicada**. Aprovar congela a **fotografia da posição** (contas, datas, parcelas em aberto, valores e parâmetros) e trava a edição; reabrir descarta a fotografia; aplicar marca os contratos (T3) sem excluir, recriar nem lançar nada.
- Posição (`deploymentPosition.js`): principal total = movimentos efetivos (parcela até a data-base conta como paga, exceto as marcadas em aberto), com vencido no circulante; circulante = vence até a data-base + 12 meses; juros apropriados pro rata até a data-base. Testes: `npm run test:deployment`.
- Prévia do lançamento de abertura: Débito na transitória; Crédito nas quatro contas de passivo. **O lançamento em si é a T8**; a troca no Protheus é a T9.
- Limitação: contratos em moeda estrangeira mostram posição indicativa (aviso na tela).

## USD no fechamento e T8 (lançamento de abertura)

**Contratos em moeda estrangeira.** O fechamento agora usa o bloco contábil em reais de cada linha do cronograma (juros pagos, juros capitalizados, amortização e variação cambial), e a variação cambial acumulada entra no principal em reais. Antes, `jurosPagos` e `jurosCapitalizados` (em USD) eram somados como reais, e o saldo não fechava em zero. Teste: 3 casos em USD (PTAX constante, PTAX oscilando, capitalização periódica) em `npm run test:closing`; principal e juros a pagar fecham em zero no fim. O campo `fx` do fechamento continua sendo o acumulado informativo (já incluído no principal).

**Pagamento no mês da data real.** Parcela paga em atraso agora gera o evento de pagamento no mês de `actual_payment_date` da baixa (e o saldo só cai nesse mês), não no mês da parcela.

**T8 — lançamento de abertura, sem tela nova de lançamento:**
- A abertura entra no **Fechamento Contábil da competência da virada** (manual e automático): um lançamento por contrato, Débito na conta transitória, Crédito nas quatro contas de passivo, com os valores da fotografia aprovada e chave de idempotência por linha. Aprovar o fechamento é o que a lança.
- Parcelas informadas como vencidas em aberto continuam devidas depois da virada e viram pendência até existir baixa; o saldo de abertura do primeiro fechamento é igual à posição aprovada (teste automático).
- **Conciliação da transitória** (Implantação de Saldos, depois de aplicada): fotografia × lançado × espelho do sistema antigo. Estados: aguardando lançamento, aguardando espelho, conciliada (transitória zerada) e divergente (com a lista de problemas: valor diferente, duplicidade, conta errada, débitos ≠ créditos).

## Financeiro da implantação (substitui a T9)

Decisão (19/09/2026): **sem T9**. Os títulos antigos dos empréstimos são excluídos no Protheus pelo próprio usuário; **só os títulos que o AllDebt cria** (e integra) têm retorno de baixa ("paga lá, baixa aqui"). Fluxo:
1. Excluir no Protheus os títulos antigos desses empréstimos (mapeamento a cargo do usuário; lista dos títulos do AllDebt exportada em `titulos_piloto.csv`).
2. Em Implantação de Saldos → "Títulos no financeiro": confirmar a exclusão e **liberar** os títulos retidos; integrar pela tela de Contas a Pagar (integração existente).
3. Pagar no Protheus; a consulta ao ERP (manual ou pelo Agendamento) traz a baixa **com a data real**; o fechamento atribui o pagamento ao mês dessa data. Baixa manual em Contas a Pagar continua valendo para o que não tiver retorno.

Ajustes feitos: retorno da baixa guarda data e origem (`baixa_data`, `baixa_origem`); baixas derivadas incluem parcelas pagas em atraso (sem limite inferior de vencimento) e usam a data real; parcela do título ("013") e do cronograma (13) passam a casar (o vínculo não funcionava para baixas derivadas); "Aplicar" é recusado se o fechamento da competência da virada já estiver aprovado; recusa do Protheus por tipo de título (E2_TIPO) mostra o que fazer (cadastrar o tipo na SX5, tabela 05, ou ajustar Parâmetros → Financeiro). Teste ponta a ponta do fechamento automático postando a abertura passou (idempotente).

## Posição em USD pela PTAX da data-base

Contrato em moeda estrangeira: a posição de abertura é apurada em USD (cronograma em moeda, sem o bloco contábil em reais) e convertida pela **PTAX da data-base** — cotação mais recente até a data-base (fim de semana/feriado usa a anterior), no máximo 7 dias de defasagem. O passivo em moeda estrangeira é remensurado na data de fechamento; a PTAX das linhas do cronograma deixa de ser usada aqui.
- Sem PTAX até 7 dias antes da data-base: a prévia sinaliza "sem PTAX da data-base" e a **aprovação é recusada** até cadastrar a cotação em Moedas.
- A fotografia aprovada guarda moeda, PTAX, data da PTAX e a posição em moeda (`positionForeign`).
- Testes: 7 casos USD em `npm run test:deployment`.
- **Ajuste cambial da virada (USD).** A abertura é lançada pela PTAX da data-base, mas o motor mede a variação cambial da virada a partir da PTAX das próprias linhas do cronograma. A diferença entre os dois pontos de partida vira um evento de variação cambial (`implantacao-cambial`) na competência da virada; sem ele o passivo lançado ficava distante do saldo apurado (achado na simulação com contrato USD no Cangaia local: R$ 11.000 = saldo em USD × diferença de PTAX). Vale só para contrato em moeda estrangeira; a matriz precisa ter as contas de variação cambial (ativa/passiva).
- Fechamento da competência da virada só aprova se as competências anteriores da entidade estiverem aprovadas (regra já existente do fechamento).

## Contas da abertura por categoria (empréstimos x financiamentos)

A abertura não usa mais um único par circulante/não circulante para todos os contratos. Cada categoria de operação presente nos contratos da empresa (empréstimos, financiamentos, mútuos...) tem quatro contas de passivo: principal circulante, principal não circulante, juros a pagar circulante e juros a pagar não circulante. A conta transitória continua única.
- Cada contrato é lançado nas contas da sua categoria (`operation_category`); o lançamento de abertura, a conciliação e o razão seguem essa classificação.
- As contas vêm sugeridas pela Lógica Contábil: na matriz, a reclassificação circulante/não circulante de cada categoria já tem as contas (débito = não circulante, crédito = circulante), do principal e dos juros. A tela preenche as vazias e há o botão "Preencher pela Lógica Contábil" por categoria.
- A aprovação exige as quatro contas de cada categoria presente, todas analíticas e diferentes da transitória; circulante e não circulante (do principal e dos juros) devem ser contas diferentes, mas principal e juros podem usar a mesma conta de passivo (comum, e é o caso do Cangaia: juros apropriados e principal circulante na mesma conta). As contas ficam congeladas na fotografia (`contas.categorias`).
- Configurações antigas (quatro colunas únicas) continuam valendo para a categoria sem contas próprias. Migration 069 (`category_accounts`).

## Baixa efetiva como regra padrão do fechamento (pagamento só lança se foi baixado)

O pagamento de principal e juros só gera lançamento quando a parcela foi realmente baixada no Contas a Pagar — baixa manual ou retorno do ERP (API). Juros apropriados, reclassificação, capitalização e variação cambial de provisão continuam automáticos (são da competência).
- **Regra padrão** (`settlementRule.js`): parâmetro `accounting.settlement_required_from` preenchido vale como data de início; vazio, a baixa efetiva vale desde o início. Empresas que já tinham fechamento aprovado antes desta entrega (2026-09-20T13:20Z) mantêm o histórico como está: a regra vale a partir do mês seguinte ao último fechamento aprovado nessa época. Fechamento aprovado nunca muda.
- **Fechamento manual**: a baixa da parcela deixa de ser digitada na tela; a tela sincroniza as baixas do Contas a Pagar (`syncClosingSettlements`) e só as mostra (situação, data e origem). Parcelas anteriores à data da regra mantêm a baixa manual antiga. Baixas de meses anteriores pagas no mês aparecem na tabela.
- **Baixas de todos os fechamentos**: o fechamento passou a considerar as baixas do contrato de todos os meses (antes só as do próprio fechamento) — sem isso, uma parcela paga em outubro voltava a aparecer em aberto em novembro. O pagamento só gera lançamento no mês da data da baixa.
- **Avisos (não bloqueiam a aprovação)**: parcelas vencidas sem baixa e contratos sem título no Contas a Pagar (sem título não há baixa). Ficam em `accounting_closings.extra_json.avisos` e aparecem na tela.
- **Baixa atrasada em mês já fechado**: continua entrando no primeiro dia da competência aberta, com a data real na observação (decisão contábil pendente: manter ou reabrir o mês).
- **Fica para a sequência (item 5)**: baixa manual com divisão principal/juros, multa, desconto, tarifa e PTAX do dia do pagamento; baixa parcial em vários meses (hoje a baixa da parcela é uma só).

## Títulos ignorados pela implantação (status `ignorado_implantacao`)

Ao aplicar a implantação, os títulos do contrato com vencimento até a data-base — exceto as parcelas informadas como vencidas em aberto — recebem o status próprio `ignorado_implantacao`. Vale para aberto, integrado ao ERP ou já baixado (o status anterior fica em `status_antes_implantacao`; nada é apagado).
- Fora da integração automática e manual com o ERP, da baixa manual, da consulta ao ERP, da classificação, das baixas derivadas do fechamento e do aviso de "contrato sem títulos"; a liberação dos títulos retidos não os toca.
- Ocultos por padrão no Contas a Pagar e fora dos totais; o filtro "Mostrar ignorados pela implantação" só consulta (sem ações).
- As parcelas informadas como vencidas em aberto e as futuras seguem normais (retidas até a liberação).
- Cenário previsto: a implantação é feita do zero, em etapa única, com a exclusão dos títulos antigos no Protheus na virada.
- Correção junto: a geração de títulos só considerava "existente" o título aberto — a parcela já baixada voltava como novo título em aberto na sincronização seguinte. Agora aberto, baixado e ignorado contam como existentes (só o cancelado/estornado pode ser gerado de novo). Migration 070.

- Sugestão dos juros: reclassificação de juros da matriz; sem ela, o crédito de "juros apropriados" (circulante) e a conta de principal não circulante (não circulante).
- Nome na tela e no histórico da abertura: "Provisão de juros" (circulante / não circulante), o mesmo vocabulário da Lógica Contábil, em vez de "juros a pagar".
- O evento `juros_apropriados` passou a se chamar "Provisão de juros (competência)" na Lógica Contábil e no histórico dos lançamentos mensais (só o rótulo; o comportamento e as contas não mudam).

## Moeda estrangeira: remensuração pela PTAX de fechamento (CPC 02 (R2))

Fontes conferidas: Estudo Especial do BACEN sobre a Ptax e Circular 3.506/2010 (quatro consultas por dia; taxa de compra e taxa de venda separadas, cada uma a média simples das quatro janelas, excluídas as duas maiores e as duas menores; o boletim de fechamento é a média dos quatro) e CPC 02 (R2), item 8 (taxa de fechamento = taxa à vista vigente ao término do período de reporte) e itens 23 e 28 (itens monetários pela taxa de fechamento; variação cambial no resultado do período). O CPC não define compra ou venda: a política adotada é a **PTAX de venda do BACEN** (a série que o sistema já guarda), a ser validada com o contador/auditor.
- **Cotação:** a da data de fechamento (último dia útil do mês), sem defasagem D-1 (a defasagem do contrato vale só para calcular as parcelas). Sem cotação no dia, vale a última publicada até 7 dias antes; sem nenhuma, o fechamento avisa (`ptax_ausente`) e segue o cronograma — nunca usa taxa antiga em silêncio. Competência em andamento usa a última publicada e é marcada como provisória.
- **Passivo em reais do mês = saldo em moeda (principal + juros) × PTAX de fechamento.** A variação cambial do mês é a diferença entre esse saldo e (saldo lançado no início do mês + movimentos do mês em reais); ela substitui a variação projetada pelo cronograma (que repete a última cotação) e a "realizada" (já embutida). O saldo anterior é a posição da implantação, o saldo do cronograma no primeiro mês sob a regra, ou o saldo em moeda × PTAX do mês anterior. Mês anterior à regra não muda.
- **Reclassificação circulante/não circulante:** a migração é medida em moeda e convertida pela PTAX de fechamento. A variação cambial do não circulante fica na conta da variação (limite conhecido: a matriz tem uma conta de passivo por evento).

## Contratos indexados: cronograma recalculado e "Ajuste de provisão de juros"

O cronograma salvo é uma fotografia (para o que ainda não foi publicado, o motor repete a última taxa). A cada fechamento, o cronograma dos contratos indexados (CDI, SELIC, IPCA, TR, TJLP, INPC, IGPM, em reais) é recalculado com as taxas de referência até a data de fechamento; o cronograma salvo não é alterado. O recálculo usa os mesmos parâmetros da Calculadora (validado: reproduz o cronograma salvo com diferença zero em SAC, PRICE, com taxa fixa, com carência e IPCA).
- **Ajuste de provisão de juros** (evento novo, migration 071): saldo de juros a pagar do cronograma recalculado no início do mês menos o saldo lançado no fechamento anterior (ou a posição da implantação). Entra no mês corrente; mês fechado não é reaberto (mudança de estimativa). Débito = despesa financeira de juros, crédito = provisão de juros; quando a provisão diminui o sistema inverte os lados. Sem saldo anterior gravado (primeiro mês acompanhado), não há ajuste.
- Os saldos de cada fechamento (principal e juros por contrato) ficam em `accounting_closings.extra_json.balances`. O fechamento manual grava pelo `saveClosingBalances` e recebe o cronograma recalculado pelo `syncClosingSettlements` (com `withLive`).
- Diferença de **principal** recalculado (por exemplo PRICE, cuja parcela muda com a taxa) é sinalizada (`principal_recalculado`), não lançada.
- O evento entra na exigência da Lógica Contábil da implantação quando há contrato indexado na categoria.

## Fica para a sequência
Ajuste no pagamento (valor pago × provisão restante: juros, multa, desconto, câmbio realizado pela cotação da liquidação) e atualização do valor dos títulos ainda não integrados ao ERP quando a taxa real sair; nos já integrados, aviso de "valor divergente da projeção".

## Fechamento automático: fuso de São Paulo e PTAX do último dia útil

- **Competência pelo fuso de São Paulo.** O servidor roda em UTC e o agendamento mensal roda às 22:00 de Brasília (01:00 UTC do dia seguinte): pelo relógio do servidor, "o mês atual" seria o que acabou de começar. `competenciaEmSaoPaulo` e `todayInSaoPaulo` (saoPaulo.js) passam a definir a competência e o "hoje" do fechamento e do recálculo das taxas.
- **Atualização de mercado no início do fechamento.** O fechamento automático primeiro atualiza PTAX e índices do BACEN (a PTAX do último dia útil sai ~13h, mas a atualização diária pode rodar depois do fechamento). Falha na atualização não derruba o fechamento (fica registrada em `detalhes.mercado`); o gate abaixo acusa a cotação faltante. Variável `CLOSING_SKIP_MARKET_SYNC=1` desliga a atualização (uso em testes).
- **PTAX do último dia útil é exigida.** A cotação usada precisa ser a do último dia útil até o fim do mês (segunda a sexta, fora os feriados cadastrados). Se só há cotação mais antiga, o cálculo avisa (`ptax_defasada`) e o fechamento **não pode ser aprovado nem postado** até atualizar as cotações em Moedas; sem cotação nenhuma nos 7 dias anteriores, também bloqueia (`ptax_ausente`). Competência em andamento segue provisória. Feriado no último dia útil: cadastrar em Feriados.
