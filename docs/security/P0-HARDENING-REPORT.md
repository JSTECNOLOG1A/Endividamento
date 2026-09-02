# P0 hardening — relatório final

Data: 2026-09-01  
Código alterado apenas no ciclo P0. Sem billing real, sem MFA, sem mudanças no CalculationEngine.

## Antes

Red Team (scores): Security **31/100**, isolamento **38/100**.

Vulnerabilidades bloqueadoras:

- Functions SQL raw sem `group_id` (`deleteGuaranteedAccount`, `cleanupOrphaned*`, `refreshGuaranteedAccountPayableTitle`, `reopen` com leak).
- Wipe global de CDI/PTAX.
- `account_movements` e `notification_log` sem tenant.
- `adminEmails()` global.
- `forgot-password` devolvia `reset_url` sem SMTP.
- Secrets com fallback em production.
- CREATE de contrato já `aprovado`.
- `PATCH /api/billing/plan` self-upgrade ENTERPRISE.
- Master sem tenant: `WHERE TRUE` em dados de cliente.

Baseline: `docs/security/p0-baseline.md`. Testes prévios: engine PASS, isolation store PASS. Dados financeiros na base: 0. Órfãos: 0.

## Alterações (arquivo)

| Arquivo | O quê |
|---|---|
| `backend/src/modules/tenants/scope.js` | Primitivas `requireTenantContext`, `selectResourceForTenant`, `assertResourceInTenant`, `assertIdsBelongToTenant`, `logIsolationMiss`. `AccountMovement` e `NotificationLog` no `ENTITY_SCOPE`. Master sem tenant **não** vê dados de cliente. |
| `backend/src/modules/tenants/access.js` | `scopedGroupSql` exige tenant; unscoped só com flag explícita. |
| `backend/src/modules/tenants/policy.js` | `assertPlatformAdminWithTenant`. |
| `backend/src/modules/entities/catalog.js` | `group_id` em AccountMovement e NotificationLog. |
| `backend/src/modules/entities/store.js` | CREATE força `rascunho`; PATCH ignora campos de workflow do cliente; `contract_id` validado no tenant. |
| `backend/src/modules/payables/generate.js` | delete/cleanup/refresh/reopen/FX scoped + transações. Cleanup só master+tenant. Delete conta garantida só admin. |
| `backend/src/modules/receivables/generate.js` | cleanup/reverse scoped; cleanup só master+tenant. |
| `backend/src/modules/payables/erpIntegrate.js` | DELETE de título estornado com `group_id`. |
| `backend/src/modules/receivables/erpIntegrate.js` | idem. |
| `backend/src/modules/functions/bacen.js` | clear CDI/currency: global só master sem tenant; senão só `group_id` do tenant. |
| `backend/src/modules/functions/routes.js` | RBAC: cleanup=master+tenant, delete CG=admin. |
| `backend/src/modules/notifications/contractNotifications.js` | `adminEmails()` via `tenant_users.group_id`. |
| `backend/src/modules/account/routes.js` | forgot-password resposta genérica, sem token. |
| `backend/src/modules/users/service.js` | `invite_url` só fora de production e só se SMTP falhou. |
| `backend/src/config/validateSecrets.js` | fail-fast production. |
| `backend/src/config.js` | sem fallback inseguro em production. |
| `backend/src/index.js` | valida secrets no boot. |
| `backend/src/modules/billing/routes.js` | PATCH plan = 403 `BILLING_LOCKED`. |
| `backend/src/middleware/tenant.js` | log de write do master em tenant. |
| `backend/src/logger.js` + `app.js` | redact de Authorization/token. |
| `src/components/settings/PlanPanel.jsx` | cliente não “ativa plano”; master continua via platform API. |
| `docker-compose.yml` | `NODE_ENV` default development (local não quebra o fail-fast). |
| `backend/package.json` | `test:p0`, `test:secrets`. |

## Migrations

| Arquivo | Efeito |
|---|---|
| `047_account_movements_group_id.sql` | coluna, backfill via `loan_contracts`, FK, índice, NOT NULL |
| `048_notification_log_group_id.sql` | idem via `contract_id` |

Aplicadas com sucesso no ambiente local. Sem DROP/TRUNCATE/DELETE de dados.

## Dados migrados

| Tabela | Linhas | Backfill | Órfãos |
|---|---|---|---|
| `account_movements` | 0 | 0 | 0 |
| `notification_log` | 0 | 0 | 0 |

Nenhum registro problemático. Se no futuro a migration encontrar órfãos, ela **aborta** (não chuta tenant, não apaga).

## Matriz ENTITY_SCOPE

| Entity | Tenant-owned | group_id | ENTITY_SCOPE | FK | Index | Status |
|---|---|---|---|---|---|---|
| Group | sim (id) | id | id | PK | PK | OK |
| CompanyEntity | sim | sim | column | sim | sim | OK |
| LoanContract | sim | sim | column | sim | sim | OK |
| PayableTitle / ReceivableTitle | sim | sim | column | sim | sim | OK |
| AccountMovement | sim | **novo** | column | novo | novo | OK |
| NotificationLog | sim | **novo** | column | novo | novo | OK |
| CalculationSnapshot / closings / settlements / journal / mapping | sim | sim | column | sim | 042 | OK |
| Nature / BankAccount / ChartOfAccount | sim | sim | column | sim | unique parcial | OK |
| Tenant / TenantUser | sim | sim | column | sim | PK | write bloqueado no store |
| Bank / Currency / Holiday / CDIRate | shared | NULL ou group | shared | parcial | unique parcial | delete global só master |
| users / account_tokens | identidade | não | n/a | — | — | JOIN em tenant_users |

## Testes criados

| Arquivo | Cobre |
|---|---|
| `backend/src/config/validateSecrets.test.js` | production fail-fast / defaults |
| `backend/src/modules/security/p0.test.js` | A≠B CRUD, functions, cleanup, refresh, reopen, CDI/PTAX, adminEmails, CREATE aprovado, PATCH approved_by, master sem tenant, forgot-password, billing lock, invite URL, integridade do tenant B |

Scripts: `npm run test:p0`, `npm run test:secrets` (no container: `node src/modules/security/p0.test.js`).

## Resultados

| Suite | Resultado |
|---|---|
| `validateSecrets.test.js` | **PASS** |
| `p0.test.js` | **PASS** |
| `isolation.test.js` | **PASS** |
| `smoke.test.js` (engine) | **PASS** |

## Ataques novamente testados

| Ataque | Resultado | Status |
|---|---|---|
| 1. A usa UUID de B (GET/PATCH/DELETE/functions) | 404, B intacto | CORRIGIDA |
| 2. user executa deleteGuaranteedAccount | 403 | CORRIGIDA |
| 3. cleanup cross-tenant | 403 para tenant; master+A não toca B | CORRIGIDA |
| 4. refresh cross-tenant | 404 | CORRIGIDA |
| 5. delete cross-tenant | 404 | CORRIGIDA |
| 6. wipe CDI/PTAX global por tenant | 0 deletes globais; B intacto | CORRIGIDA |
| 7. CREATE contrato aprovado | persiste `rascunho` | CORRIGIDA |
| 8. PATCH approved_by | ignorado | CORRIGIDA |
| 9. forgot-password sem SMTP | JSON genérico, sem token | CORRIGIDA |
| 10. self-upgrade ENTERPRISE | 403 BILLING_LOCKED | CORRIGIDA |
| 11. platform_admin sem tenant em dados de cliente | 400 TENANT_CONTEXT_REQUIRED | CORRIGIDA |
| 12. entidade fora de ENTITY_SCOPE | AccountMovement e NotificationLog incluídos | CORRIGIDA |

## Riscos remanescentes (P1/P2 — fora deste ciclo)

- JWT sem revogação / logout cosmático.
- Token ainda aceito em query de upload.
- SSRF em URL de ERP (IP privado).
- Upload só por MIME, arquivos legado na raiz.
- `erpIntegrate` ainda tem `UPDATE ... WHERE id = $1` **depois** de SELECT já scoped — defesa em profundidade incompleta (P1).
- Race no limite de plano.
- Sem MFA, sem webhook de billing, sem lockout.
- OpenAPI público.

## Security Score estimado

Antes: **31/100**  
Depois: **68/100**

Os P0 de breakout e takeover por reset/plano foram fechados com teste. Auth de sessão e uploads continuam P1.

## Multi-Tenant Isolation Score

Antes: **38/100**  
Depois: **84/100**

Store + functions destrutivas + catálogo compartilhado + scope das duas tabelas faltantes agora têm prova automatizada A≠B. Residual: UPDATEs ERP por id após SELECT scoped.

## P0-20 — classificação SQL raw (síntese)

- **GLOBAL LEGÍTIMO:** health `SELECT 1`; login/users por email; schema_migrations; catálogo shared (`group_id IS NULL`) por master; seeds.
- **TENANT-SCOPED CORRETO:** store genérico; primitivas em `scope.js`; generate/cleanup/refresh/delete/reopen; clear* por `group_id`; adminEmails; integrations/schedules/audit com `scopedGroupSql`.
- **TENANT-SCOPED INCORRETO:** nenhum DELETE financeiro crítico restante sem `group_id` no caminho de produto (exceto limpeza de testes).
- **INDETERMINADO / P1:** `UPDATE payable_titles/receivable_titles SET ... WHERE id = $1` em erpIntegrate após SELECT scoped; jobs se `loadTenantByGroupId` falhar ainda podem tentar task (falha em `groupIdOrThrow`).

## Critérios de aceite

- [x] A não lê B  
- [x] A não altera B  
- [x] A não exclui B  
- [x] Functions financeiras respeitam tenant  
- [x] Cleanup não é global  
- [x] Catálogo global exige platform_admin para wipe  
- [x] account_movements tem tenant  
- [x] notification_log tem tenant  
- [x] adminEmails scoped  
- [x] forgot-password nunca devolve token  
- [x] production não inicia com secrets default  
- [x] contrato não nasce aprovado  
- [x] plano não vira ENTERPRISE pelo cliente  
- [x] migrations preservaram dados  
- [x] novos testes passaram  
- [x] testes existentes passaram  
