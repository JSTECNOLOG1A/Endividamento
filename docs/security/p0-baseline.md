# P0 baseline — isolamento multi-tenant

Data: 2026-09-01  
Escopo: estado **antes** das correções P0. Nenhum dado foi apagado.

## Estado inicial

- API/DB locais via Docker Compose (Postgres 16).
- Camada SaaS presente (`group_id` na maior parte das tabelas desde `042_tenant_isolation.sql`).
- Store genérico (`entities/store.js` + `tenantClause`) isola CRUD.
- Functions com SQL raw **não** herdam esse isolamento.
- Contratos/títulos/movimentos na base local: **0** (ambiente limpo de dados financeiros).
- Tenants: 2. Currencies seed: 3 (catálogo compartilhado, `group_id` nulo). `cdi_rates`: 0.

## Migrations aplicadas

001–046 (49 arquivos; há colisão de prefixo `003`, `004`, `025`). Última: `046_account_tokens.sql`.

Não existe `group_id` em:

- `account_movements` (`036_account_movements.sql`)
- `notification_log` (`029_notification_log.sql`)

## Testes existentes (antes)

| Suite | Comando | Resultado |
|---|---|---|
| Motor | `node src/engine/smoke.test.js` | PASS (`1.2.2`) |
| Isolamento store | `node src/modules/tenants/isolation.test.js` | PASS (só `LoanContract` list/getById) |

Não havia testes para functions, cleanup, billing, forgot-password, secrets ou RBAC vertical.

## Vulnerabilidades conhecidas (Red Team)

| ID | Problema | Arquivo |
|---|---|---|
| RT-01 | `deleteGuaranteedAccount` sem tenant | `payables/generate.js` |
| RT-02 | `cleanupOrphanedPayableTitles` DELETE global | `payables/generate.js` |
| RT-03 | `refreshGuaranteedAccountPayableTitle` sem tenant | `payables/generate.js` |
| RT-04 | `clearCDIRatesByType` / `clearCurrencyRates` wipe global | `functions/bacen.js` |
| RT-05 | `PATCH /api/billing/plan` self-upgrade | `billing/routes.js` |
| RT-06 | forgot-password devolve `reset_url` sem SMTP | `account/routes.js` |
| RT-07 | reopen vaza status antes do assert | `payables/generate.js` |
| RT-08 | `adminEmails()` global | `notifications/contractNotifications.js` |
| RT-10 | JWT/encryption/admin password com fallback | `config.js` |
| RT-11 | CREATE contrato já `aprovado` | `entities/store.js` |
| — | `AccountMovement` / `NotificationLog` fora de `ENTITY_SCOPE` | `tenants/scope.js` |
| — | `cleanupOrphanedReceivableTitles` DELETE global | `receivables/generate.js` |
| — | Master sem tenant: `WHERE TRUE` | `scope.js` / `access.js` |

## Tabelas afetadas neste ciclo

Tenant-owned (devem ter `group_id` + scope):

`groups`, `company_entities`, `loan_contracts`, `payable_titles`, `receivable_titles`, `account_movements`, `notification_log`, `calculation_snapshots`, `accounting_closings`, `contract_settlements`, `accounting_event_mappings`, `accounting_journal_entries`, `natures`, `bank_accounts`, `chart_of_accounts`, `tenants`, `tenant_users`, `integrations`, `scheduled_jobs`, `scheduled_job_runs`, `audit_events`

Catálogo compartilhado (`group_id` NULL = plataforma; preenchido = cópia do tenant):

`banks`, `currencies`, `holidays`, `cdi_rates`

Globais de identidade (não são recurso de tenant isolado por coluna):

`users`, `account_tokens`, `schema_migrations`, `platform_access_log`

## Registros sem `group_id` (consulta pré-correção)

| Tabela | Sem group_id / não mapeável |
|---|---|
| `account_movements` | 0 (tabela ainda sem coluna; 0 linhas) |
| `notification_log` | 0 linhas |
| `loan_contracts` | 0 com `group_id` NULL |
| `currencies` | 3 compartilhadas (legítimo) |

Nenhum registro financeiro órfão a preservar além do catálogo compartilhado de moedas.
