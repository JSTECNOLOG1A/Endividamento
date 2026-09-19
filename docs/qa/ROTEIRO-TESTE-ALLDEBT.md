# Roteiro de teste completo — AllDebt

> **Documento completo (mapa do produto + roteiro):** [`DOCUMENTO-QA-ALLDEBT.md`](./DOCUMENTO-QA-ALLDEBT.md)

Documento de QA manual E2E. Use para regressão, smoke pós-deploy e homologação de release.

| Campo | Valor |
|---|---|
| Produto | AllDebt (Endividamento) |
| URL canônica | https://alldebit.clarityib.com.br |
| Alias | https://alldebt.clarityib.com.br |
| Local | UI `http://localhost:5173` · API `http://127.0.0.1:3001/api/health` |
| Versão do roteiro | 1.0 — 2026-09-19 |

---

## Como usar

1. Preencha o ambiente, data e executor no cabeçalho de execução.
2. Marque cada caso: **OK** / **Falha** / **N/A** / **Bloqueado**.
3. Em falha, anote: evidência (print/URL), usuário, tenant, grupo econômico e passos até o erro.
4. Prioridade: **P0** = bloqueia release · **P1** = crítico · **P2** = importante · **P3** = desejável.

### Cabeçalho de execução

| Item | Preencher |
|---|---|
| Ambiente | [ ] Local · [ ] Staging · [ ] Produção |
| Data | |
| Executor | |
| Build / commit | |
| Resultado geral | [ ] Aprovado · [ ] Aprovado com ressalvas · [ ] Reprovado |

### Personas sugeridas

| ID | Persona | Uso |
|---|---|---|
| M | PLATFORM_MASTER | Administração da plataforma, suporte, planos |
| O | OWNER do tenant | Fluxo completo + ERP + reabertura |
| A2 | Admin com alçada N2 | Aprovação final e reabertura a 4 mãos |
| U1 | Usuário com alçada N1 | Só aprovação nível 1 |
| V | Viewer | Somente leitura |
| S | Tenant Starter no limite | Bloqueios de plano |
| X | Tenant suspenso | Login recusado |

### Pré-requisitos globais

- [ ] Health `GET /api/health` → 200
- [ ] Pelo menos um tenant trial/ativo com governança mínima (grupo + entidade + banco)
- [ ] Usuários das personas criados (ou seed local)
- [ ] Confirmar **Grupo Econômico** selecionado na sidebar antes de cada fluxo operacional
- [ ] SMTP opcional: sem SMTP, links de e-mail aparecem na UI — anotar e seguir o link

---

## Bloco 0 — Smoke pós-deploy (P0)

| ID | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|
| S-01 | Health API | Abrir `/api/health` | HTTP 200, serviço saudável | |
| S-02 | Login master | Login com `ADMIN_EMAIL` | Entra; menu Administração da plataforma visível | |
| S-03 | Lista tenants | Platform → Tenants | Lista carrega sem erro | |
| S-04 | Layout padrão | Login tenant → home | Layout Modern por padrão | |
| S-05 | Isolamento básico | Master **sem** suporte abre `/Contracts` | Mensagem pedindo sessão de suporte; sem dados do tenant | |

---

## Bloco 1 — Autenticação e conta (P0/P1)

| ID | Pri | Caso | Pré-condição | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|---|
| A-01 | P0 | Login válido | Usuário ativo | E-mail + senha corretos → Entrar | Redireciona para área autenticada | |
| A-02 | P0 | Login inválido | — | Senha errada | Mensagem de erro; não autentica | |
| A-03 | P1 | Rate limit login | — | ≥9 tentativas falhas em 1 min | Bloqueio/rate limit | |
| A-04 | P0 | Logout | Sessão aberta | Logout | Volta ao login; token inválido | |
| A-05 | P1 | Sessão expirada | JWT antigo / aguardar | Navegar após expiração | Redireciona ao login | |
| A-06 | P1 | Usuário bloqueado | User `blocked` | Tentar login | Falha com mensagem adequada | |
| A-07 | P0 | Tenant suspenso | Tenant X suspenso | Login do OWNER | Falha com mensagem de suspensão | |
| A-08 | P1 | Esqueci senha | E-mail cadastrado | Pedir reset → abrir link → nova senha ≥8 | Login com nova senha funciona | |
| A-09 | P1 | Token reset inválido | — | Abrir `/redefinir-senha` com token falso | Erro; não troca senha | |
| A-10 | P0 | Criar conta (signup) | CNPJ novo | `/criar-conta` → CNPJ → e-mail → `/concluir-cadastro` → senha | Tenant + OWNER criados; consegue logar | |
| A-11 | P1 | CNPJ inválido / duplicado | — | Signup com CNPJ inválido; depois com CNPJ já usado | Erros claros; não cria duplicata | |
| A-12 | P1 | Aceitar convite | Convite pendente | Abrir link `/aceitar-convite` → definir senha | Usuário ativo no tenant | |
| A-13 | P1 | Convite com sessão master | Master logado | Abrir link de convite | Força logout / fluxo de convite limpo | |

---

## Bloco 2 — Primeiro acesso LGPD e onboarding (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| F-01 | P0 | Consentimento LGPD | 1º login tenant novo | Modal privacidade + termos; só segue após aceitar | |
| F-02 | P2 | Product Tour | Após LGPD | Tour opcional; pode pular; não bloqueia uso | |
| F-03 | P1 | Onboarding Protheus | Banner/rota `/onboarding` | Informar códigos empresa/filial; marcar concluído | |
| F-04 | P2 | Onboarding já feito | Tenant com onboarding ok | Banner não reaparece | |

---

## Bloco 3 — Platform Master (P0/P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| P-01 | P0 | Overview | `/Platform` | Cards/resumo carregam | |
| P-02 | P0 | Criar tenant trial | Tenants → Novo → dados OWNER | Tenant Starter/trial; OWNER recebe convite/e-mail | |
| P-03 | P0 | Suspender tenant | Detalhe → Suspender + motivo | Tenant não loga; motivo registrado | |
| P-04 | P0 | Reativar tenant | Detalhe → Reativar | Login do cliente volta a funcionar | |
| P-05 | P0 | Alterar plano | Detalhe → plano + **step-up senha** | Plano atualiza; limites passam a valer | |
| P-06 | P0 | Cliente não muda plano | Login OWNER → Settings Conta/Plano | Plano somente leitura; sem botão de upgrade self-serve | |
| P-07 | P0 | Sessão de suporte | Tenants → Acessar suporte: motivo ≥8, duração 15/30/60, step-up | Banner âmbar; consegue abrir Contratos/Calculadora do tenant | |
| P-08 | P0 | Encerrar suporte | Banner → Encerrar | Volta ao control plane; data plane bloqueado de novo | |
| P-09 | P1 | Step-up obrigatório | Ação crítica sem senha recente | Modal step-up; sem senha não executa | |
| P-10 | P1 | Auditoria platform | `/PlatformAudit` | Eventos de create/suspend/support/plano append-only | |
| P-11 | P2 | Proposta comercial | `/CommercialProposal` (só master) | Gera/visualiza PDF; user tenant não acessa | |

---

## Bloco 4 — Governança (P0)

> Sem governança correta, contratos “somem” (filtro de grupo). Sempre validar o seletor da sidebar.

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| G-01 | P0 | CRUD Grupo econômico | `/GovernanceGroups` criar/editar | Persiste; aparece no seletor | |
| G-02 | P0 | CRUD Entidade | CNPJ/CPF + nome; código Protheus se ERP | Persiste; listável no grupo | |
| G-03 | P0 | CRUD Banco + conta | Banco COMPE + conta bancária | Conta disponível na calculadora | |
| G-04 | P1 | Naturezas | CRUD `/GovernanceNatures` | Persiste | |
| G-05 | P1 | Plano de contas | CRUD `/GovernanceChart` | Contas analíticas usáveis na matriz | |
| G-06 | P1 | Isolamento por grupo | Criar entidade no grupo A; trocar para B | Entidade A não aparece em B | |
| G-07 | P2 | Import ERP contas | Integração ok → import preview → confirmar | Contas importadas | |
| G-08 | P2 | Import naturezas / plano | Idem | Registros criados sem duplicar indevidamente | |
| G-09 | P1 | Excluir entidade | OWNER exclui; User tenta | OWNER ok; User/Viewer bloqueados | |

---

## Bloco 5 — Calculadora e contratos (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| C-01 | P0 | Novo contrato PRICE | Contratos → + Novo → preencher → Calcular | Tabela + CET + resumos; sem erro | |
| C-02 | P0 | Sistema SAC | Mesmo fluxo com SAC | Parcelas decrescentes coerentes | |
| C-03 | P1 | Outros sistemas | SACRE / Americano / Bullet / % Residual | Calcula sem crash; memória coerente | |
| C-04 | P1 | Indexador CDI + spread | Indexador CDI + capitalização “entra na parcela” | Juros refletem CDI+spread | |
| C-05 | P1 | Capitalização no saldo | Opção “fica dentro da dívida” | Parcela menor; saldo capitaliza indexador | |
| C-06 | P1 | Editar datas | Após calcular → Editar Datas → recalcular | Cronograma respeita datas manuais | |
| C-07 | P0 | Salvar rascunho | Salvar como Rascunho | Status `rascunho`; editável | |
| C-08 | P0 | Enviar revisão | Enviar para Revisão | Status `pendente_aprovacao` | |
| C-09 | P1 | Anexar PDF | Drag PDF no painel | Aceita `application/pdf`; rejeita outros | |
| C-10 | P1 | Duplicar contrato | Ação duplicar | Novo registro editável | |
| C-11 | P1 | Editar devolvido | Contrato `devolvido` → editar → reenviar | Volta a `pendente_aprovacao` (**nunca** `rascunho`) | |
| C-12 | P1 | Filtros lista | Filtrar por status / banco | Lista coerente | |
| C-13 | P2 | Export PDF / e-mail | Ações de documento no detalhe | PDF gera; e-mail real ou simulado (NotificationLog) | |
| C-14 | P0 | Viewer não escreve | Login V → Contratos | Sem botões de criar/editar/excluir; API 403 se forçar | |

---

## Bloco 6 — Aprovação (alçada) (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| AP-01 | P0 | Aprovar N1 | U1 em contrato pendente → Aprovar Nível 1 | Continua pendente; marca N1 | |
| AP-02 | P0 | Aprovar N2 final | A2 → Aprovar Nível 2 | Status `aprovado` | |
| AP-03 | P1 | N2 sozinho | Usuário nível 2 faz N1+N2 | Aprovado | |
| AP-04 | P0 | Devolver | Devolver **com** comentário | Status `devolvido`; comentário visível | |
| AP-05 | P1 | Devolver sem comentário | Tentar devolver vazio | Bloqueado / validação | |
| AP-06 | P1 | Sem alçada | User nível 0 | Não vê/aprova | |
| AP-07 | P0 | Pós-aprovação títulos | Abrir Contas a Pagar/Receber | Títulos gerados/sincronizados | |

---

## Bloco 7 — Pós-aprovação: reabrir, renegociar, quitar (P0/P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| L-01 | P0 | Reabrir OWNER | O → Reabrir | Contrato editável; títulos estornados | |
| L-02 | P0 | Reabrir admin 4 mãos | A2 pede → outro admin confirma | Só confirma com 2º admin | |
| L-03 | P1 | Um único admin | Tenant com 1 admin | Reabertura admin bloqueada (mensagem clara) | |
| L-04 | P1 | Renegociar | Dialog renegociar no detalhe | Fluxo conclui; status coerente (`renegociado` / novo contrato) | |
| L-05 | P1 | Quitar antecipado | Dialog quitação | Entra em aprovação de quitação; após aprovar → `quitado` | |

---

## Bloco 8 — Conta garantida (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| CG-01 | P1 | Criar CG | + Conta Garantida / `/GuaranteedAccounts` | Registro criado | |
| CG-02 | P1 | Extrato / saque / pagamento | Lançar movimentos | Extrato atualiza; título a pagar recalcula | |
| CG-03 | P1 | Renovar | Renovação | Contrato antigo `cancelado`; novo ativo | |
| CG-04 | P2 | Excluir CG | Admin exclui | Removido; user comum bloqueado se aplicável | |

---

## Bloco 9 — Contabilidade e consolidação (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| CT-01 | P1 | Posição na data | `/Accounting` aba Posição | Saldos coerentes com contratos aprovados | |
| CT-02 | P1 | Competência | Aba Competência | Lançamentos por período | |
| CT-03 | P1 | Fluxo futuro | Aba Fluxo | Projeções de vencimentos | |
| CT-04 | P0 | Fechamento | Fechar competência → baixas → aprovar | Período fechado/aprovado | |
| CT-05 | P1 | Reabrir fechamento | Admin + justificativa | Reabre; sem admin bloqueia | |
| CT-06 | P1 | Matriz contábil | Settings → Lógica Contábil | Mapear evento→contas analíticas; salva | |
| CT-07 | P1 | Consolidação | `/Consolidation` trocar grupo | Totais por entidade/banco; curto vs longo prazo | |
| CT-08 | P2 | Somente leitura consolidação | Tentar “editar” | Sem escrita operacional | |

---

## Bloco 10 — Financeiro AP/AR e ERP (P1)

| ID | Pri | Caso | Pré-condição | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|---|
| ER-01 | P1 | Config integração | Credenciais Protheus | Settings → Integrações → Testar conexão | Sucesso ou erro claro | |
| ER-02 | P1 | Sync AP | Contratos aprovados | `/AccountsPayable` sync/filtros | Títulos listados | |
| ER-03 | P1 | Classificar natureza | — | Classificar título | Natureza salva | |
| ER-04 | P0 | Integrar ERP | Entidade com código + banco COMPE | Integrar selecionados (OWNER) | Status integrado; consulta ERP ok | |
| ER-05 | P0 | Estornar ERP | Título integrado | Estornar (OWNER) | Estorno ok; não-OWNER bloqueado | |
| ER-06 | P1 | Converter PR→TX | Título PR | Converter | Vira TX | |
| ER-07 | P1 | Reconverter FX / PTAX | Título moeda | Reconverter pela PTAX | Valor atualizado | |
| ER-08 | P1 | AR análogo | — | Repetir sync/classificar/integrar em Receber | Mesmo comportamento | |
| ER-09 | P2 | Export FX integridade | Snapshot inválido | Tentar export | Bloqueado com mensagem | |

---

## Bloco 11 — Indexadores, feriados e schedules (P1/P2)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| I-01 | P1 | Import CDI CSV | `/CDIManager` aba CDI → CSV | Fatores diários importados | |
| I-02 | P1 | Buscar BACEN | Botão buscar por índice | Dados atualizados (CDI/SELIC/PTAX/IPCA/…) | |
| I-03 | P2 | Feriados BrasilAPI | Aba Feriados → importar | Calendário preenchido | |
| I-04 | P1 | Lacuna CDI | Contrato CDI em período sem fator | Cálculo alerta/falha controlada (não silent wrong) | |
| I-05 | P2 | Schedule job | Settings → Agendamento → criar → Rodar agora | Job executa; log/status ok | |
| I-06 | P2 | Desativar job | Desativar schedule | Não roda no próximo ciclo | |

---

## Bloco 12 — Configurações, usuários e parâmetros (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| CF-01 | P1 | Hub Settings | `/Settings` | Links para subpáginas corretos | |
| CF-02 | P0 | Convite usuário | Admin → Usuários → convidar | Convite enviado; limite de plano respeitado | |
| CF-03 | P1 | Alterar perfil/alçada | Editar role + approval_level | Persiste; afeta botões de aprovação | |
| CF-04 | P1 | Bloquear usuário | Bloquear | Login falha | |
| CF-05 | P1 | AdminOnly menus | Login User comum | Sem Parâmetros / Lógica Contábil / Usuários / Log | |
| CF-06 | P2 | Parâmetros layout | Admin → Classic ↔ Modern | Layout troca e persiste | |
| CF-07 | P2 | Log operacional | `/SettingsLog` | Eventos de escrita visíveis | |
| CF-08 | P1 | Privacidade LGPD | Pedidos ACCESS/CORRECTION/PORTABILITY/ERASURE | Pedido registrado | |
| CF-09 | P2 | Marketing opt-in/out | Toggle marketing | Preferência salva | |
| CF-10 | P3 | Rota legada `/Configuracoes` | Abrir URL antiga | Stub/não é Settings real — documentar comportamento atual | |

---

## Bloco 13 — Planos e limites (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| PL-01 | P0 | Starter contratos | Tenant Starter: criar até 11º contrato ativo | 11º bloqueado (409 / mensagem de limite); cancelados não contam | |
| PL-02 | P0 | Starter usuários | Convidar além de 3 | Bloqueio de limite | |
| PL-03 | P1 | Upgrade via master | Master sobe para Pro | Limites sobem; criação volta a funcionar | |
| PL-04 | P2 | Enterprise | Plano Enterprise | Sem teto prático de contratos/usuários | |
| PL-05 | P1 | Trial expirado | Tenant trial vencido (se aplicável) | Write bloqueado `TRIAL_EXPIRED` | |

---

## Bloco 14 — Segurança e isolamento (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| SEC-01 | P0 | Isolamento tenant | User do tenant A tenta API/entidade de B | 403 / vazio; sem vazamento | |
| SEC-02 | P0 | Master sem suporte | Master chama data plane | `SUPPORT_SESSION_REQUIRED` | |
| SEC-03 | P1 | Viewer write API | Forçar POST/PATCH como viewer | 403 `READ_ONLY` | |
| SEC-04 | P1 | Upload não-PDF em contrato | Enviar .exe/.docx | Rejeitado | |
| SEC-05 | P2 | OpenAPI / health públicos | Abrir `/api/openapi.json` e health | Disponíveis; sem dados sensíveis de tenant | |

---

## Bloco 15 — Manual, FAQ e UX (P2/P3)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| UX-01 | P2 | Manual in-app | `/UserManual` seções | Conteúdo carrega; PDF gera | |
| UX-02 | P3 | FAQ | Aba/FAQ | Respostas coerentes | |
| UX-03 | P2 | Mobile nav | Viewport estreito | Menu moderno mobile navegável | |
| UX-04 | P3 | Seletor grupo “sumiu” | Cadastrar no grupo A; olhar B | Documentar warning; dados no A | |

---

## Matriz de regressão rápida (30 min)

Use quando não houver tempo para o roteiro inteiro:

1. S-01 … S-05 (smoke)
2. A-01, A-07, A-10 (auth)
3. F-01 (LGPD)
4. P-02, P-07, P-08 (platform + suporte)
5. G-01 … G-03 (governança mínima)
6. C-01, C-07, C-08 (contrato)
7. AP-01, AP-02, AP-04 (aprovação)
8. L-01 (reabrir OWNER)
9. CT-04 (fechamento)
10. PL-01 (limite Starter)
11. SEC-01, SEC-02 (isolamento)

---

## Checklist de evidências por release

- [ ] Planilha/marcação deste arquivo preenchida
- [ ] Prints dos P0 falhos (se houver)
- [ ] Commit / `DEPLOYED_COMMIT` testado
- [ ] Health prod 200
- [ ] Decisão: Aprovado / Ressalvas / Reprovado
- [ ] Bugs abertos com ID e severidade

---

## Referências

- Manual in-app: `src/data/manualContent.js` · rota `/UserManual`
- Platform: `docs/platform/PLATFORM-MASTER.md`
- Planos: `docs/billing/PLANOS-ALLDEBT.md`
- Smoke deploy: `docs/deploy/FIRST-DEPLOY.md`
- Deploy VPS: `docs/deploy/UPDATE.md`

---

## Registro de execução (cópia rápida)

```
Release: _______________
Ambiente: _______________
Data: _______________
Executor: _______________

P0 falhos: _______________
P1 falhos: _______________
Decisão: [ ] OK  [ ] Ressalvas  [ ] Reprovado
Observações:
-
-
```
