# AllDebt — Scorecard de Re-Auditoria

**Data:** 2026-09-02  
**Escopo:** estado atual do repositório (read-only)  
**Comitê:** Arquitetura, Segurança, SaaS, DevOps, PostgreSQL, Produto B2B, QA, Finanças, Protheus  
**Baseline histórico (referência):** SaaS 48 · Security 31 · Multi-Tenant 38 · Production 24

---

## Scores atuais (calculados do zero)

| Dimensão | Score | Tendência vs histórico |
|----------|------:|------------------------|
| **SAAS READINESS** | **54/100** | +6 |
| **TECHNICAL READINESS** | **58/100** | +12 |
| **SECURITY READINESS** | **67/100** | +36 |
| **MULTI-TENANT READINESS** | **81/100** | +43 |
| **DATABASE READINESS** | **71/100** | +8 |
| **PROTHEUS READINESS** | **61/100** | +5 |
| **TEST READINESS** | **36/100** | +4 |
| **CI/CD READINESS** | **34/100** | +2 |
| **PRODUCTION READINESS** | **38/100** | +14 |
| **ENGINE READINESS** | **86/100** | estável |
| **ARCHITECTURE READINESS** | **64/100** | +6 |
| **AUTH SECURITY** | **58/100** | +15 |
| **BACKGROUND PROCESSING** | **54/100** | +4 |
| **BILLING READINESS** | **28/100** | +3 |
| **OBSERVABILITY READINESS** | **41/100** | +5 |
| **FRONTEND TECHNICAL READINESS** | **57/100** | +4 |

---

## Engine integrity (B2.2)

| Verificação | Resultado |
|-------------|-----------|
| ENGINE SOURCE CHANGED | **NO** |
| ENGINE ENTRYPOINT CHANGED | **NO** |
| ENGINE ALIAS CHANGED | **NO** |
| ENGINE TESTS | **PASS** |
| FINANCIAL STRATEGIES | **PASS** |
| **ENGINE INTEGRITY** | **VERIFIED** |

---

## Vulnerabilidades (quantidade atual)

| Severidade | Qtd |
|------------|----:|
| **CRITICAL** | **0** |
| **HIGH** | **4** |
| **MEDIUM** | **8** |
| **LOW** | **12** |

### CRITICAL (0)

Nenhum breakout cross-tenant comprovado nos caminhos P0 após hardening e `test:p0` PASS.

### HIGH (4)

| ID | Risco |
|----|-------|
| H-01 | JWT sem revogação; logout não invalida token |
| H-02 | Upload aceita `?token=` na query string |
| H-03 | SSRF parcial em URL de ERP (sem blocklist IP privado) |
| H-04 | Scheduler: job pode executar sem ALS se `loadTenantByGroupId` falhar |

### MEDIUM (8)

| ID | Risco |
|----|-------|
| M-01 | RBAC: `users.role=admin` vs `tenant_users.ADMIN` inconsistente |
| M-02 | ERP `UPDATE ... WHERE id=$1` sem `group_id` no WHERE |
| M-03 | OpenAPI público (`/api/openapi.json`) |
| M-04 | Race condition nos limites de plano |
| M-05 | Sem MFA |
| M-06 | CI não executa test:p0/isolation/secrets |
| M-07 | Bundle JS principal ~2 MB (performance frontend) |
| M-08 | P0 migrations 047/048 ainda uncommitted no git |

### LOW (12)

Inclui: ~27 componentes shadcn não referenciados, 5 abas de teste no Simulator, pastas vazias pós-B2, `Configuracoes.jsx` stub, legado `base44/` e `server/`, ~35 git bundles na raiz, healthcheck ausente no container web, sem E2E, sem métricas, sem DR documentado, etc.

---

## Comparação histórica

| Área | Antes | Agora | Evolução |
|------|------:|------:|----------|
| SaaS Readiness | 48 | **54** | +6 — P0 + limpeza repo; billing ainda stub |
| Security Red Team | 31 | **67** | +36 — P0 fechou breakouts críticos |
| Multi-Tenant | 38 | **81** | +43 — scope, migrations 047/048, testes A≠B |
| Production Readiness | 24 | **38** | +14 — operável em piloto; não escala |
| Engine | ~85 | **86** | +1 — B2.2 removeu duplicata frontend |
| Testes | ~32 | **36** | +4 — suites P0/secrets criadas |
| CI/CD | ~32 | **34** | +2 — ainda mínimo |
| Frontend dead code | 29 órfãos | **~5 órfãos + 27 UI scaffold** | melhorou engine; UI scaffold permanece |

---

## Production readiness por escala

| Cenário | Mesma API + mesmo Postgres | Veredicto |
|---------|---------------------------|-----------|
| **1 cliente piloto** | Sim | **SIM COM RESTRIÇÕES** — ops manual, master admin, SMTP, ERP validado |
| **5 clientes** | Sim | **SIM COM RESTRIÇÕES** — monitoramento manual, limites de plano, sem billing real |
| **20 clientes** | Sim | **NÃO** — CI fraco, sem métricas/alertas, jobs cross-tenant claim, sem DR |
| **100 clientes** | Sim | **NÃO** — multi-tenant residual, observabilidade insuficiente, billing inexistente |

---

## Decisão final

### 🟡 PRONTO PARA PILOTO CONTROLADO

O sistema pode receber **1–3 clientes piloto** na mesma API e banco, com operação manual da plataforma, ERP validado por tenant e aceitação explícita de gaps em billing, observabilidade e CI.

**Não** está pronto para primeiros clientes pagos em escala nem para 20+ tenants sem investimento adicional.

---

## Quanto falta?

| Métrica | Valor |
|---------|------:|
| **Percorrido** | **54%** |
| **Faltando** | **46%** |

### Top 10 itens que explicam os 46% restantes

1. Billing real (gateway, webhook, fatura, dunning)
2. CI/CD completo (P0, isolation, secrets, build frontend, migrations)
3. Observabilidade operacional (métricas, alertas, runbooks 03:00)
4. Disaster recovery (backup/restore testado e documentado)
5. Auth enterprise (MFA, revogação JWT, sessões)
6. Hardening ERP (SSRF, UPDATE com group_id, idempotência formal)
7. Testes E2E + cobertura Protheus/billing/jobs
8. Scheduler robusto (DLQ, observabilidade por tenant, fail-safe ALS)
9. Performance/escala DB (limites de listagem, índices, bulk caps)
10. Remoção de dívida estrutural (bundles raiz, código morto frontend, legado base44/server)

---

## Gates de teste (2026-09-02, Docker)

| Suite | Comando | Resultado |
|-------|---------|-----------|
| Engine | `npm run test:engine` | **PASS** |
| Secrets | `node src/config/validateSecrets.test.js` | **PASS** |
| Isolation | `node src/modules/tenants/isolation.test.js` | **PASS** |
| P0 | `node src/modules/security/p0.test.js` | **PASS** |
| Frontend build | `npm run build` (web container) | **PASS** |

---

*Documento complementar: `ALLDEBT-REAUDIT-2026-09.md`*
