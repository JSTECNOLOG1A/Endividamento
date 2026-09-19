# Documento de QA — AllDebt

Manual de referência para testes e homologação do AllDebt (Endividamento).

| Campo | Valor |
|---|---|
| Produto | AllDebt |
| Repositório | Endividamento (`JSTECNOLOG1A/Endividamento`) |
| URL canônica | https://alldebit.clarityib.com.br |
| Alias | https://alldebt.clarityib.com.br |
| Local | UI `http://localhost:5173` · Health `http://127.0.0.1:3001/api/health` |
| Health produção | https://alldebt.clarityib.com.br/api/health |
| Versão | 1.0 — 2026-09-19 |

---

# Parte 1 — Mapa do produto

## 1. O que é

AllDebt é uma plataforma SaaS multi-tenant de **cálculo e gestão de empréstimos/financiamentos**, alinhada a práticas BACEN/CPC 26: cronogramas de amortização, contratos com alçada de aprovação, governança cadastral, contabilidade/fechamento, consolidação de dívidas, contas a pagar/receber (com ERP Protheus) e administração da plataforma (tenants, planos, suporte auditado).

---

## 2. Papéis e permissões

### Camada plataforma

| Papel | Identificação | Pode |
|---|---|---|
| **PLATFORM_MASTER** | `users.platform_admin = true` (seed via `ADMIN_EMAIL`) | Control plane: tenants, planos, suspender/reativar, auditoria, sessão de suporte |
| — | Sem sessão de suporte | Vê `/Platform*`; ao abrir Contratos/Calculadora recebe pedido de sessão de suporte |

### Camada tenant (cliente)

| Papel | Origem | Pode |
|---|---|---|
| **OWNER** | `tenant_users.role = OWNER` | Tudo admin + reabrir contrato imediato + integrar/estornar ERP + alçada N2 implícita |
| **Administrador** | `users.role = admin` | Usuários, parâmetros, lógica contábil, log; reabrir contrato só com 2º admin confirmando |
| **Usuário** | `role = user` | CRUD operacional; aprovação conforme `approval_level` |
| **Visualizador** | `role = viewer` | Somente leitura (`READ_ONLY` no backend) |

### Alçada de aprovação (independente do perfil)

| Nível | Significado |
|---|---|
| 0 | Nenhum |
| 1 | Aprovador N1 |
| 2 | Aprovador N2 (OWNER/master = 2 automático) |

### Regras extras de permissão

- Menu Configurações (Parâmetros, Lógica Contábil, Usuários, Log): **adminOnly** (admin/OWNER/master)
- Integração ERP (integrar/estornar AP/AR): tipicamente **OWNER**
- Excluir entidade: OWNER ou master
- Excluir conta garantida: admin
- Alterar plano SaaS: só PLATFORM_MASTER (`BILLING_LOCKED` para o cliente)

### Planos e limites

| Plano | Contratos ativos | Usuários |
|---|---|---|
| Starter | 10 | 3 |
| Pro | 50 | 10 |
| Enterprise | Ilimitado | Ilimitado |

> Contratos com status `cancelado` não contam no limite. Feature gates por plano ainda não escondem menus; a criação além do limite retorna erro (409).

---

## 3. Módulos, rotas e páginas

Rotas autenticadas no formato `/{PageName}` (ex.: `/Contracts`). Login público em `*`.

### Auth / conta (não autenticado)

| Rota | Função |
|---|---|
| `/` (login) | Login e-mail/senha |
| `/criar-conta` | Signup (CNPJ + empresa) |
| `/concluir-cadastro` | Definir senha pós-signup |
| `/esqueci-senha` | Pedido de reset |
| `/redefinir-senha` | Nova senha (token) |
| `/aceitar-convite` | Convite usuário/tenant |

### Núcleo de negócio

| Rota | Função |
|---|---|
| `/Contracts` | Lista/filtro contratos + detalhe; Novo Contrato; Conta Garantida |
| `/Simulator` | Calculadora (via Novo/Editar — fora do menu lateral) |
| `/GuaranteedAccounts` | Conta garantida (extrato, saques, renovação) |
| `/Governance` (+ sub) | Hub de cadastros |
| `/GovernanceGroups` | Grupos econômicos |
| `/GovernanceEntities` | Entidades (CNPJ/CPF, código Protheus) |
| `/GovernanceBanks` | Bancos + contas |
| `/GovernanceNatures` | Naturezas |
| `/GovernanceChart` | Plano de contas |
| `/Accounting` | Posição / Competência / Fluxo / Fechamento |
| `/Consolidation` | Consolidação (somente leitura) |
| `/AccountsPayable` | Contas a pagar + ERP |
| `/AccountsReceivable` | Contas a receber + ERP |
| `/CDIManager` | Indexadores e feriados |
| `/UserManual` | Manual + FAQ + PDF |
| `/onboarding` | Setup pós-signup (códigos Protheus) |

### Configurações

| Rota | Função | Quem |
|---|---|---|
| `/Settings` | Hub | Todos |
| `/SettingsIntegrations` | ERP REST Protheus | Todos (testar conexão) |
| `/SettingsSchedules` | Jobs (BACEN etc.) | Todos |
| `/SettingsParameters` | Layout, aparência, defaults | Admin+ |
| `/SettingsAccountingLogic` | Matriz evento→contas | Admin+ |
| `/SettingsUsers` | Convites, perfil, alçada, bloqueio | Admin+ |
| `/SettingsLog` | Auditoria operacional | Admin+ |
| `/SettingsPrivacy` | LGPD, consentimento, pedidos | Todos |
| `/SettingsAccount` | Conta / plano (leitura para cliente) | Todos |

### Platform (só master)

| Rota | Função |
|---|---|
| `/Platform` | Overview |
| `/PlatformTenants` | Lista + criar/suspender/suporte |
| `/PlatformTenantDetail?id=` | Detalhe, plano, audit |
| `/PlatformAudit` | Log administrativo |
| `/CommercialProposal` | PDF proposta comercial |

### Atenção QA

| Rota | Nota |
|---|---|
| `/Configuracoes` | Stub legado — **não** é o Settings real |

---

## 4. Fluxos principais

### A. Autenticação e primeiro acesso

1. Login na URL do ambiente.
2. Esqueci senha → e-mail → `/redefinir-senha` (ou link na UI se não houver SMTP).
3. Criar conta → CNPJ (Receita) → e-mail → `/concluir-cadastro` → senha.
4. 1º login tenant → modal **LGPD** → Product Tour opcional.
5. Onboarding se incompleto → `/onboarding` → códigos Protheus.
6. Sessão JWT (~8h); logout e expiração voltam ao login.

### B. Governança (pré-requisito)

1. Grupo econômico → Entidade → Banco (COMPE) → Conta bancária.
2. Opcional: importar contas/naturezas/plano do Protheus.
3. Sempre conferir seletor **Grupo/Empresa** na sidebar (causa clássica de “sumiu”).

### C. Contrato — cálculo e CRUD

1. Contratos → **+ Novo Contrato** → `/Simulator`.
2. Identificação + composição (IOF, taxas, indexador, convenção, PRICE/SAC/…) + prazos.
3. **Calcular** → tabela + CET; **Editar Datas** se necessário.
4. **Salvar Rascunho** ou **Enviar para Revisão**.
5. Anexar PDF; duplicar; editar se `rascunho`/`devolvido`.

### D. Aprovação (2 níveis)

1. N1: **Aprovar Nível 1** (permanece pendente).
2. N2: **Aprovar (Nível 2 — final)** → `aprovado`.
3. N2 pode fazer N1+N2 sozinho.
4. **Devolver** com comentário obrigatório → `devolvido` (reenvio nunca volta a `rascunho`).
5. Viewer: sem escrita / API 403.

### E. Pós-aprovação

1. AP/AR geram/sincronizam títulos ao abrir as telas.
2. Contabilidade: Posição, Competência, Fluxo, Fechamento.
3. Consolidação: totais por entidade/banco, curto vs longo prazo.
4. **Reabrir**: OWNER imediato; admin pede → outro admin confirma.
5. **Renegociar** / **Quitar antecipadamente** (quitação passa por aprovação).

### F. Conta garantida

1. Nova Conta Garantida → extrato → saque/pagamento → renovação (antigo → `cancelado`).

### G. Financeiro ERP

1. Integrações: URL/credencial → **Testar conexão**.
2. AP/AR: filtrar → classificar natureza → integrar → consultar → estornar (OWNER).
3. Converter PR→TX; reconverter FX pela PTAX.

### H. Indexadores e agendamento

1. CDIManager: CSV ou BACEN/BrasilAPI.
2. Settings → Agendamento: criar job, ativar/desativar, **rodar agora**.

### I. Platform master

1. Login master → Tenants → criar / suspender / reativar / plano (step-up).
2. **Acessar para suporte**: motivo ≥8 chars, duração 15/30/60, step-up → banner → Encerrar.
3. `/PlatformAudit` append-only.

### J. Privacidade / conta

1. Privacidade: docs, marketing, pedidos LGPD.
2. Conta/Plano: limites; cliente **não** muda plano.
3. Manual/FAQ; Proposta Comercial (só master).

---

## 5. Regras de negócio e edge cases

| Área | Regra |
|---|---|
| Status contrato | `rascunho` → `pendente_aprovacao` → `aprovado` / `devolvido`; também `cancelado`, `renegociado`, `quitado` |
| Pós-devolução | Reenvio → Pendente, **nunca** Rascunho |
| Alçada | Sempre N1 antes de N2; autoaprovação se tiver o nível |
| Reabertura | OWNER ok; admin precisa 2º admin; 1 admin só no tenant → bloqueio |
| Viewer / trial / suspenso | Write bloqueado (`READ_ONLY`, `TRIAL_EXPIRED`, `TENANT_SUSPENDED`) |
| Limites plano | Contagem contratos `status ≠ cancelado`; usuários excluem master |
| Master sem suporte | `SUPPORT_SESSION_REQUIRED` no data plane |
| Step-up | Ações críticas de platform exigem senha recente |
| Login | Rate limit 8/min; senha ≥8; user blocked/inactive → falha |
| Signup | CNPJ válido + único; domínio único; rate limit |
| Integração ERP | Conta precisa código Protheus na entidade + COMPE no banco |
| Contas matriz | Só analíticas |
| Export FX | Bloqueado se snapshot/integridade falhar |
| PDF contrato | Só `application/pdf` |
| Devolução | Comentário obrigatório |
| Fechamento | Reabrir período aprovado exige admin + justificativa |
| CDI | Fatores diários (dias úteis); lacunas afetam cálculo |
| USD | Visão caixa (PTAX pagamento) vs contábil (competência) |
| Layout | Modern padrão; Classic em Parâmetros |
| Isolamento | Multi-tenant por `group_id`/`tenant_id` |

---

## 6. Integrações

| Integração | Uso | Observação |
|---|---|---|
| **SMTP** | Signup, convite, reset | Sem SMTP → link na UI |
| **Microsoft Graph** | E-mail de documentos/avisos | Sem config → NotificationLog simulado |
| **Protheus (REST)** | Contas, naturezas, plano, títulos AP/AR | Credenciais AES |
| **BACEN** | CDI, SELIC, PTAX, IPCA, INPC, IGP-M, TJLP, TR | Manual + schedules |
| **BrasilAPI** | Feriados | Importador |
| **Receita (CNPJ)** | Signup lookup | Rate limit possível |
| **Upload** | PDF/anexos → `/uploads` | Multipart |
| WhatsApp | — | Não existe |
| Gateway pagamento | — | Não; billing = planos manuais pelo master |

APIs relevantes: `/api/auth/*`, `/api/public/*`, `/api/platform/*`, `/api/billing/*`, `/api/entities/:name`, `/api/functions/:name`, `/api/integrations/*`, `/api/schedules/*`, `/api/users/*`, `/api/parameters/*`, `/api/me`, `/api/legal`, `/api/health`, OpenAPI `/api/openapi.json`.

---

## 7. Ambientes

| Ambiente | URL / notas |
|---|---|
| **Local** | UI `http://localhost:5173` · API health `http://127.0.0.1:3001/api/health` |
| **Login master local** | Credenciais `ADMIN_*` no `.env` (ver `README.md`) |
| **Produção** | https://alldebit.clarityib.com.br (canônico) · https://alldebt.clarityib.com.br |
| **Legado / alias** | `endividamento.clarityib.com.br`, `staging-alldebt.clarityib.com.br` (redirects) |
| **VPS** | `/var/www/html/alldebt` · `docker-compose.traefik.yml` |

---

## 8. Personas de teste

| ID | Persona | Uso |
|---|---|---|
| M | PLATFORM_MASTER | Platform + suporte |
| O | OWNER | Fluxo completo + ERP |
| A2 | Admin N2 | Aprovação final e reabertura a 4 mãos |
| U1 | User N1 | Só nível 1 |
| V | Viewer | Somente leitura |
| S | Tenant Starter no limite | Bloqueios de plano |
| X | Tenant suspenso | Login recusado |

---

# Parte 2 — Roteiro de teste

## Como executar

1. Preencha ambiente, data e executor.
2. Marque cada caso: **OK** / **Falha** / **N/A** / **Bloqueado**.
3. Em falha: evidência, usuário, tenant, grupo econômico e passos até o erro.
4. Prioridade: **P0** = bloqueia release · **P1** = crítico · **P2** = importante · **P3** = desejável.

### Cabeçalho de execução

| Item | Preencher |
|---|---|
| Ambiente | [ ] Local · [ ] Staging · [ ] Produção |
| Data | |
| Executor | |
| Build / commit | |
| Resultado geral | [ ] Aprovado · [ ] Aprovado com ressalvas · [ ] Reprovado |

### Pré-requisitos globais

- [ ] Health `GET /api/health` → 200
- [ ] Tenant ativo com governança mínima (grupo + entidade + banco)
- [ ] Personas criadas (ou seed local)
- [ ] Confirmar **Grupo Econômico** na sidebar antes de cada fluxo
- [ ] Sem SMTP: usar link exibido na UI

---

## Bloco 0 — Smoke pós-deploy (P0)

| ID | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|
| S-01 | Health API | Abrir `/api/health` | HTTP 200 | |
| S-02 | Login master | Login `ADMIN_EMAIL` | Menu Administração da plataforma | |
| S-03 | Lista tenants | Platform → Tenants | Lista carrega | |
| S-04 | Layout padrão | Login tenant | Layout Modern | |
| S-05 | Isolamento master | Master sem suporte abre `/Contracts` | Pede sessão de suporte | |

---

## Bloco 1 — Autenticação e conta (P0/P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| A-01 | P0 | Login válido | E-mail + senha corretos | Entra na área autenticada | |
| A-02 | P0 | Login inválido | Senha errada | Erro; não autentica | |
| A-03 | P1 | Rate limit | ≥9 falhas em 1 min | Rate limit | |
| A-04 | P0 | Logout | Logout | Volta ao login | |
| A-05 | P1 | Sessão expirada | Navegar após JWT expirar | Redireciona ao login | |
| A-06 | P1 | Usuário bloqueado | Login de user blocked | Falha | |
| A-07 | P0 | Tenant suspenso | Login do OWNER do tenant X | Mensagem de suspensão | |
| A-08 | P1 | Esqueci senha | Reset → link → senha ≥8 | Login com nova senha | |
| A-09 | P1 | Token inválido | `/redefinir-senha` token falso | Erro | |
| A-10 | P0 | Criar conta | CNPJ novo → concluir cadastro | Tenant + OWNER; login ok | |
| A-11 | P1 | CNPJ inválido/duplicado | Signup inválido e depois duplicado | Erros; sem duplicata | |
| A-12 | P1 | Aceitar convite | Link `/aceitar-convite` | Usuário ativo | |
| A-13 | P1 | Convite com master logado | Abrir convite com sessão master | Logout / fluxo limpo | |

---

## Bloco 2 — Primeiro acesso e onboarding (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| F-01 | P0 | LGPD | 1º login tenant novo | Modal; só segue após aceitar | |
| F-02 | P2 | Product Tour | Após LGPD | Opcional; pode pular | |
| F-03 | P1 | Onboarding | `/onboarding` códigos Protheus | Concluído | |
| F-04 | P2 | Onboarding feito | Relogar | Banner não reaparece | |

---

## Bloco 3 — Platform Master (P0/P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| P-01 | P0 | Overview | `/Platform` | Resumo carrega | |
| P-02 | P0 | Criar tenant | Novo tenant trial Starter | OWNER recebe convite | |
| P-03 | P0 | Suspender | Suspender + motivo | Cliente não loga | |
| P-04 | P0 | Reativar | Reativar | Login volta | |
| P-05 | P0 | Alterar plano | Plano + step-up | Limites atualizam | |
| P-06 | P0 | Cliente não muda plano | OWNER → Conta/Plano | Somente leitura | |
| P-07 | P0 | Sessão suporte | Motivo ≥8, duração, step-up | Banner; acessa data plane | |
| P-08 | P0 | Encerrar suporte | Encerrar no banner | Data plane bloqueado de novo | |
| P-09 | P1 | Step-up | Ação crítica sem senha recente | Modal obrigatório | |
| P-10 | P1 | Auditoria | `/PlatformAudit` | Eventos append-only | |
| P-11 | P2 | Proposta comercial | `/CommercialProposal` | PDF; tenant não acessa | |

---

## Bloco 4 — Governança (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| G-01 | P0 | CRUD Grupo | Criar/editar grupo | Aparece no seletor | |
| G-02 | P0 | CRUD Entidade | CNPJ + código Protheus se ERP | Persiste no grupo | |
| G-03 | P0 | CRUD Banco/conta | COMPE + conta | Disponível na calculadora | |
| G-04 | P1 | Naturezas | CRUD | Persiste | |
| G-05 | P1 | Plano de contas | CRUD | Analíticas na matriz | |
| G-06 | P1 | Isolamento grupo | Criar em A; olhar B | Não aparece em B | |
| G-07 | P2 | Import ERP contas | Preview → confirmar | Importadas | |
| G-08 | P2 | Import naturezas/plano | Idem | Sem duplicar indevido | |
| G-09 | P1 | Excluir entidade | OWNER vs User | OWNER ok; User bloqueado | |

---

## Bloco 5 — Calculadora e contratos (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| C-01 | P0 | PRICE | Novo → Calcular | Tabela + CET | |
| C-02 | P0 | SAC | Calcular SAC | Parcelas decrescentes | |
| C-03 | P1 | Outros sistemas | SACRE/Americano/Bullet/% Residual | Sem crash | |
| C-04 | P1 | CDI + spread | Indexador CDI | Juros coerentes | |
| C-05 | P1 | Capitalização | “Fica na dívida” | Parcela menor; capitaliza | |
| C-06 | P1 | Editar datas | Editar Datas → recalcular | Respeita datas | |
| C-07 | P0 | Rascunho | Salvar rascunho | Status `rascunho` | |
| C-08 | P0 | Enviar revisão | Enviar para Revisão | `pendente_aprovacao` | |
| C-09 | P1 | Anexar PDF | Drag PDF / outro tipo | Só PDF | |
| C-10 | P1 | Duplicar | Duplicar | Novo editável | |
| C-11 | P1 | Devolvido | Editar → reenviar | Volta pendente (**não** rascunho) | |
| C-12 | P1 | Filtros | Status / banco | Lista coerente | |
| C-13 | P2 | PDF / e-mail | Ações documento | Gera / envia ou simula | |
| C-14 | P0 | Viewer | Login V | Sem escrita; API 403 | |

---

## Bloco 6 — Aprovação (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| AP-01 | P0 | N1 | U1 aprova N1 | Continua pendente | |
| AP-02 | P0 | N2 final | A2 aprova N2 | `aprovado` | |
| AP-03 | P1 | N2 sozinho | N2 faz N1+N2 | Aprovado | |
| AP-04 | P0 | Devolver | Com comentário | `devolvido` | |
| AP-05 | P1 | Sem comentário | Devolver vazio | Bloqueado | |
| AP-06 | P1 | Sem alçada | User nível 0 | Não aprova | |
| AP-07 | P0 | Títulos pós-aprovação | Abrir AP/AR | Títulos gerados/sync | |

---

## Bloco 7 — Reabrir, renegociar, quitar (P0/P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| L-01 | P0 | Reabrir OWNER | O reabre | Editável; títulos estornados | |
| L-02 | P0 | Reabrir 4 mãos | Admin pede → 2º confirma | Só com 2 admins | |
| L-03 | P1 | 1 admin só | Pedir reabertura | Bloqueio claro | |
| L-04 | P1 | Renegociar | Dialog renegociar | Status/novo contrato coerente | |
| L-05 | P1 | Quitar | Dialog quitação | Aprovação → `quitado` | |

---

## Bloco 8 — Conta garantida (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| CG-01 | P1 | Criar | Nova Conta Garantida | Criada | |
| CG-02 | P1 | Movimentos | Saque/pagamento | Extrato + título recalculam | |
| CG-03 | P1 | Renovar | Renovação | Antigo `cancelado` | |
| CG-04 | P2 | Excluir | Admin exclui | Removido | |

---

## Bloco 9 — Contabilidade e consolidação (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| CT-01 | P1 | Posição | Aba Posição | Saldos coerentes | |
| CT-02 | P1 | Competência | Aba Competência | Lançamentos do período | |
| CT-03 | P1 | Fluxo | Aba Fluxo | Projeções | |
| CT-04 | P0 | Fechamento | Fechar → baixas → aprovar | Período aprovado | |
| CT-05 | P1 | Reabrir fechamento | Admin + justificativa | Reabre | |
| CT-06 | P1 | Matriz | Lógica Contábil | Evento→contas salva | |
| CT-07 | P1 | Consolidação | Trocar grupo | Curtos/longos prazo | |
| CT-08 | P2 | Só leitura | Consolidação | Sem escrita | |

---

## Bloco 10 — Financeiro AP/AR e ERP (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| ER-01 | P1 | Testar conexão | Integrações → Testar | Sucesso ou erro claro | |
| ER-02 | P1 | Sync AP | Abrir Contas a Pagar | Títulos listados | |
| ER-03 | P1 | Classificar | Natureza no título | Salva | |
| ER-04 | P0 | Integrar ERP | OWNER integra | Integrado; consulta ok | |
| ER-05 | P0 | Estornar ERP | OWNER estorna | Ok; não-OWNER bloqueado | |
| ER-06 | P1 | PR→TX | Converter | Vira TX | |
| ER-07 | P1 | FX / PTAX | Reconverter | Valor atualizado | |
| ER-08 | P1 | AR | Fluxo análogo no Receber | Mesmo comportamento | |
| ER-09 | P2 | Export FX | Snapshot inválido | Bloqueado | |

---

## Bloco 11 — Indexadores e schedules (P1/P2)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| I-01 | P1 | CDI CSV | Importar CSV | Fatores importados | |
| I-02 | P1 | BACEN | Buscar índices | Dados atualizam | |
| I-03 | P2 | Feriados | BrasilAPI | Calendário preenchido | |
| I-04 | P1 | Lacuna CDI | Calcular sem fator | Erro/alerta controlado | |
| I-05 | P2 | Rodar job | Agendamento → Rodar agora | Executa | |
| I-06 | P2 | Desativar job | Desativar | Não roda | |

---

## Bloco 12 — Configurações (P1)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| CF-01 | P1 | Hub Settings | `/Settings` | Links corretos | |
| CF-02 | P0 | Convidar usuário | Admin convida | Convite; respeita limite | |
| CF-03 | P1 | Perfil/alçada | Editar role + nível | Persiste | |
| CF-04 | P1 | Bloquear user | Bloquear | Login falha | |
| CF-05 | P1 | AdminOnly | User comum | Sem menus admin | |
| CF-06 | P2 | Layout | Classic ↔ Modern | Persiste | |
| CF-07 | P2 | Log | `/SettingsLog` | Eventos visíveis | |
| CF-08 | P1 | Pedidos LGPD | ACCESS/…/ERASURE | Registrados | |
| CF-09 | P2 | Marketing | Opt-in/out | Salva | |
| CF-10 | P3 | `/Configuracoes` | Abrir legado | Stub (não é Settings) | |

---

## Bloco 13 — Planos e limites (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| PL-01 | P0 | Starter contratos | 11º contrato ativo | Bloqueio | |
| PL-02 | P0 | Starter usuários | Além de 3 | Bloqueio | |
| PL-03 | P1 | Upgrade master | Starter → Pro | Limites sobem | |
| PL-04 | P2 | Enterprise | Criar além de Pro | Sem teto prático | |
| PL-05 | P1 | Trial expirado | Write no trial vencido | `TRIAL_EXPIRED` | |

---

## Bloco 14 — Segurança e isolamento (P0)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| SEC-01 | P0 | Isolamento tenant | User A acessa dados B | 403 / vazio | |
| SEC-02 | P0 | Master sem suporte | Data plane | `SUPPORT_SESSION_REQUIRED` | |
| SEC-03 | P1 | Viewer write | POST/PATCH viewer | 403 `READ_ONLY` | |
| SEC-04 | P1 | Upload inválido | .exe/.docx | Rejeitado | |
| SEC-05 | P2 | Health/OpenAPI | Endpoints públicos | Sem dados de tenant | |

---

## Bloco 15 — Manual e UX (P2/P3)

| ID | Pri | Caso | Passos | Resultado esperado | Status |
|---|---|---|---|---|---|
| UX-01 | P2 | Manual | `/UserManual` | Conteúdo + PDF | |
| UX-02 | P3 | FAQ | Abrir FAQ | Respostas ok | |
| UX-03 | P2 | Mobile | Viewport estreito | Nav usável | |
| UX-04 | P3 | Grupo errado | Cadastrar em A; olhar B | “Sumiu” = grupo errado | |

---

## Matriz de regressão rápida (≈30 min)

1. S-01 … S-05  
2. A-01, A-07, A-10  
3. F-01  
4. P-02, P-07, P-08  
5. G-01 … G-03  
6. C-01, C-07, C-08  
7. AP-01, AP-02, AP-04  
8. L-01  
9. CT-04  
10. PL-01  
11. SEC-01, SEC-02  

---

## Checklist de evidências por release

- [ ] Casos marcados neste documento
- [ ] Prints dos P0 falhos (se houver)
- [ ] Commit / `DEPLOYED_COMMIT` testado
- [ ] Health produção 200
- [ ] Decisão: Aprovado / Ressalvas / Reprovado
- [ ] Bugs abertos com ID e severidade

### Registro rápido

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
```

---

## Referências

- Manual in-app: `src/data/manualContent.js` · `/UserManual`
- Platform: `docs/platform/PLATFORM-MASTER.md`
- Planos: `docs/billing/PLANOS-ALLDEBT.md`
- Smoke deploy: `docs/deploy/FIRST-DEPLOY.md`
- Deploy VPS: `docs/deploy/UPDATE.md`
- Roteiro (cópia focada só em casos): `docs/qa/ROTEIRO-TESTE-ALLDEBT.md`
