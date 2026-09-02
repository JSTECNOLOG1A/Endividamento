# AllDebt — Re-Auditoria 360° Completa

**Data:** 2026-09-02  
**Tipo:** somente leitura + testes + diagnóstico  
**Repositório:** `/Users/jeanoliveira/Documents/Arnon/Endividamento-git`  
**Commit HEAD:** `3dc3e2f` (B2.1 commitada) + working tree com B2.2 uncommitted, P0 uncommitted, branding AllDebt uncommitted

> **Regra:** nenhum código, layout, engine ou banco foi alterado durante esta auditoria.  
> Auditorias anteriores (`docs/security/*`, `docs/architecture/*`) preservadas como histórico.

---

## Sumário executivo

O AllDebt evoluiu significativamente em **segurança multi-tenant** (P0 hardening) e **organização do repositório** (Etapas A, B2.1, B2.2). O motor financeiro canônico permanece íntegro em `backend/src/engine/`. O produto core (simulador, contratos, títulos, ERP Protheus REST, contabilidade) é funcional para operação controlada.

**Principais gaps remanescentes:** billing comercial real, observabilidade operacional, CI incompleto, auth sem MFA/revogação, dívida estrutural (bundles, legado, código morto frontend).

**Decisão:** 🟡 **PRONTO PARA PILOTO CONTROLADO** (1–3 clientes, mesma API/DB, operação manual).

---

## 1. Inventário atual

### Contagens

| Área | Arquivos ativos | Notas |
|------|----------------:|-------|
| Frontend `src/` | **172** | 146 jsx, 23 js, 1 ts, assets |
| Backend `backend/src/` | **160** | 24 módulos + engine + db |
| Engine `backend/src/engine/` | **25** | Canônico, único |
| Migrations SQL | **51** | 001–048 (+ colisões 003/004/025) |
| Testes formais backend | **4** | smoke, isolation, secrets, p0 |
| Testes frontend (componentes) | **14** | sem runner Vitest/Jest |
| Docs | **8** | +2 desta auditoria |
| Archive | **42** | 33 bundles + 6 orphans + README |
| Protheus ADVPL (`protheus/`) | **0 no disco** | deletado no working tree |
| Legado `base44/` | presente | não usado pelo Docker |
| Legado `server/` | presente | SQLite, `dev:legacy` |
| Git bundles na raiz | **~35** | parcialmente fora de `archive/` |

### Frontend

| Categoria | Qtd estimada | Status |
|-----------|-------------:|--------|
| Produção ativa | ~130 | páginas, loan, governance, settings |
| UI shadcn não referenciado | ~27 | scaffold, baixo risco |
| Testes expostos (Simulator) | 5 abas | EngineTestSuite, ZeroRisk, Scenario, Snapshot, Integrity |
| Testes órfãos (bundle) | 8+ | FinalHardening, SnapshotRegression*, etc. |
| Órfãos comprovados | 5 | ApprovedContractManager, AuditLog, LegalComplianceValidator, ExchangeRateManager, ExportBrowserAdapter |
| Stub | 1 | Configuracoes.jsx (rota sem menu) |
| Engine duplicado frontend | **0** | B2.2 removeu strategies/indexers |
| Duplicata residual | 1 | roundMoney.jsx (só testes locais) |

### Backend módulos (24)

`account`, `audit`, `auth`, `bankAccounts`, `billing`, `calculate`, `chartAccounts`, `contracts`, `documents`, `entities`, `functions`, `health`, `integrations`, `notifications`, `onboarding`, `payables`, `platform`, `receivables`, `schedules`, `security`, `signup`, `tenants`, `users` + middleware/config/db/engine

### Comparação com auditoria anterior (B1)

| Métrica | B1 (199 files) | Atual |
|---------|---------------:|------:|
| Total frontend | 199 | **172** |
| Órfãos engine | 10 | **0** |
| Duplicatas engine | 10 | **0** |
| Órfãos gerais documentados | 29 | **~5 + 27 UI** |
| Bundles na raiz | 35 | **~35** (Etapa A incompleta no working tree) |

### Limpezas concluídas

| Etapa | Resultado |
|-------|-----------|
| **A** | 35 bundles → `archive/bundles/` (parcialmente revertido no working tree) |
| **B1** | Auditoria dead code documentada |
| **B2.1** | 19 órfãos removidos (saas, analytics, accounting/_to_delete, etc.) |
| **B2.2** | 10 arquivos engine duplicado removidos; engine canônico intacto |

---

## 2. Arquitetura atual

### Organização

- **Frontend:** React 18 + Vite + React Router; páginas em `src/pages/`; domínios em `components/{loan,governance,accounting,settings,payables}`; API client em `src/api/`.
- **Backend:** Express modular por domínio; store genérico CRUD (`entities/store.js` + `catalog.js`); functions RPC (`POST /api/functions/:name`).
- **Engine:** isolado em `backend/src/engine/`; consumido via alias `@engine` (Vite) e import relativo (API).
- **Infra:** Docker Compose (db + api + web); Postgres 16.

### Pontos fortes

- Separação engine/UI comprovada (B2.2).
- Multi-tenancy via AsyncLocalStorage + `tenantClause` / `scopedGroupSql`.
- Migrations incrementais com NUMERIC(18,2), TIMESTAMPTZ, append-only audit.
- OpenAPI + health/ready endpoints.

### Pontos fracos

- SQL raw espalhado em `functions/`, `payables/`, `receivables/` fora do store genérico.
- Frontend monolítico (~2 MB bundle) sem code-splitting.
- Legado `base44/`, `server/` coexistindo.
- RBAC dual (`users.role` vs `tenant_users.role`) sem unificação.

### **ARCHITECTURE READINESS: 64/100**

Modularidade backend boa; acoplamento ERP/financeiro alto; frontend carrega testes em produção; legado não podado.

---

## 3. Engine financeiro

### Caminho ativo (comprovado)

```
Simulator.jsx → src/lib/runCalculation.js → @engine/CalculationEngine.js → backend/src/engine/*
vite.config.js:13 → '@engine': './backend/src/engine'
backend/src/modules/calculate/service.js → ../../engine/CalculationEngine.js
```

### Integridade B2.2

- `git diff 3dc3e2f -- backend/src/engine/` → **vazio**
- 25 arquivos SHA-256 idênticos ao commit `3dc3e2f`
- **ENGINE INTEGRITY: VERIFIED**

### Sistemas de amortização

| Sistema | Backend | Testado 2026-09-02 |
|---------|---------|-------------------|
| SAC | SACStrategy.js | PASS |
| PRICE | PRICEStrategy.js | PASS |
| SACRE | SACREStrategy.js | PASS |
| AMERICANO | AMERICANOStrategy.js | PASS |
| BULLET | BULLETStrategy.js | PASS |
| PERCENTAGE_RESIDUAL | PERCENTAGE_RESIDUAL_Strategy.js | PASS |

### Indexadores

| Indexador | Backend | Testado |
|-----------|---------|---------|
| CDI | CDIIndexer.js | PASS |
| SELIC | SELICIndexer.js | PASS |
| IPCA | IPCAIndexer.js | PASS |
| INPC | INPCIndexer.js | PASS |
| IGP-M | IGPMIndexer.js | PASS |
| TJLP | TJLPIndexer.js | PASS |
| TR | TRIndexer.js | PASS |
| PTAX/USD | DollarIndexer.js | PASS |

### Avaliação técnica

| Critério | Estado |
|----------|--------|
| Isolamento de UI | ✅ Proibido por contrato arquitetural |
| Versionamento | ✅ ENGINE_VERSION 1.2.2, BUILD_ID |
| Determinismo | ✅ SHA-256 fingerprint strict |
| Arredondamento | ✅ roundMoney HALF_EVEN final-only |
| Precision | ✅ PrecisionLayer + Decimal.js |
| Testabilidade | ⚠️ smoke.test.js cobre PRICE; sem suite por sistema |
| Regressão CI | ⚠️ só smoke no CI |

### **ENGINE READINESS: 86/100**

Motor maduro e isolado; falta cobertura automatizada ampla e gates CI completos.

---

## 4. Multi-tenancy

### Mecanismo

1. JWT → `requireAuth` → `attachTenant`
2. `runWithTenant` (AsyncLocalStorage)
3. `tenantClause` / `scopedGroupSql` em queries
4. Master exige `x-tenant-id` (P0-14: `TENANT_CONTEXT_REQUIRED`)

### Tabela tenant-owned

| Entidade | group_id | FK | Índice | Scope backend | Risco |
|----------|----------|-----|--------|---------------|-------|
| groups | id (PK) | — | PK | type:id | TENANT SAFE |
| company_entities | sim | groups | 042 | column | TENANT SAFE |
| loan_contracts | sim | groups | 042 | column | TENANT SAFE |
| payable_titles | sim | groups | 042 | column | TENANT SAFE |
| receivable_titles | sim | groups | 042 | column | TENANT SAFE |
| account_movements | sim (047) | groups+contracts | 047 | column | TENANT SAFE |
| notification_log | sim (048) | groups+contracts | 048 | column | TENANT SAFE |
| calculation_snapshots | sim | groups | 042 | column | TENANT SAFE |
| accounting_closings | sim | groups | 042 | column | TENANT SAFE |
| contract_settlements | sim | groups | 042 | column | TENANT SAFE |
| accounting_event_mappings | sim | groups | 042 | column | TENANT SAFE |
| accounting_journal_entries | sim | groups | 042 | column | TENANT SAFE |
| natures | sim | groups | 042 | column | TENANT SAFE |
| bank_accounts | sim | groups | 042 | column | TENANT SAFE |
| chart_of_accounts | sim | groups | 042 | column | TENANT SAFE |
| tenants | sim | groups | 042 | column | TENANT SAFE |
| tenant_users | sim | groups+tenants | 042 | column | TENANT SAFE |
| integrations | sim | groups | 042 | scopedGroupSql | TENANT SAFE |
| scheduled_jobs | sim | groups | 042 | group_id em store | INDETERMINADO |
| scheduled_job_runs | sim | groups | 042 | parcial | INDETERMINADO |
| audit_events | sim (nullable) | groups | 042 | scopedGroupSql | TENANT SAFE |
| documents/uploads | via contract | — | — | assertContractInTenant | TENANT SAFE |
| users | global | — | email unique | JOIN tenant_users | GLOBAL LEGÍTIMO |
| banks | shared/null | groups | partial unique | shared | GLOBAL LEGÍTIMO |
| currencies | shared/null | groups | partial unique | shared | GLOBAL LEGÍTIMO |
| holidays | shared/null | groups | partial unique | shared | GLOBAL LEGÍTIMO |
| cdi_rates | shared/null | groups | partial unique | shared | GLOBAL LEGÍTIMO |

### Queries sem tenant explícito (classificação)

| Padrão | Classificação | Exemplos |
|--------|---------------|----------|
| Health, login, signup | GLOBAL LEGÍTIMO | `SELECT 1`, users por email |
| Store genérico + scope | TENANT SAFE | entities/store.js |
| Functions destrutivas pós-P0 | TENANT SAFE | delete/cleanup/refresh com group_id |
| ERP UPDATE por id | INDETERMINADO | erpIntegrate.js após SELECT scoped |
| claimDueJobs (all tenants) | GLOBAL LEGÍTIMO | worker infra; ALS por job |
| Master sem tenant + dados cliente | **BLOCKED** | TENANT_CONTEXT_REQUIRED |

### **MULTI-TENANT READINESS: 81/100**

P0 fechou breakouts críticos; residual em ERP UPDATEs e scheduler.

---

## 5. Re-Red-Team

| Ataque | Resultado | Status |
|--------|-----------|--------|
| Tenant A GET/PATCH/DELETE recurso B | 404, B intacto | **BLOCKED** |
| Tenant A refresh/reopen/generate B | 404/403 | **BLOCKED** |
| deleteGuaranteedAccount cross-tenant | 404 | **BLOCKED** |
| cleanupOrphanedPayableTitles global | 403 tenant; master+A scoped | **BLOCKED** |
| cleanup receivables cross-tenant | idem | **BLOCKED** |
| refreshGuaranteedAccountPayableTitle B | 404 | **BLOCKED** |
| clearCDIRatesByType wipe global por tenant | 0 deletes globais | **BLOCKED** |
| clearCurrencyRates wipe global por tenant | idem | **BLOCKED** |
| account_movements cross-tenant | group_id + scope | **BLOCKED** |
| notification_log cross-tenant | group_id + scope | **BLOCKED** |
| adminEmails() vaza emails de outro tenant | scoped tu.group_id | **BLOCKED** |
| self-upgrade ENTERPRISE | 403 BILLING_LOCKED | **BLOCKED** |
| billing_status manipulation via PATCH plan | 403 | **BLOCKED** |
| forgot-password vaza reset_url | resposta genérica | **BLOCKED** |
| invite token em production | só non-prod se SMTP fail | **BLOCKED** |
| JWT replay após logout | token ainda válido até exp | **STILL EXPLOITABLE** |
| JWT secret fallback production | fail-fast validateSecrets | **BLOCKED** |
| mass assignment status/approved_by | CREATE rascunho; PATCH ignora | **BLOCKED** |
| mass assignment group_id/role/plan | store blocked / billing locked | **BLOCKED** |
| Upload token query string | ainda aceito | **PARTIAL** |
| SSRF ERP URL interna | sem blocklist IP | **STILL EXPLOITABLE** |
| Scheduler job sem tenant context | falha ou indefinido | **PARTIAL** |

---

## 6. P0 Security — revalidação

| P0 | Implementação | Teste | Resultado |
|----|---------------|-------|-----------|
| Tenant isolation CRUD A≠B | scope.js, store.js, p0.test.js | test:p0 | **PASS** |
| account_movements group_id | migration 047, catalog, scope | test:p0 | **PASS** |
| notification_log group_id | migration 048, catalog, scope | test:p0 | **PASS** |
| Reset token não vazado | account/routes.js resposta genérica | test:p0 | **PASS** |
| Invite token production | users/service.js | test:p0 | **PASS** |
| JWT secret production | validateSecrets.js + config.js | test:secrets | **PASS** |
| Billing self-upgrade | billing/routes.js 403 | test:p0 | **PASS** |
| Mass assignment contrato | store.js force rascunho | test:p0 | **PASS** |
| adminEmails scoped | contractNotifications.js | test:p0 | **PASS** |
| Funções destrutivas scoped | payables/receivables/bacen | test:p0 | **PASS** |
| Catálogo global wipe | master-only sem tenant | test:p0 | **PASS** |
| Master sem tenant vê cliente | TENANT_CONTEXT_REQUIRED | test:p0 | **PASS** |

**Nota:** migrations 047/048 e código P0 existem no working tree; **não commitados** no HEAD `3dc3e2f`.

---

## 7. RBAC

### Papéis reais (código + schema)

| Papel | Onde | Valores |
|-------|------|---------|
| Platform admin | users.platform_admin | boolean |
| User role | users.role | admin, user, viewer |
| Tenant role | tenant_users.role | OWNER, ADMIN, VIEWER |

### Matriz simplificada

| Ação | PLATFORM | OWNER | ADMIN (tenant) | USER | VIEWER |
|------|----------|-------|----------------|------|--------|
| read contratos | ✅* | ✅ | ✅ | ✅ | ✅ |
| create/update | ✅* | ✅ | ✅ | ✅ | ❌ |
| delete contrato | ✅* | ✅ | ✅ | ❌ | ❌ |
| approve | ✅* | ✅ | ✅† | ❌ | ❌ |
| reopen | ✅* | ✅ imediato | confirmação | ❌ | ❌ |
| ERP integrate/reverse | ✅* | ✅ | ❌‡ | ❌ | ❌ |
| users CRUD | ✅* | ✅§ | ❌§ | ❌ | ❌ |
| billing read | ✅* | ✅ | ✅ | ✅ | ✅ |
| billing change | master API | ❌ (403) | ❌ | ❌ | ❌ |
| cleanup platform | ✅* | ❌ | ❌ | ❌ | ❌ |
| platform tenants | ✅ | ❌ | ❌ | ❌ | ❌ |

\* Requer `x-tenant-id`  
† Não self-approval  
‡ OWNER_FUNCTIONS; tenant_users.ADMIN sem users.role=admin não passa em users/audit routes  
§ users/routes exige `requireRole("admin")` = users.role, não tenant_users.ADMIN

### Inconsistência conhecida

`tenant_users.role=ADMIN` + `users.role=user` → ERP OK (OWNER_FUNCTIONS usa tenantRole) mas gestão de usuários/audit **negada**.

---

## 8. Autenticação e sessão

| Controle | Estado |
|----------|--------|
| Login bcrypt | ✅ |
| Rate limit login | ✅ 8/min |
| Rate limit forgot-password | ✅ 8/15min |
| JWT expiration | ✅ 8h default |
| Logout revogação | ❌ stateless |
| Reset password | ✅ token SHA-256, TTL 2h |
| Invite | ✅ 7 dias |
| Lockout | ❌ |
| MFA | ❌ |
| Password policy | ⚠️ mínima |
| Token reuse | ⚠️ JWT válido até exp |
| Secrets production | ✅ fail-fast |

### **AUTH SECURITY: 58/100**

Autenticação básica sólida; sessão enterprise (revogação, MFA, lockout) ausente.

---

## 9. Banco de dados

### Migrations: 51 arquivos (001–048)

- Colisões de prefixo: 003 (×2), 004 (×2), 025 (×2)
- Últimas: 046 account_tokens, 047 account_movements group_id, 048 notification_log group_id

### Pontos fortes

- NUMERIC(18,2) para valores monetários
- FKs tenant via group_id (042+)
- Índices parciais unique em catálogos shared
- audit_events append-only + trigger immutability
- scheduled_jobs FOR UPDATE SKIP LOCKED

### Riscos

- Listagens genéricas sem LIMIT documentado (entities store)
- Race nos limites contracts_used / plan
- Migrations P0 uncommitted
- Sem política de backup/restore no repositório

### **DATABASE READINESS: 71/100**

Schema maduro para piloto; falta hardening operacional e performance em escala.

---

## 10. Protheus

### Estado técnico

- Integração via **REST Node** (`integrations/protheus.js`, `protheusScope.js`, `erpConnection.js`)
- ADVPL em `protheus/` **removido** do working tree
- SE1/SE2 via `payables/erpIntegrate.js`, `receivables/erpIntegrate.js`
- Contexto: tenantId (grupo), company, branch via headers
- Paginação 500, concorrência 3 escopos
- Estorno, consulta, reprocessamento implementados
- Idempotência parcial (flags integrado_erp)
- Retry/timeout configurável (5–120s)

### Gaps

- SSRF em base_url ERP
- UPDATE por id sem group_id no WHERE
- Sem testes automatizados Protheus
- Dependência de conectividade ERP por tenant

### **PROTHEUS INTEGRATION READINESS: 61/100**

Funcional para piloto com ERP validado; resiliência e segurança incompletas.

---

## 11. Jobs / Scheduler

| Componente | Estado |
|------------|--------|
| Runner in-process | setInterval 20s |
| SKIP LOCKED | ✅ claimDueJobs |
| Tenant context | runWithTenant por job |
| Retry | ⚠️ manual via re-execução |
| DLQ | ❌ |
| Observabilidade | ultima_mensagem em scheduled_jobs |
| Jobs órfãos | unique por tarefa (global pre-042; per-tenant post-042) |

Tarefas: consultar AP/AR, converter PR→TX, PTAX BACEN, índices BACEN.

### **BACKGROUND PROCESSING: 54/100**

Funcional para piloto; falta DLQ, métricas e fail-safe ALS.

---

## 12. Billing

| Capacidade | Classificação |
|------------|---------------|
| Plans (STARTER/PRO/ENTERPRISE) | IMPLEMENTADO |
| Limits (contracts/users) | IMPLEMENTADO |
| Trial | IMPLEMENTADO |
| billing_status suspended | IMPLEMENTADO |
| Upgrade self-service | BLOQUEADO (403) |
| Master muda plano | IMPLEMENTADO (platform API) |
| Gateway pagamento | NÃO IMPLEMENTADO |
| Webhook | NÃO IMPLEMENTADO |
| Invoice/dunning | NÃO IMPLEMENTADO |
| Subscription lifecycle | PARCIAL |

### **BILLING READINESS: 28/100**

Enforcement de limites OK; monetização real inexistente.

---

## 13. Observabilidade

| Capacidade | Estado |
|------------|--------|
| Pino structured logs | ✅ |
| Request ID | ✅ X-Request-Id |
| Audit HTTP + DB | ✅ |
| Health / Ready | ✅ |
| Metrics (Prometheus) | ❌ |
| Alerts | ❌ |
| Tracing | ❌ |
| Log redaction | ✅ Authorization redacted |
| Backup/restore documentado | ❌ |
| DR runbook | ❌ |

**03:00 — como descobrimos?** Apenas se alguém monitorar logs Docker manualmente ou cliente reportar. Sem alertas.

**Banco corrompido — como restauramos?** Volume Docker `pgdata`; sem runbook testado no repo.

### **OBSERVABILITY READINESS: 41/100**

---

## 14. Testes

| Área | Testes existentes | Cobertura crítica |
|------|-------------------|-------------------|
| engine | smoke.test.js | PRICE + ancoragem datas |
| security P0 | p0.test.js | A≠B, functions, billing, reset |
| tenant isolation | isolation.test.js | LoanContract list/getById |
| secrets | validateSecrets.test.js | production fail-fast |
| auth | dentro p0.test.js | parcial |
| billing | dentro p0.test.js | self-upgrade |
| Protheus | nenhum | ❌ |
| database | nenhum formal | ❌ |
| frontend | componentes manuais | ❌ automatizado |
| E2E | nenhum | ❌ |
| integration | p0 HTTP | parcial |
| load | nenhum | ❌ |

### **TEST READINESS: 36/100**

---

## 15. CI/CD

**Workflow:** `.github/workflows/ci.yml`

| Gate | CI atual |
|------|----------|
| Syntax check | ✅ |
| test:engine | ✅ |
| docker compose config | ✅ |
| test:p0 | ❌ |
| test:isolation | ❌ |
| test:secrets | ❌ |
| frontend build | ❌ |
| lint | ❌ |
| migrations | ❌ |

### **CI/CD READINESS: 34/100**

---

## 16. Repositório — limpezas

| Etapa | Melhorou? | Dívida restante |
|-------|-----------|-----------------|
| A (archive) | Parcial | ~35 bundles ainda na raiz |
| B1 (19 órfãos) | Sim | pastas vazias |
| B2.1 | Sim | ApprovedContractManager, Configuracoes |
| B2.2 | Sim | pastas strategies/indexers vazias |

**Organização melhorou?** Sim, especialmente engine e órfãos críticos.

**Dívida estrutural:** bundles raiz, base44/, server/, UI scaffold, test tabs Simulator, P0 uncommitted.

---

## 17. Frontend (técnico — sem redesign)

| Critério | Avaliação |
|----------|-----------|
| Qualidade código | Moderada; componentes grandes |
| Duplicação | Reduzida (engine); roundMoney residual |
| Arquitetura | runCalculation → @engine correto |
| Performance | Bundle 2 MB — warning Vite |
| Dependências | Radix/shadcn, sem audit automatizado |
| Segurança frontend | JWT em memória; token upload query |

### **FRONTEND TECHNICAL READINESS: 57/100**

Layout congelado por decisão de produto — fora do escopo de ação.

---

## 18–24. Scores, bloqueadores, ações, decisão

Ver **`ALLDEBT-SCORECARD-2026-09.md`** para scores consolidados, bloqueadores P0–P3, Top 15 ações e decisão final.

### Bloqueadores resumidos

**P0 (bloqueia cliente real):** nenhum exploit comprovado pós-P0; porém P0 **não commitado** — risco de regressão em deploy limpo.

**P1 (bloqueia comercialização):** billing real, CI completo, MFA/revogação JWT, observabilidade.

**P2 (90 dias):** E2E, Protheus tests, scheduler DLQ, remover dead code frontend, commit P0+B2.2.

**P3 (escala):** métricas, DR, performance DB, code-splitting.

### Top 15 ações (não concluídas)

1. Commitar P0 + migrations 047/048 + B2.2
2. CI: test:p0 + isolation + secrets + frontend build
3. Billing gateway + webhook idempotente
4. JWT revocation / refresh token store
5. Remover `?token=` de uploads
6. SSRF blocklist em erpConnection
7. ERP UPDATE com group_id no WHERE
8. MFA para admin/owner
9. Métricas + alertas (health, error rate, job failures)
10. Backup/restore Postgres documentado e testado
11. E2E piloto (login → contrato → título → ERP)
12. Ocultar abas teste Simulator (prod flag)
13. Mover bundles raiz → archive/
14. Unificar RBAC users.role ↔ tenant_users.role
15. Scheduler fail-safe se loadTenantByGroupId null

---

## 25. Execução desta auditoria

### Testes executados (Docker, 2026-09-02)

```
test:engine          PASS
validateSecrets      PASS
isolation.test.js    PASS
p0.test.js           PASS
npm run build (web)  PASS (9.36s, 3560 módulos)
```

### Engine strategies/indexers (node one-shot)

SAC, PRICE, SACRE, BULLET, AMERICANO, PERCENTAGE_RESIDUAL + CDI, SELIC, USD, IPCA, INPC, IGPM, TJLP, TR → **PASS**

### Arquivos criados

- `docs/audits/ALLDEBT-REAUDIT-2026-09.md` (este documento)
- `docs/audits/ALLDEBT-SCORECARD-2026-09.md`

### Não alterado

Código, layout, engine, banco, migrations, UI, Simulator, menu, logo, textos.

---

**FIM DA RE-AUDITORIA — PARADO.**

Próximo passo requer aprovação explícita (commit P0/B2.2, implementação de itens P1+).
