# Plano de Virada de Saldos — AllDebt (v9)

_Carga dos empréstimos e financiamentos existentes para o Financeiro e o Contábil do AllDebt._

Base: v4 + revisão contra o código (commit `0750074`) + decisões do responsável de 19/09/2026 + duas revisões externas.
**Status: plano aprovado para SIMULAÇÃO. A execução em produção continua condicionada às evidências e decisões abaixo. Nada foi implementado, nada foi alterado em produção.**

Convenção deste documento: **[V]** = verificado pelo autor do plano no código ou em consulta somente leitura ao banco de produção, **com referência e data no Anexo A** (não é verificação independente; recomenda-se repetir as consultas do anexo); **[A]** = a validar antes de virar regra.

---

## 1. Decisões fixas

| Tema | Decisão |
|---|---|
| Piloto | **Um só contrato real:** nº 2915274241, Grupo Cangaia. O responsável do projeto é o aprovador |
| Data-base | **31/08/2026** (último dia do mês). **Início da competência no AllDebt: 01/09/2026.** "Virada operacional" é reservada para a **data e hora efetiva da troca** |
| Juros | Apropriação por competência (pro rata) no fim do mês, **validada** |
| Vencidas em aberto | **Recriadas** pelo AllDebt na troca |
| Multa e mora | Informadas manualmente, por contrato, por enquanto |
| Baixa | **Baixa efetiva obrigatória para todos os contratos:** parcela só é paga com sinalização de baixa (retorno do ERP por API ou baixa manual em Contas a Pagar) |
| Contas | Nomes/códigos definidos na tela de Implantação de Saldos |
| Fonte de verdade | O AllDebt, **depois de conciliado** (ver seção 2) |

## 2. Princípios

1. **O AllDebt é a referência de saldo, mas só depois de comprovado.** O saldo apurado vira referência quando conciliado com o contrato, os aditivos, os movimentos efetivos e o demonstrativo do credor, com as diferenças explicadas e aprovadas por escrito. Três sistemas (AllDebt, Protheus, contabilidade) podem carregar o mesmo erro; a evidência externa é o demonstrativo do banco.
2. **Não alterar o cronograma do contrato para fazer a virada.** Nada de mover parcela. A posição é medida sobre o cronograma e sobre os movimentos reais.
3. **Cada evento entra uma única vez.** Todo evento (título, baixa, lançamento, ajuste) tem identificador único; reprocessar substitui de forma controlada, nunca soma.
4. **Nada silencioso.** Recalcular, corrigir calendário, recriar título ou mudar regra sempre passa por simulação, diferença apresentada e aprovação.
5. **Preservar o que foi aprovado.** Períodos e posições aprovados só mudam por reprocessamento autorizado e rastreável.

## 3. Três referências de data (não confundir)

| Referência | Finalidade |
|---|---|
| **Data-base: 31/08/2026** | Apurar a posição de abertura |
| **Intervalo 01/09/2026 até a execução da troca** | Capturar pagamentos, baixas, estornos e demais movimentos ocorridos depois da data-base |
| **Data e hora da troca (= virada operacional)** | Determinar o que ainda pode ser integrado como obrigação aberta |

Como hoje é 19/09/2026 [V], a troca ocorre depois de 01/09: uma parcela aberta em 31/08 ou a vencer em setembro pode já ter sido paga. Ela precisa entrar na reconstrução com a sua baixa e **nunca** voltar para a fila de pagamento.

## 4. Posição na data-base

### 4.1 Principal: reconstruído pelos movimentos efetivos
Regra central:

**Principal = liberações efetivas + incorporações contratuais ao principal − amortizações efetivamente liquidadas ± ajustes identificados**

- O vencimento não reduz o principal; a liquidação efetiva reduz.
- O cronograma serve para **comparar o previsto com o realizado**, não para determinar o saldo.
- Antecipações, pagamentos parciais, estornos, renegociações e aditivos podem alterar toda a evolução posterior; cada ajuste entra uma vez, com origem identificada.
- **Conciliação rápida (não é fórmula do sistema):** em contrato simples, saldo do cronograma + amortizações vencidas não liquidadas deve coincidir com o principal reconstruído. Serve para achar erro, não para produzir o número.
- O principal vencido e não pago é parte do principal total. Não pode ser somado de novo como componente separado; na abertura ele é apenas **classificado** como vencido (circulante).

### 4.2 Juros
- **Juros apropriados até a data-base:** apurados pelo motor com a convenção de contagem de dias do contrato (migration 054), sem gravar no cronograma. Apropriar juros não os incorpora ao principal para render novos juros, salvo cláusula de capitalização.
- **Movimentação de juros a pagar** com componentes separados: apropriação do período, capitalização, variação cambial, renegociação e outros ajustes, pagamento, estorno. A relação "despesa = juros a pagar final − inicial + juros pagos" vale só como **conferência do caso simples**.
- **Sem duplicidade:** cada **apropriação** tem identificador único (contrato + período + componente). Cada **baixa** tem o identificador do **movimento de origem**, vinculado ao título (dois pagamentos parciais no mesmo mês são movimentos distintos), e o **estorno aponta para a baixa original**. Recalcular atualiza ou substitui o cálculo anterior de forma controlada; períodos aprovados ficam protegidos.
- **Pagamento parcial ou atrasado:** o exemplo abaixo vale para uma **liquidação integral regular**. Se o pagamento for parcial ou em atraso, o cálculo continua sobre os **saldos efetivamente remanescentes**, conforme o contrato; a data do pagamento, sozinha, não encerra toda a obrigação de juros.
- **Exemplo correto (parcela com vencimento em D):**

| Momento | Tratamento |
|---|---|
| Abertura em 01/09 | Carrega os juros apropriados até 31/08. Nenhuma nova despesa de agosto |
| Até o pagamento em D | Apropria somente o complemento ainda não reconhecido, de 31/08 até D |
| Pagamento em D | Baixa o saldo de juros a pagar contra o banco |
| Fechamento de setembro | Apropria o período **posterior** ao pagamento, de D até 30/09, e diferenças ainda não reconhecidas |

- **Pro rata não cria títulos.** O financeiro mantém um título de juros por parcela, no vencimento, com o valor cheio cobrado pelo banco. [V] a geração de títulos hoje usa o valor da linha do cronograma.
- **Fato verificado [V]:** hoje o fechamento reconhece os juros na data da linha do cronograma, não pro rata no fim do mês. Isso é o que a tarefa T1 corrige.

### 4.3 Custos de transação
- Tratamento por cliente, conforme a política contábil documentada (custo amortizado com taxa efetiva, ou norma simplificada). Não é escolha livre.
- [V] O sistema hoje lança o passivo líquido na liberação e apropria o custo em partes iguais. Isso é uma simplificação; [A] validar por cliente se serve como regra.
- Conciliar separadamente o **saldo contratual do banco** e o **saldo contábil líquido**: podem diferir legitimamente pelo custo ainda não apropriado.

### 4.4 Moeda estrangeira
Abertura pela PTAX da data-base, sem carregar a variação cambial histórica. A variação cambial entra como componente separado na movimentação de juros/principal.

## 5. Estado de cada parcela e regra de baixa

**Estados por componente** (principal e juros são títulos separados [V]; baixar o título de juros não liquida o principal): *aberta*, *parcialmente liquidada*, *liquidada*, *estornada*, *situação não esclarecida*. Os eventos de baixa e estorno são preservados, não sobrescritos.

**Fontes de evidência:** títulos abertos **e** movimentos de baixa, baixa parcial e estorno, com identificação e data. Título ausente da foto de abertos **não** significa pago: pode ter sido excluído, renegociado, não cadastrado ou ficado fora do filtro.

**Regra de baixa efetiva (todos os contratos):**
- Sem baixa, a parcela vencida continua no passivo (circulante, vencido) e o fechamento **não** lança pagamento para ela. [V] Hoje o fechamento dá a parcela como paga pelo cronograma quando não há baixa registrada; isso muda.
- **Distinguir** dívida realmente atrasada de ausência de informação: atraso legítimo não impede um fechamento correto; "situação não esclarecida" impede.
- **Data de início da regra** a definir; **fechamentos já aprovados não mudam** ao ativar a regra. Contratos antigos sem baixas não podem passar a mostrar todas as parcelas como vencidas sem tratamento do histórico. [V] Em produção há 2 fechamentos "calculado" e nenhum aprovado.
- A baixa de um título gera/atualiza a baixa do contrato (`contract_settlements`), hoje registros separados.

## 6. Financeiro: troca controlada no Protheus

1. **Foto do Protheus:** títulos em aberto **e** movimentos de baixa/estorno dos contratos do escopo.
2. **Correspondência antigo × novo:** cada título antigo identificado com o seu correspondente gerado no AllDebt (contrato + parcela + componente).
3. **Conciliação parcela a parcela** antes de qualquer mudança em produção. Diferença de valor ou vencimento é uma **divergência a investigar**, não conclusão de erro de cadastro: pode decorrer de pagamento parcial, atualização de indexador, calendário, renegociação ou erro no ERP.
4. **Bloqueio de pagamentos e alterações** dos títulos do escopo durante a janela.
5. **Integração retida:** [V] a integração automática integra tudo o que está aberto, não integrado e com natureza e fornecedor preenchidos; contratos em implantação ficam retidos até a janela.
6. **Falha de integração não prova que o título não foi criado no ERP:** consultar o ERP antes de repetir. [V] O piloto tem 30 títulos com falha e 42 integrados.
7. **Recuperação de integração parcial:** procedimento específico para o caso "metade integrou, depois falhou", sem deixar as duas versões abertas.
8. **Exclusão restrita:** não excluir título com baixa parcial, vínculo bancário ou movimento; esses seguem tratamento à parte.
9. **Vencidos em aberto:** recriados (decisão fixa), com o valor em aberto e o vencimento original, e mesmas exigências acima.
10. **Efeitos contábeis:** excluir e reincluir título no Protheus pode gerar estorno e nova contabilização no razão antigo; combinar com a contabilidade quem faz o quê.

## 7. Contábil

### 7.1 Lançamento de abertura (por contrato)
Contra a **conta transitória**, com os componentes: **principal total = vencido (circulante) + vincendo circulante + vincendo não circulante, sem sobreposição** (regra da seção 4.1; circulante pela régua CPC 26: vence até a data-base + 12 meses), juros apropriados a pagar (circulante/não circulante), custo de transação a apropriar (quando a política do cliente exigir), USD pela PTAX da data-base.

### 7.2 Transitória
- Débito na transitória / Crédito nas contas de passivo do AllDebt (as contas exclusivas recomendadas na Lógica Contábil). O lado do sistema antigo (Débito no passivo antigo / Crédito na transitória) precisa chegar **ao mesmo razão de destino**; débito num sistema e crédito no outro não se compensam sozinhos.
- Transitória zerada é necessária, **mas não prova correção** (dois lançamentos duplicados e espelhados também zeram). Exigir conciliação por empresa, contrato e lote: saldo antigo transferido, saldo novo reconhecido, componentes, ausência de duplicidade e transitória zerada.

### 7.3 Fechamento depois da virada
- Competências anteriores à virada bloqueadas para os contratos em implantação.
- Saldo de abertura do 1º fechamento = lançamento de abertura, com teste automático.
- Reclassificação circulante/não circulante: já corrigida [V] (só conta o que migrou do longo prazo; contrato de até 12 meses não gera reclassificação).

### 7.4 Quem contabiliza cada evento (proposta a confirmar, decisão D6)

| Evento | Responsável proposto | Risco se não definido |
|---|---|---|
| Lançamento de abertura | AllDebt gera; contador aprova e lança | Abertura duplicada ou omitida |
| Apropriação mensal de juros | AllDebt | Juros no período errado |
| Reclassificação circulante/não circulante | AllDebt | Reclassificação manual em paralelo |
| Variação cambial | AllDebt | Duplicidade com o razão antigo |
| Custo de transação (apropriação) | AllDebt, conforme política do cliente | Divergência de saldo líquido |
| Pagamento (baixa bancária) | **A definir: Protheus ou AllDebt** | Banco e passivo movimentados duas vezes |
| IOF, tarifas, multa e mora | A definir, junto com a baixa | Despesa duplicada |

[V] O fechamento do AllDebt gera lançamento de pagamento com perna de banco. Se o Protheus também contabiliza a baixa bancária, o mesmo pagamento é lançado duas vezes.

## 8. Calendário de feriados

- **Achado [V]:** a tabela de feriados em produção tem **0 registros**. O motor não desloca nenhuma data por feriado. Isso afeta todos os contratos com parcela em feriado, de todos os clientes, não só o piloto.
- **Piloto [V]:** a parcela 30 está em 07/09/2026 (segunda-feira), feriado nacional; 05/09 é sábado. Portanto vencimento, número de dias e juros dessa parcela **não valem como valores de aceite** antes de conferir o calendário e a regra do contrato (próximo dia útil, por exemplo 08/09).
- **Cadastrar feriados não corrige sozinho** cronogramas e títulos já gerados nem integrados.
- **Nesta etapa (planejamento):** preparar e validar a carga de feriados (nacionais, e estaduais/municipais quando aplicáveis) e medir o impacto; **não cadastrar em produção antes da aprovação**.
- **Tratamento previsto:** (a) identificar contratos afetados; (b) simular o recálculo; (c) apresentar diferenças de data, juros e valor por contrato; (d) decidir o tratamento dos títulos já integrados ou pagos; (e) só então aplicar, com rastreabilidade. Nunca recalcular e sobrescrever tudo silenciosamente.

## 9. Reprocessamento e proteção

- **Identificador único** da implantação e de cada evento (título, baixa, lançamento, ajuste).
- **Repetição segura:** rodar duas vezes não cria títulos, baixas ou lançamentos adicionais.
- **Fotografia congelada da posição aprovada:** dados do contrato, parâmetros, taxas, calendário, versão do motor e o resultado. Sem ela, uma atualização de taxa, calendário ou contrato muda o resultado entre a aprovação e a execução. O identificador evita duplicidade; a fotografia permite explicar e reproduzir o saldo.
- **Correção após integração** apenas por procedimento rastreável.
- **Isolamento por cliente e empresa.**

## 9.1 Piloto: contrato 2915274241 (Grupo Cangaia)

Consulta somente de leitura [V], sem alterações:

| Item | Situação |
|---|---|
| Contrato | Aprovado; operação 05/03/2024; R$ 370.000,00; Bradesco; 36 parcelas de 05/04/2024 a 05/03/2027 |
| Títulos a pagar | 72 (36 amortização + 36 juros), todos em aberto no AllDebt; 42 integrados ao Protheus e 30 com falha de integração |
| Baixas / lançamentos contábeis | Nenhum. O AllDebt não tem histórico de pagamento do contrato |
| Parcela 29 | 05/08/2026, saldo do cronograma R$ 69.815,10 (ponto do exemplo) |
| Parcela 30 | 07/09/2026 no cronograma (**feriado; ver seção 8**). Valores do cronograma: amortização R$ 9.648,37 e juros R$ 770,10, **não são aceite** |
| Depois de 31/08 | 7 parcelas restantes, todas dentro de 12 meses: **tudo circulante** |

**Limite do piloto:** por estar todo no circulante, ele **não valida a separação circulante/não circulante**. Por isso, além do piloto real, incluir **testes controlados em contratos de teste** para: pagamento parcial, estorno, vencido em aberto, CDI, USD, carência e dívida de longo prazo.

**Pendência do piloto:** confirmar com o financeiro se os 42 títulos integrados já duplicam títulos existentes no Protheus.

## 10. Tarefas de desenvolvimento (dependências)

| # | Tarefa | Depende de |
|---|---|---|
| T0 | Calendário: preparar e validar carga de feriados; simular impacto nos contratos e títulos existentes | — |
| T1 | Apropriação de juros por competência no fechamento (manual e automático), com controle do que já foi apropriado/liquidado e eventos com identificador único | Decisões D1 (validada) |
| T2 | Baixa efetiva para todos os contratos (API do ERP ou manual), estados por componente, data de início da regra, proteção de períodos aprovados | D7 |
| T3 | Marca "em implantação"; filtro de títulos; retenção da integração automática | — |
| T4 | Importação da foto do Protheus **com baixas e estornos**; conciliação parcela a parcela e correspondência antigo × novo | T2, T3 |
| T5 | Posição na data-base reconstruída pelos movimentos efetivos (principal, juros, classificação CP/LP, USD) | T0, T1, T2, T4 |
| T6 | Fotografia congelada da posição aprovada e identificadores/idempotência da implantação | T5 |
| T7 | Tela de Implantação de Saldos (contas, datas, escopo, prévia, aprovação) | T5 |
| T8 | Lançamento de abertura, bloqueio de fechamento anterior e conciliação da transitória | T6, T7 e **conciliação aprovada** |
| T9 | Procedimento de troca no Protheus: bloqueio de pagamentos, consulta ao ERP, recuperação de integração parcial | T4, T8 |
| T10 | Carga em lote e lista de exceções (somente depois do piloto) | Piloto aprovado |

### Decisões pendentes e o que cada uma bloqueia

| Decisão | Bloqueia |
|---|---|
| D6 — responsável por cada evento contábil | A **ativação/exportação dos lançamentos**, principalmente pagamentos (T2 na parte de exportação, T8) |
| D7 — início da regra de baixa e histórico | A ativação da regra de baixa efetiva em produção (T2) |
| D8 — política de custo de transação | A **aprovação da posição contábil líquida e da abertura** (T5 parte contábil, T8) |
| D9 — janela de troca (dia, hora, responsável) | A **execução da troca** (T9) |
| D10 — fonte do demonstrativo do credor | O **aceite da conciliação bancária** (critério A1) |

**Pode avançar enquanto as decisões são fechadas:** T0 (calendário, em simulação), T1 e T3 em ambiente de teste, e a preparação da carga de dados do piloto.

## 11. Critérios de aceite

### 11.1 Para liberar a troca (antes de executar em produção)

| # | Evidência | Critério objetivo |
|---|---|---|
| A1 | Posição de abertura comprovada | Principal (vencido + vincendo circulante + não circulante), juros e total, por componente, iguais ao demonstrativo do banco em 31/08/2026, ou com diferença explicada e aprovada por escrito (tolerância proposta: R$ 0,01 por componente). Depende de D10 |
| A2 | Movimentos de setembro conciliados | 100% dos títulos do escopo com estado evidenciado por baixa ou consulta ao ERP; **zero** em "situação não esclarecida" |
| A3 | Sem duplicidade | Zero títulos duplicados por contrato + parcela + componente no AllDebt e no Protheus; zero lançamentos com o mesmo identificador de evento; baixas identificadas pelo movimento de origem |
| A4a | **Ensaio do primeiro fechamento** | Em **ambiente de teste**, antes da troca: saldo de abertura = lançamento de abertura (diferença 0,00); juros de fim de setembro calculados e conferidos contra resultados esperados definidos previamente; nenhuma reclassificação indevida; transitória zerada e conciliada nos dois lados |
| A5 | Repetição e recuperação testadas | Segunda execução gera **zero efeitos financeiros e contábeis adicionais** (registros de auditoria da tentativa são permitidos); falha parcial simulada em ambiente de teste recuperada sem duplicidade |
| A6 | Calendário | Feriados carregados e validados; simulação de impacto aprovada; tratamento dos títulos já integrados ou pagos decidido |
| A7 | Testes controlados | Pagamento parcial, estorno, vencido em aberto, CDI, USD, carência e longo prazo passando em contratos de teste |

### 11.2 Para encerrar o acompanhamento do piloto (depois do fechamento real de setembro)

| # | Evidência | Critério objetivo |
|---|---|---|
| A4b | **Conciliação real do primeiro fechamento** | Depois do fechamento de setembro: juros a pagar de fim de setembro iguais ao demonstrativo do banco; saldo de abertura = lançamento de abertura; nenhuma reclassificação indevida; transitória zerada e conciliada nos dois lados; aceite definitivo assinado pelo aprovador |

O primeiro fechamento real **não é pré-requisito** para executar a troca; o ensaio A4a é.

## 12. Riscos principais

| Risco | Mitigação |
|---|---|
| Saldo errado reproduzido na contabilidade | Conciliação com demonstrativo do credor antes de virar referência (seção 2) |
| Passivo menor por amortização dada como paga sem baixa | Principal por movimentos efetivos; regra de baixa efetiva |
| Despesa de juros duplicada ou omitida | Movimentação separada, eventos com identificador único, período aprovado protegido |
| Parcela paga em setembro recriada como aberta | Terceira referência de data e estados por componente |
| Duplicidade de títulos no Protheus | Retenção, correspondência antigo × novo, consulta ao ERP, recuperação parcial |
| Pagamento contabilizado em dois sistemas | D6: responsável por evento definido antes da virada |
| Cronograma e títulos com data errada por falta de feriados | T0: simulação e decisão antes de recalcular |
| Resultado muda entre aprovação e execução | Fotografia congelada |

## 13. Decisões pendentes

- **D6:** responsável por cada evento contábil, em especial a baixa bancária (Protheus ou AllDebt).
- **D7:** data de início da regra de baixa efetiva e tratamento do histórico dos contratos existentes.
- **D8:** política de custo de transação por cliente (custo amortizado ou norma simplificada).
- **D9:** dia e hora da janela de troca; quem executa a foto e as exclusões no Protheus (informado como resolvido; registrar responsável e horário).
- **D10:** fonte do demonstrativo do credor do piloto para a evidência A1.

## 14. Referências de mercado

- Migração de sistema contábil sem perder histórico — Ledware
- Implantar Saldos (Contábil) — Alterdata
- ERP Migration: A Finance Leader's Playbook — DualEntry
- Cut-Over Plan Best Practices — Techfino
- ERP Data Migration Checklist — KPC Team

---

## Anexo A — Evidências e como reproduzir

Verificações feitas em **19/09/2026** pelo autor do plano, em modo **somente leitura** (SSH ao VPS, consulta ao banco de produção; leitura do repositório no commit `0750074`). Não são verificações independentes: repetir as consultas e conferir os resultados.

### A.1 Feriados vazios em produção
```sql
select count(*), min(holiday_date), max(holiday_date) from holidays;
```
Resultado em 19/09/2026: **0 registros**. Consequência observada: a parcela 30 do piloto está em 07/09/2026 (segunda-feira, feriado nacional) porque 05/09/2026 é sábado e nenhum feriado é considerado.

### A.2 Títulos do piloto (contrato 2915274241, id 0e2da5d5-cf20-49ab-8450-4a0307bacce4)
```sql
select coalesce(erp_status,'(null)'), coalesce(integrado_erp::text,'null'), status, count(*), min(vencimento), max(vencimento)
from payable_titles where contract_id = '0e2da5d5-cf20-49ab-8450-4a0307bacce4' group by 1,2,3;
select count(*) from contract_settlements where contract_id = '0e2da5d5-cf20-49ab-8450-4a0307bacce4';
select count(*) from accounting_journal_entries where contract_id = '0e2da5d5-cf20-49ab-8450-4a0307bacce4';
```
Resultado em 19/09/2026: `falha | false | aberto | 30 | 2024-04-05 a 2026-09-07`; `integrado | true | aberto | 42 | 2024-04-05 a 2027-03-05`; baixas: 0; lançamentos: 0. Observação: "falha" não prova que o título não existe no ERP.

### A.3 Cronograma do piloto ao redor da data-base
Linhas 28 a 31 de `schedule_data` (parcela — vencimento — saldo inicial — amortização — juros — saldo final): 28 — 06/07/2026 — 88.797,19 — 9.438,99 — 979,48 — 79.358,21; **29 — 05/08/2026 — 79.358,21 — 9.543,10 — 875,37 — 69.815,10**; 30 — 07/09/2026 — 69.815,10 — 9.648,37 — 770,10 — 60.166,73; 31 — 05/10/2026 — 60.166,73 — 9.754,80 — 663,67 — 50.411,94. Valores da parcela 30 e do intervalo de 33 dias **não são aceite** (dependem do calendário).

### A.4 Fechamentos em produção
Dois fechamentos com status "calculado" e nenhum aprovado (consulta em `accounting_closings` agrupada por status, 19/09/2026).

### A.5 Referências de código (commit `0750074`)
| Afirmação | Onde |
|---|---|
| O fechamento reconhece juros apropriados na data da linha do cronograma, não pro rata no fim do mês | `backend/src/modules/accounting/closingEngine.js`, linhas 133 (`isWithinMonth`) e 147 (evento `JUROS_APROPRIADOS`) |
| Sem baixa registrada, o fechamento dá principal e juros da linha como pagos | mesmo arquivo, linhas 142 e 143 (`principalPaidRow`, `interestPaidRow`) |
| A geração de títulos percorre todas as linhas, sem filtro de data | `backend/src/modules/payables/generate.js`, linha 169 (`for (const row of parseContractSchedule(contract))`) |
| A integração automática pega títulos abertos, não integrados, com natureza e fornecedor preenchidos | `backend/src/modules/payables/autoIntegrate.js`, `listReadyPayableTitles`, linhas 10 a 18 |
| Régua de 12 meses do CPC 26 e separação circulante/não circulante | `closingEngine.js`, `splitCirculanteNaoCirculante` (linha 219) e `shortLimit` (linha 236); espelho em `src/lib/accountingClosing.js` |
| O cronograma tem uma linha por mês mesmo com amortização trimestral/semestral | Contratos de teste locais SACTEST-10 (30 linhas/30 meses) e SACTEST-11 (36/36) — dado de teste local, não de produção |
