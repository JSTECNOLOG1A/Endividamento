# PLATFORM_MASTER — Administração da plataforma AllDebt

Documentação operacional do usuário global da plataforma (control plane SaaS), separado do administrador de cada cliente (tenant).

---

## 1. Conceitos

| Papel | Escopo | O que pode |
| --- | --- | --- |
| **PLATFORM_MASTER** | Plataforma AllDebt inteira | Tenants, planos, suspensão, auditoria administrativa, sessão de suporte |
| **TENANT_ADMIN / OWNER** | Somente o próprio tenant | Usuários, parâmetros, dados de negócio da empresa |

**Não confundir os dois.** O master **não** “vira” usuário do cliente ao trocar um seletor. Dados operacionais (contratos, títulos, valores, documentos) só entram com **sessão de suporte** auditada.

### Control plane × Data plane

- **Control plane:** administração SaaS (`/Platform`, `/api/platform/*`) — nome do tenant, CNPJ, plano, status, contagens agregadas, logs administrativos.
- **Data plane:** operação do cliente (Calculadora, Contratos, Financeiro, etc.) — exige `SupportSession` ativa.

Isso atende LGPD, least privilege e privacy by default.

### Planos comerciais

Diferença oficial entre **Starter**, **Pro** e **Enterprise** (limites enforced + empacotamento):

- Markdown: [`docs/billing/PLANOS-ALLDEBT.md`](../billing/PLANOS-ALLDEBT.md)
- PDF: [`docs/billing/PLANOS-ALLDEBT.pdf`](../billing/PLANOS-ALLDEBT.pdf)
- Catálogo técnico: `backend/src/modules/billing/plans.js`

---

## 2. Usuário master (ambiente local / seed)

| Campo | Valor |
| --- | --- |
| E-mail | `support@clarityib.com.br` |
| Senha padrão (dev) | `Endividamento!Local1` |
| Flag no banco | `users.platform_admin = TRUE` |
| Tenant | `NULL` (não pertence a nenhum cliente) |

Configure no `.env`:

```env
ADMIN_EMAIL=support@clarityib.com.br
ADMIN_PASSWORD=Endividamento!Local1
```

Na subida do stack, o seed promove/cria o usuário cujo e-mail é `ADMIN_EMAIL` como PLATFORM_MASTER.

> Em produção, troque a senha imediatamente e use política forte + MFA quando disponível.

---

## 3. Como acessar (passo a passo)

### 3.1 Login

1. Abra a interface (ex.: `http://localhost:5173`).
2. Entre com:
   - **E-mail:** `support@clarityib.com.br`
   - **Senha:** a definida em `ADMIN_PASSWORD`.

### 3.2 Abrir a administração da plataforma

Após o login, use uma das opções:

- Faixa superior **PLATFORM MASTER** → link **Administração da plataforma**
- Menu do usuário (avatar) → **Administração da plataforma**
- URL direta: `http://localhost:5173/Platform`

Telas principais:

| Rota | Função |
| --- | --- |
| `/Platform` | Visão geral (totais, planos, eventos) |
| `/PlatformTenants` | Lista de tenants + ações |
| `/PlatformTenantDetail?id=...` | Detalhe administrativo do tenant |
| `/PlatformAudit` | Log administrativo da plataforma |

### 3.3 Entrar nos dados do cliente (modo suporte)

Sem sessão de suporte, ao abrir Calculadora/Contratos etc. aparece erro do tipo:

> *Inicie uma sessão de suporte para acessar dados operacionais do cliente.*

Para liberar:

1. Vá em **Tenants** (`/PlatformTenants`).
2. Na linha do cliente, abra o menu **⋯**.
3. Clique em **Acessar para suporte**  
   (ou abra o detalhe do tenant e use o mesmo botão).
4. Preencha:
   - **Motivo** (obrigatório, mínimo 8 caracteres) — ex.: `Investigação do chamado SUP-2026-019`
   - **Referência** (opcional) — ex.: `SUP-2026-019`
   - **Duração:** 15, 30 ou 60 minutos (**nunca** indefinida)
5. Confirme. Se pedir **confirmação privilegiada**, digite a senha do master novamente (step-up).
6. Confirme o **banner âmbar** no topo: *“Você está acessando o tenant … em modo de suporte.”*

Enquanto o banner estiver ativo, o data plane funciona para aquele tenant. Use **Encerrar sessão de suporte** quando terminar (ou aguarde a expiração).

---

## 4. Ações administrativas comuns

Todas as ações críticas exigem **step-up** (senha recente) e geram auditoria.

| Ação | Onde | Observação |
| --- | --- | --- |
| Novo tenant | Tenants → **Novo tenant** | Cria tenant + usuário OWNER; envia e-mail com link `/aceitar-convite` para definir senha (7 dias). Sem SMTP, o link aparece na UI. |
| Ver detalhes | ⋯ → Ver detalhes | Control plane |
| Alterar plano | Detalhe → aba Plano | Com step-up |
| Suspender | ⋯ → Suspender | Motivo obrigatório |
| Reativar | ⋯ → Reativar | Após suspensão/desabilitação |
| Auditoria | `/PlatformAudit` ou aba no detalhe | Append-only; sem exclusão na UI |

### Status do tenant (`lifecycle_status`)

| Status | Significado |
| --- | --- |
| `PENDING` | Cadastro incompleto |
| `TRIAL` | Avaliação |
| `ACTIVE` | Uso normal |
| `SUSPENDED` | Bloqueio temporário |
| `DISABLED` | Desabilitado administrativamente |
| `CANCELLED` | Contrato cancelado |
| `DELINQUENT` | Inadimplência (quando usado) |

Tenant **suspenso / desabilitado / cancelado:** usuários do cliente recebem mensagem clara de acesso suspenso no login — **não** usamos exclusão física em massa pela UI.

Motivos de suspensão: `INADIMPLENCIA`, `SOLICITACAO_CLIENTE`, `SEGURANCA`, `VIOLACAO_CONTRATUAL`, `MANUTENCAO_ADMINISTRATIVA`, `OUTRO` (+ detalhe se OUTRO).

---

## 5. API (referência)

Base autenticada JWT. Rotas `/api/platform/*` exigem PLATFORM_MASTER.

| Método | Path | Uso |
| --- | --- | --- |
| GET | `/api/platform/overview` | Dashboard agregado |
| GET | `/api/platform/tenants` | Lista (`q`, `status`, `plan`) |
| POST | `/api/platform/tenants` | Criar tenant |
| GET | `/api/platform/tenants/:id` | Detalhe |
| PATCH | `/api/platform/tenants/:id` | Editar dados admin |
| PATCH | `/api/platform/tenants/:id/plan` | Plano / cobrança |
| POST | `/api/platform/tenants/:id/suspend` | Suspender |
| POST | `/api/platform/tenants/:id/reactivate` | Reativar |
| POST | `/api/platform/tenants/:id/disable` | Desabilitar |
| POST | `/api/platform/tenants/:id/cancel` | Cancelar |
| GET | `/api/platform/tenants/:id/users` | Usuários (mínimo necessário) |
| GET | `/api/platform/tenants/:id/audit` | Log do tenant |
| POST | `/api/platform/tenants/:id/support-session` | Iniciar suporte |
| GET | `/api/platform/support-session` | Sessão ativa |
| DELETE | `/api/platform/support-sessions/:id` | Encerrar suporte |
| POST | `/api/platform/step-up` | Confirmar senha (ações críticas) |
| GET | `/api/platform/access-log` | Auditoria da plataforma |

### Headers no data plane (modo suporte)

| Header | Função |
| --- | --- |
| `Authorization: Bearer …` | Sessão do master |
| `X-Support-Session-Id` | ID da sessão de suporte **ativa** |
| `X-Tenant-Id` | Tenant da sessão (deve coincidir) |

Sem `X-Support-Session-Id` válida, APIs de dados do cliente respondem com necessidade de suporte (`SUPPORT_SESSION_REQUIRED`).

---

## 6. Permissões (RBAC)

Exemplos declarados em `backend/src/modules/platform/permissions.js`:

- `platform.tenants.read` / `create` / `update` / `suspend` / `reactivate` / `disable` / `cancel`
- `platform.billing.read` / `manage`
- `platform.audit.read`
- `platform.support.start` / `end`
- `platform.overview.read`
- `platform.users.read`

O PLATFORM_MASTER recebe o conjunto completo. Evita-se “se for master, liberar tudo” sem permissão nomeada.

---

## 7. Auditoria e LGPD

Eventos típicos (além do `platform_access_log`):

- `PLATFORM_MASTER_LOGIN`
- `TENANT_CREATED` / `UPDATED` / `SUSPENDED` / `REACTIVATED` / `DISABLED` / `CANCELLED`
- `TENANT_PLAN_CHANGED`
- `SUPPORT_ACCESS_STARTED` / `ENDED` / `EXPIRED`

Na sessão de suporte, mutações no data plane continuam com **ator = PLATFORM_MASTER** e referência à sessão — **nunca** como se fossem o usuário final do cliente.

Registros de auditoria são **append-only** (não apagar pela interface).

---

## 8. Segurança (checklist)

- [x] Separação control plane / data plane  
- [x] Suporte com motivo, duração finita e banner  
- [x] Step-up para ações críticas  
- [x] Isolamento multi-tenant nas APIs normais  
- [x] Sem delete físico de tenant na UI administrativa  
- [ ] MFA TOTP/WebAuthn completo (scaffolding; step-up por senha já ativo)  
- [ ] IP allowlist / Zero Trust (opcional, não obrigatório na infra atual)  

Criação de PLATFORM_MASTER **não** ocorre por `/criar-conta` nem por admin de tenant — apenas seed/`ADMIN_EMAIL` ou procedimento administrativo controlado.

---

## 9. Testes

No backend:

```bash
docker compose exec -T api node src/modules/platform/platformMaster.test.js
```

Cobre: 403 para tenant admin em `/platform`, lista master, suspensão, bloqueio de login do cliente suspenso, reativação, sessão de suporte e isolamento do data plane.

---

## 10. Arquivos de código relevantes

| Área | Caminho |
| --- | --- |
| Migration | `backend/src/db/migrations/052_platform_master.sql` |
| API / serviço | `backend/src/modules/platform/` |
| Middleware | `backend/src/middleware/tenant.js` |
| UI console | `src/pages/Platform*.jsx` |
| Banner / modais | `src/components/platform/` |
| Contexto front | `src/lib/PlatformContext.jsx` |

---

## 11. FAQ rápido

**Por que vejo “Inicie uma sessão de suporte…”?**  
Porque você está logado como PLATFORM_MASTER sem sessão de suporte. Siga a seção 3.3.

**Posso usar o seletor antigo de cliente sozinho?**  
Não libera data plane. Use **Acessar para suporte**.

**Onde fica o master Clarity?**  
`support@clarityib.com.br` via `ADMIN_EMAIL` no `.env`.
